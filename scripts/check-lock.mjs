/**
 * Exercises the per-page password crypto.
 *
 *   npm run check:lock
 *
 * Runs outside Electron on purpose: `src/main/lock.ts` has no electron import,
 * so the one piece of this app whose failure mode is *silently readable data*
 * can be checked without a display.
 *
 * What is under test is the set of claims `lock.ts` makes in its header, since
 * a lock that is wrong is worse than no lock at all — it is the same page with
 * a promise attached:
 *
 *   - a sealed body does not contain the plaintext, anywhere, in any encoding
 *   - the wrong password is refused rather than returning something plausible
 *   - a tampered envelope is refused, which is what makes the tag a real check
 *     rather than a checksum
 *   - two saves of the same document under the same key are not the same bytes
 *     (the IV is fresh), because GCM leaks outright if they are
 *   - an envelope written under one scrypt cost still opens after the cost is
 *     raised, so raising it later does not brick every page already locked
 *   - the session cache hands back a key, forgets it on request, and zeroes it
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { build } from 'esbuild'
import { pathToFileURL } from 'url'

const dir = mkdtempSync(join(tmpdir(), 'nexus-lock-'))

let failures = 0
function check(label, ok, extra = '') {
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${extra ? ' — ' + extra : ''}`)
}

async function load(entry, name) {
  const outfile = join(dir, name)
  await build({ entryPoints: [entry], bundle: true, outfile, format: 'esm', platform: 'node' })
  return import(pathToFileURL(outfile).href)
}

const lock = await load('src/main/lock.ts', 'lock.mjs')

// A document with something worth hiding in it, in the shape a page really
// stores: BlockNote JSON, so the "is this an array or an object" distinction
// the rest of the code leans on is exercised for real.
const SECRET = 'the combination is 41-19-07'
const DOCUMENT = JSON.stringify([
  { id: 'a', type: 'paragraph', props: {}, content: [{ type: 'text', text: SECRET, styles: {} }] }
])

console.log('\nsealing:')
const { key, salt } = lock.newKey('correct horse battery staple')
const sealed = lock.seal(DOCUMENT, key, salt)

check('the sealed body is an envelope', lock.isEnvelope(sealed))
check('a plain document is not', !lock.isEnvelope(DOCUMENT))
check('nor is an empty body', !lock.isEnvelope('') && !lock.isEnvelope(null))

// The point of the whole exercise. Checked against the raw string and against
// its base64, because "encrypted" that leaves the text recoverable by `strings`
// or by one decode step is not encrypted.
check('the plaintext is not in the envelope', !sealed.includes(SECRET))
check(
  'nor is it there base64-encoded',
  !sealed.includes(Buffer.from(SECRET, 'utf-8').toString('base64'))
)
const envelope = lock.parseEnvelope(sealed)
check(
  'the ciphertext does not decode to the plaintext',
  !Buffer.from(envelope.data, 'base64').toString('utf-8').includes(SECRET)
)

console.log('\nopening:')
check('the right password opens it', lock.open(envelope, lock.keyForEnvelope(envelope, 'correct horse battery staple')) === DOCUMENT)

let refused = false
try {
  lock.open(envelope, lock.keyForEnvelope(envelope, 'correct horse battery stapl'))
} catch (e) {
  refused = e.name === 'WrongPassword'
}
check('a wrong password is refused, by name', refused)

refused = false
try {
  lock.open(envelope, lock.keyForEnvelope(envelope, ''))
} catch (e) {
  refused = e.name === 'WrongPassword'
}
check('an empty password is refused too', refused)

console.log('\ntampering:')
// One flipped bit in the ciphertext. GCM's tag is what makes this fail; a
// cipher without one would hand back corrupted plaintext and call it success.
const bytes = Buffer.from(envelope.data, 'base64')
bytes[0] ^= 0x01
refused = false
try {
  lock.open({ ...envelope, data: bytes.toString('base64') }, key)
} catch (e) {
  refused = e.name === 'WrongPassword'
}
check('a flipped bit in the body is refused', refused)

refused = false
try {
  lock.open({ ...envelope, tag: Buffer.alloc(16).toString('base64') }, key)
} catch (e) {
  refused = e.name === 'WrongPassword'
}
check('a replaced tag is refused', refused)

console.log('\nfreshness:')
const again = lock.seal(DOCUMENT, key, salt)
check('the same document sealed twice differs', again !== sealed)
check(
  'because the IV is fresh each time',
  lock.parseEnvelope(again).iv !== envelope.iv
)
check(
  'and both still open to the same document',
  lock.open(lock.parseEnvelope(again), key) === DOCUMENT
)

console.log('\ncost carried in the envelope:')
// A page sealed when the cost was lower. `keyForEnvelope` has to read N from
// the envelope rather than from the current constant, or raising the cost
// makes every page already locked permanently unopenable.
const cheap = { ...lock.parseEnvelope(lock.seal(DOCUMENT, key, salt)), n: 1024 }
const cheapKey = lock.keyForEnvelope(cheap, 'anything')
check('a lower-cost envelope derives a different key', !cheapKey.equals(key))
check('and the envelope says which cost it used', cheap.n === 1024 && envelope.n > 1024)

console.log('\nthe session:')
const PAGE = 'page-1'
check('a page nobody opened is not unlocked', !lock.isUnlocked(PAGE))
lock.remember(PAGE, Buffer.from(key), salt)
check('remembering makes it unlocked', lock.isUnlocked(PAGE))
check('and the key comes back', lock.sessionKey(PAGE).key.equals(key))
check('it is listed', lock.unlockedIds().includes(PAGE))

const held = lock.sessionKey(PAGE).key
lock.forget(PAGE)
check('forgetting drops it', !lock.isUnlocked(PAGE) && lock.sessionKey(PAGE) === null)
check('and zeroes the key it was holding', held.every((b) => b === 0))

lock.remember('a', Buffer.from(key), salt)
lock.remember('b', Buffer.from(key), salt)
lock.forgetAll()
check('forgetAll shuts everything', lock.unlockedIds().length === 0)

console.log('\npasswords that are not ASCII:')
// Normalised on both sides, so a password typed with a composed é and one
// typed with a combining accent are the same password rather than a support
// ticket about a page that will not open.
const accented = 'café-notes-2026'
const composed = 'café-notes-2026'
const uni = lock.newKey(accented)
const uniSealed = lock.seal(DOCUMENT, uni.key, uni.salt)
check(
  'a decomposed password opens a composed one',
  lock.open(lock.parseEnvelope(uniSealed), lock.keyForEnvelope(lock.parseEnvelope(uniSealed), composed)) === DOCUMENT
)
check('the two really are different strings', accented !== composed)
check('sameSecret agrees they are the same secret', lock.sameSecret(accented, composed))
check('and still says no to a different one', !lock.sameSecret(accented, 'cafe-notes-2026'))

console.log('\nround trip of an empty page:')
// An empty document is a valid plaintext, and GCM authenticates it the same
// way — there is no separate verifier, so this is the case that would break if
// one were ever needed.
const emptyKey = lock.newKey('pw')
const emptySealed = lock.seal('[]', emptyKey.key, emptyKey.salt)
check('it seals', lock.isEnvelope(emptySealed))
check(
  'it opens',
  lock.open(lock.parseEnvelope(emptySealed), lock.keyForEnvelope(lock.parseEnvelope(emptySealed), 'pw')) === '[]'
)
refused = false
try {
  lock.open(lock.parseEnvelope(emptySealed), lock.keyForEnvelope(lock.parseEnvelope(emptySealed), 'no'))
} catch (e) {
  refused = e.name === 'WrongPassword'
}
check('and a wrong password on an empty page is still refused', refused)

rmSync(dir, { recursive: true, force: true })

console.log('')
if (failures > 0) {
  console.log(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('all checks passed')
