import { BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import * as repo from './repo'
import * as lock from './lock'
import { flushAllRenderers } from './flush'
import type { AppLockStatus } from '../shared/types'

/**
 * A password to open Nexus, and a lock that comes back when you walk away.
 *
 * **This locks the app, not the files.** Be exact about that, the way
 * `lock.ts` is exact about page passwords. `nexus.db`, the attachment store and
 * the vault mirror are ordinary files readable by anything running as you, and
 * nothing here changes a byte of them. What it does stop is a person at your
 * unlocked computer opening Nexus, or finding it open, and reading it. Keeping
 * the files themselves unreadable is a different feature — an encrypted vault —
 * and is written up in ROADMAP.md rather than pretended at here.
 *
 * Within that, it is enforced where it can be enforced: here, not in the
 * renderer. While locked, every IPC handler except this module's refuses to
 * run, so reloading the window, opening devtools, or a renderer bug that draws
 * the app behind the lock screen all get the same answer — nothing to draw it
 * with.
 */

const SETTING_HASH = 'appLock.hash'
const SETTING_IDLE = 'appLock.idleSeconds'
const SETTING_SLEEP = 'appLock.onSleep'

/** Ten minutes. Long enough not to lock you out mid-thought; short enough to matter. */
const DEFAULT_IDLE_SECONDS = 600
/** 0 means never. Anything else is clamped into this range. */
const MIN_IDLE_SECONDS = 5
const MAX_IDLE_SECONDS = 24 * 60 * 60

/**
 * scrypt, at the cost `lock.ts` uses for page passwords — ~100ms per attempt
 * on this class of machine, which is invisible to a person and expensive for
 * anything guessing. The parameters are stored with the hash, so raising them
 * later does not invalidate a password already set.
 */
const SCRYPT = { N: 32768, r: 8, p: 1 }
const SALT_BYTES = 16
const HASH_BYTES = 32

/** Free attempts before each wrong one costs a wait, doubling up to the cap. */
const FREE_ATTEMPTS = 3
const MAX_DELAY_MS = 30_000

let locked = false
let failures = 0
let retryAt = 0

// ------------------------------------------------------------------
// Hashing
// ------------------------------------------------------------------

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Buffer {
  return scryptSync(password.normalize('NFKC'), salt, HASH_BYTES, { N: n, r, p, maxmem: 128 * n * r * 2 })
}

function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES)
  const hash = derive(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p)
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$')
}

function matches(password: string): boolean {
  const stored = repo.getSetting(SETTING_HASH)
  if (!stored) return false
  const [kind, n, r, p, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------

export function hasPassword(): boolean {
  return !!repo.getSetting(SETTING_HASH)
}

export function isLocked(): boolean {
  return locked
}

function idleSeconds(): number {
  const raw = repo.getSetting(SETTING_IDLE)
  if (raw === null) return DEFAULT_IDLE_SECONDS
  const n = Math.round(Number(raw))
  return Number.isFinite(n) ? n : DEFAULT_IDLE_SECONDS
}

export function status(): AppLockStatus {
  return {
    enabled: hasPassword(),
    locked,
    idleSeconds: idleSeconds(),
    lockOnSleep: repo.getSetting(SETTING_SLEEP) !== '0',
    retryInMs: Math.max(0, retryAt - Date.now())
  }
}

function broadcast(): void {
  const next = status()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send('applock:changed', next)
  }
}

/**
 * Lock, after every window has written out what it still has pending.
 *
 * The flush comes first because locking stops every save from reaching the
 * database: a debounced edit that lands a moment after the lock would be
 * refused and lost. Page passwords are forgotten too — a page you unlocked
 * before walking away should not still be open when somebody else unlocks the
 * app, and that somebody might know the app password without knowing the
 * page's.
 */
export async function lockNow(): Promise<AppLockStatus> {
  if (!hasPassword() || locked) return status()
  await flushAllRenderers()
  locked = true
  lock.forgetAll()
  broadcast()
  return status()
}

function unlock(password: string): AppLockStatus {
  if (!locked) return status()
  const wait = retryAt - Date.now()
  if (wait > 0) throw new Error(`Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.`)
  if (typeof password !== 'string' || !matches(password)) {
    failures++
    if (failures >= FREE_ATTEMPTS) {
      retryAt = Date.now() + Math.min(MAX_DELAY_MS, 1000 * 2 ** (failures - FREE_ATTEMPTS))
    }
    throw new Error('Wrong password')
  }
  failures = 0
  retryAt = 0
  locked = false
  broadcast()
  return status()
}

// ------------------------------------------------------------------
// Wiring
// ------------------------------------------------------------------

/**
 * Refuse every other IPC handler while locked.
 *
 * Wraps `ipcMain.handle` itself, so it has to run before any handler is
 * registered — which is what makes it impossible to add a channel that forgets
 * to check. The alternative, a check at the top of each of a hundred handlers,
 * is a list that gets one wrong eventually.
 */
export function guardIpc(): void {
  const register = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((channel: string, listener: Parameters<typeof ipcMain.handle>[1]) =>
    register(channel, (event, ...args) => {
      if (locked && !channel.startsWith('applock:')) throw new Error(`[${channel}] Nexus is locked`)
      return listener(event, ...args)
    })) as typeof ipcMain.handle
}

/** Call once the app is ready: after `guardIpc`, before the window loads. */
export function initAppLock(): void {
  locked = hasPassword()

  ipcMain.handle('applock:status', () => status())
  ipcMain.handle('applock:unlock', (_, password: string) => unlock(password))
  ipcMain.handle('applock:lock', () => lockNow())

  // Changing or removing the password needs the current one, even from an
  // unlocked app — the person at the keyboard may not be the person who set it.
  ipcMain.handle('applock:setPassword', (_, current: string | null, next: string) => {
    if (locked) throw new Error('Nexus is locked')
    if (hasPassword() && (typeof current !== 'string' || !matches(current))) throw new Error('Wrong password')
    if (typeof next !== 'string' || next.length === 0) throw new Error('The password cannot be empty')
    repo.setSetting(SETTING_HASH, hashPassword(next))
    broadcast()
    return status()
  })
  ipcMain.handle('applock:removePassword', (_, current: string) => {
    if (locked) throw new Error('Nexus is locked')
    if (!matches(current)) throw new Error('Wrong password')
    repo.setSetting(SETTING_HASH, null)
    broadcast()
    return status()
  })
  ipcMain.handle('applock:setIdleSeconds', (_, seconds: number) => {
    if (locked) throw new Error('Nexus is locked')
    const n = Math.round(Number(seconds))
    const value = !Number.isFinite(n) || n <= 0 ? 0 : Math.min(MAX_IDLE_SECONDS, Math.max(MIN_IDLE_SECONDS, n))
    repo.setSetting(SETTING_IDLE, String(value))
    broadcast()
    return status()
  })
  ipcMain.handle('applock:setLockOnSleep', (_, on: boolean) => {
    if (locked) throw new Error('Nexus is locked')
    repo.setSetting(SETTING_SLEEP, on ? '1' : '0')
    broadcast()
    return status()
  })

  // The computer going to sleep, or its own screen locking, is the clearest
  // "walked away" there is — clearer than any idle timer.
  const onAway = (): void => {
    if (status().lockOnSleep) void lockNow()
  }
  powerMonitor.on('suspend', onAway)
  powerMonitor.on('lock-screen', onAway)
}
