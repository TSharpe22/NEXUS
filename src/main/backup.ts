/**
 * Rotating snapshots of the database file.
 *
 * The vault mirror is not a backup: it is one-way, and lossy on the way out
 * (a callout or a toggle comes back as a plain paragraph, a table as nothing).
 * The database file is the only complete copy of a vault, and until this
 * existed the only copies ever taken were the ones a destructive migration
 * made for itself.
 *
 * Imports no `electron`, so it can be exercised against a throwaway directory:
 * `npm run check:backup`.
 */
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  utimesSync,
  unlinkSync
} from 'fs'
import { join } from 'path'

/** How many launch snapshots to keep before the oldest is dropped. */
export const KEEP_BACKUPS = 10

const PREFIX = 'nexus-'
const SUFFIX = '.db'

export interface BackupResult {
  /** Path of the snapshot taken, or null when there was nothing new to copy. */
  created: string | null
  /** Snapshots deleted to stay within `KEEP_BACKUPS`. */
  pruned: string[]
  /** Every snapshot now on disk, newest first. */
  kept: string[]
}

export function backupsDir(dataDir: string): string {
  return join(dataDir, 'backups')
}

/** Existing snapshots, newest first. Named by timestamp, so name order is age order. */
export function listBackups(dataDir: string): string[] {
  const dir = backupsDir(dataDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
    .sort()
    .reverse()
    .map((f) => join(dir, f))
}

/**
 * Copy the database aside, then drop the oldest snapshots beyond `KEEP_BACKUPS`.
 *
 * Skipped when the database has not been written since the newest snapshot was
 * taken. Without that, opening Nexus five times in a morning would push five
 * identical copies through the rotation and throw away five real ones.
 *
 * `copyFileSync` is only a complete copy if the write-ahead log has been
 * checkpointed into the main file first — the caller owns that, because it is
 * the one holding the connection.
 */
export function rotateBackups(dataDir: string, dbPath: string, keep = KEEP_BACKUPS): BackupResult {
  const existing = listBackups(dataDir)

  if (!existsSync(dbPath)) return { created: null, pruned: [], kept: existing }

  const source = statSync(dbPath)
  const newest = existing[0]
  if (newest && source.mtimeMs <= statSync(newest).mtimeMs) {
    return { created: null, pruned: [], kept: existing }
  }

  const dir = backupsDir(dataDir)
  mkdirSync(dir, { recursive: true })

  // Colons are legal here but not on every filesystem this folder might be
  // copied to, and the name has to sort by age.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  // Millisecond resolution is not a guarantee of uniqueness, and a name that
  // repeats overwrites the snapshot already under it — losing the older of the
  // two states rotation is meant to be holding on to.
  //
  // Every name carries the counter, including the first. Adding it only on a
  // collision puts `-002` *before* the bare name in a string sort ('-' sorts
  // under '.'), and this whole module reads age off name order.
  let n = 1
  let target = join(dir, `${PREFIX}${stamp}-${String(n).padStart(3, '0')}${SUFFIX}`)
  while (existsSync(target)) {
    n++
    target = join(dir, `${PREFIX}${stamp}-${String(n).padStart(3, '0')}${SUFFIX}`)
  }
  copyFileSync(dbPath, target)
  // Carry the vault's own mtime onto the copy. The check above asks "has the
  // vault moved on since this snapshot?", and left at the copy time it would
  // instead be asking "was the vault written after the copy finished?" — a
  // different question that answers yes for a vault nobody has touched.
  utimesSync(target, source.atime, source.mtime)

  const pruned: string[] = []
  for (const old of listBackups(dataDir).slice(keep)) {
    try {
      unlinkSync(old)
      pruned.push(old)
    } catch {
      // Locked or already gone — a snapshot that outlives its turn is not a
      // reason to fail the launch.
    }
  }

  return { created: target, pruned, kept: listBackups(dataDir) }
}
