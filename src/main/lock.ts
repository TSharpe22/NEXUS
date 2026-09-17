/**
 * Per-page passwords.
 *
 * A locked page's body is encrypted at rest, in `pages.content`, and the only
 * thing that can turn it back into a document is the password. That is the
 * whole design constraint, and it is worth being blunt about why it was drawn
 * this way rather than as a flag the UI checks:
 *
 * **The database is not a secret.** `nexus.db` is a file in the user's home
 * directory, readable by anything that runs as them, and the vault mirror
 * writes every page out as plain Markdown on top of that. A "locked" page that
 * still holds its text in either place is a page anybody can read with `cat`,
 * and calling that a password would be a lie told by the UI. So the bytes
 * change, or the feature does not exist.
 *
 * What is protected, exactly:
 *
 * - **The body is.** Encrypted with AES-256-GCM under a key derived from the
 *   password by scrypt, with a fresh random salt per lock and a fresh random
 *   IV per save. GCM's tag is also the password check: a wrong password fails
 *   to authenticate, so there is no separate verifier to store and no way to
 *   half-decrypt into plausible garbage.
 * - **Its search index is.** The FTS body column is emptied on lock, so a
 *   locked page cannot be found by anything written inside it.
 * - **Its projections are.** Tasks and outbound links are dropped, because
 *   both are readable summaries of a document that is supposed to be shut.
 * - **The mirror is.** A locked page mirrors as a stub, not as its text.
 *
 * What is not, and is not claimed to be: the **title**, the **tags**, the
 * **properties**, the **folder** and the **dates**. Those are what the page
 * list, the tag filter and every view are made of, and encrypting them would
 * mean a locked page could not appear in the app at all — a different feature
 * (a hidden vault) wearing this one's name. `NEXUS.md` says the same thing to
 * the user. Put nothing secret in a title.
 *
 * The password itself is never stored, anywhere, in any form. It is turned
 * into a key, the key is held in this module's memory for as long as the app
 * is running, and it dies with the process. Forgetting a password means the
 * body is gone; that is what makes it a password rather than a curtain.
 *
 * Imports no `electron`, so it can be exercised directly: `npm run check:lock`.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'crypto'

/**
 * scrypt cost. N=2^15 with r=8 is ~32MB and ~100ms on this class of machine —
 * slow enough that guessing a stolen `nexus.db` is expensive, fast enough that
 * unlocking a page feels like opening it.
 *
 * These live *in the envelope* rather than only here, so raising them later
 * does not make every page already locked unreadable: a page is decrypted with
 * the parameters it was written with, and re-encrypted with the current ones
 * on the next save.
 */
const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_BYTES = 32
const SALT_BYTES = 16
const IV_BYTES = 12

/** scrypt needs 128 * N * r bytes; the default cap of 32MB is exactly short. */
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2

/**
 * Marks a `pages.content` blob as an envelope rather than a document.
 *
 * A stored document is always a JSON *array* of blocks and an envelope is
 * always a JSON *object*, so the two could not be confused even without this.
 * It is here anyway because it is the string somebody greps for when they open
 * the database wondering what they are looking at.
 */
const MAGIC = 'nexus-locked'

export interface LockEnvelope {
  nexus: typeof MAGIC
  v: 1
  kdf: 'scrypt'
  n: number
  r: number
  p: number
  salt: string
  iv: string
  tag: string
  data: string
}

/** Whether a stored body is an encrypted envelope. Cheap enough to call anywhere. */
export function isEnvelope(content: string | null | undefined): boolean {
  if (!content) return false
  // Checked before parsing: every unlocked page in the vault would otherwise
  // be fully JSON-parsed by a function whose answer is "no" — on every mirror
  // pass, every reindex, every list.
  if (!content.includes(`"${MAGIC}"`)) return false
  return parseEnvelope(content) !== null
}

export function parseEnvelope(content: string | null | undefined): LockEnvelope | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content) as Partial<LockEnvelope>
    if (parsed?.nexus !== MAGIC) return null
    if (typeof parsed.salt !== 'string' || typeof parsed.iv !== 'string') return null
    if (typeof parsed.tag !== 'string' || typeof parsed.data !== 'string') return null
    return parsed as LockEnvelope
  } catch {
    return null
  }
}

