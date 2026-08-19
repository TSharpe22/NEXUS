import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync, copyFileSync } from 'fs'
import { applySchema } from './schema'

let db: Database.Database

export function initDatabase(): void {
  const dataDir = join(app.getPath('userData'), 'data')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  const dbPath = join(dataDir, 'nexus.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')

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
  if (db) db.close()
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
