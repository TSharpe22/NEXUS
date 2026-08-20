import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync, copyFileSync } from 'fs'
import { applySchema } from './schema'
import { rotateBackups, listBackups, backupsDir } from './backup'

let db: Database.Database

export function initDatabase(): void {
  const dataDir = join(app.getPath('userData'), 'data')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  const dbPath = join(dataDir, 'nexus.db')
  // Asked before the connection is opened, because opening one creates the
  // file — after this line "does a vault exist?" is always yes, and the first
  // launch would spend a rotation slot snapshotting an empty database.
  const hadVault = existsSync(dbPath)
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')

  // A launch snapshot, before the schema step gets a chance to change
  // anything. Checkpointed first: under WAL the recent writes are still in
  // `nexus.db-wal`, so a plain copy of the main file alone is a stale vault.
  try {
    if (hadVault) {
      db.pragma('wal_checkpoint(TRUNCATE)')
      const { created, pruned } = rotateBackups(dataDir, dbPath)
      if (created) {
        console.log(`[nexus] snapshot ${created}${pruned.length ? ` (pruned ${pruned.length})` : ''}`)
      }
    }
  } catch (err) {
    // Never let a failed snapshot stop the app opening — the vault is fine,
    // the copy of it is what failed.
    console.error('[nexus] could not take a launch snapshot:', err)
  }

  // Foreign keys stay OFF through migration — bringing a first-build file
  // forward means rebuilding tables, which drops and recreates tables that
  // other tables reference. Switched on once the schema has settled.
  db.pragma('foreign_keys = OFF')

  const backupPath = applySchema(db, (reason) => backupDatabase(dbPath, reason))
  if (backupPath) {
    console.log(`[nexus] database migrated; previous version kept at ${backupPath}`)
  }

  db.pragma('foreign_keys = ON')
}

export function closeDatabase(): void {
  // `before-quit` can fire more than once (a cancelled quit, then a real one),
  // and a handle that has already been closed must not be closed again.
  if (!db || !db.open) return
  db.close()
}

export function getDb(): Database.Database {
  return db
}

export function getDbPath(): string {
  return join(app.getPath('userData'), 'data', 'nexus.db')
}

export function getDataDir(): string {
  return join(app.getPath('userData'), 'data')
}

export function getBackupInfo(): { folder: string; count: number; latest: string | null } {
  const dataDir = getDataDir()
  const backups = listBackups(dataDir)
  return {
    folder: backupsDir(dataDir),
    count: backups.length,
    latest: backups[0] ?? null
  }
}

/**
 * Copy the database aside before anything destructive touches it. WAL is
 * checkpointed first so the copy is a complete database rather than a stale
 * main file with recent writes still sitting in `-wal`.
 */
function backupDatabase(dbPath: string, reason: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${dbPath}.backup-${stamp}`
  db.pragma('wal_checkpoint(TRUNCATE)')
  copyFileSync(dbPath, backupPath)
  console.log(`[nexus] ${reason}: backing up to ${backupPath}`)
  return backupPath
}