function deriveKey(password: string, salt: Buffer, n: number, r: number, p: number): Buffer {
  return scryptSync(password.normalize('NFKC'), salt, KEY_BYTES, {
    N: n,
    r,
    p,
    maxmem: SCRYPT_MAXMEM
  })
}

/**
 * A password's key for a page that is already locked.
 *
 * Derived against the envelope's own salt and cost, which is what makes an
 * old page readable after the parameters above are raised.
 */
export function keyForEnvelope(envelope: LockEnvelope, password: string): Buffer {
  return deriveKey(
    password,
    Buffer.from(envelope.salt, 'base64'),
    envelope.n ?? SCRYPT_N,
    envelope.r ?? SCRYPT_R,
    envelope.p ?? SCRYPT_P
  )
}

/** A fresh key and salt, for a page being locked for the first time. */
export function newKey(password: string): { key: Buffer; salt: Buffer } {
  const salt = randomBytes(SALT_BYTES)
  return { key: deriveKey(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P), salt }
}

/**
 * Seal a document under a key.
 *
 * A new IV every time, which is not optional with GCM: reusing one across two
 * saves of the same page under the same key leaks the difference between the
 * two documents outright.
 */
export function seal(plaintext: string, key: Buffer, salt: Buffer): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const envelope: LockEnvelope = {
    nexus: MAGIC,
    v: 1,
    kdf: 'scrypt',
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  }
  return JSON.stringify(envelope)
}

/** Thrown for a wrong password, so callers can tell it from a real failure. */
export class WrongPassword extends Error {
  constructor() {
    super('Wrong password')
    this.name = 'WrongPassword'
  }
}

/**
 * Open an envelope with a key. Throws `WrongPassword` when the tag does not
 * authenticate — which is the same thing as the key being wrong, since a
 * tampered file is not a case this can or should distinguish for the user.
 */
export function open(envelope: LockEnvelope, key: Buffer): string {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final()
    ]).toString('utf-8')
  } catch {
    throw new WrongPassword()
  }
}

// ============================================================
// The session
// ============================================================

interface Unlocked {
  key: Buffer
  salt: Buffer
}

/**
 * Keys for the pages unlocked since the app started.
 *
 * In memory only, and deliberately so — this is the whole difference between
 * "you have to type the password" and "the app types it for you". Deriving a
 * key costs ~100ms, which is fine once when a page is opened and not fine on
 * the debounce of every keystroke, so what is cached is the derived key rather
 * than the password it came from.
 *
 * Nothing expires it on a timer. A lock that reappears while you are looking
 * at the page is a lock that eats the paragraph you were typing; re-locking is
 * a thing the user asks for, and quitting does it for free.
 */
const session = new Map<string, Unlocked>()

export function remember(pageId: string, key: Buffer, salt: Buffer): void {
  session.set(pageId, { key, salt })
}

export function sessionKey(pageId: string): Unlocked | null {
  return session.get(pageId) ?? null
}

export function isUnlocked(pageId: string): boolean {
  return session.has(pageId)
}

export function forget(pageId: string): void {
  const held = session.get(pageId)
  // Zeroed rather than just dropped. It buys little against an attacker who
  // can already read this process's memory, and costs one line.
  if (held) held.key.fill(0)
  session.delete(pageId)
}

export function forgetAll(): void {
  for (const id of [...session.keys()]) forget(id)
}

/** Every page unlocked right now — what the renderer syncs its own list from. */
export function unlockedIds(): string[] {
  return [...session.keys()]
}

/**
 * Whether two passwords match, in constant time.
 *
 * Used only for the "confirm the password you just chose" field, where the
 * comparison is between two strings the same person typed a second apart and
 * timing tells an attacker nothing. Constant-time anyway, because the day
 * somebody reuses this helper for a real check is the day the shortcut costs
 * something.
 */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a.normalize('NFKC'), 'utf-8')
  const y = Buffer.from(b.normalize('NFKC'), 'utf-8')
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}
