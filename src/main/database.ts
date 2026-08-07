import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

let db: Database.Database

export function initDatabase(): void {
  const dataDir = join(app.getPath('userData'), 'data')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  db = new Database(join(dataDir, 'nexus.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  db.exec(`
    CREATE TABLE IF NOT EXISTS types (
      id    TEXT PRIMARY KEY,
      name  TEXT NOT NULL UNIQUE,
      icon  TEXT
    );

    -- The only seeded type. Everything else — Directive, Book, Trade Log,
    -- whatever — is created by the user, not predetermined here.
    INSERT OR IGNORE INTO types (id, name) VALUES ('note', 'Note');

    CREATE TABLE IF NOT EXISTS property_definitions (
      id             TEXT PRIMARY KEY,
      type_id        TEXT NOT NULL REFERENCES types(id) ON DELETE CASCADE,
      key            TEXT NOT NULL,
      name           TEXT NOT NULL,
      property_type  TEXT NOT NULL,
      sort_order     REAL NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_propdefs_type ON property_definitions(type_id);

    CREATE TABLE IF NOT EXISTS pages (
      id          TEXT PRIMARY KEY,
      type_id     TEXT NOT NULL DEFAULT 'note' REFERENCES types(id),
      title       TEXT NOT NULL DEFAULT '',
      icon        TEXT,
      content     TEXT NOT NULL DEFAULT '[]',
      page_width  INTEGER NOT NULL DEFAULT 720,
      is_deleted  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pages_type ON pages(type_id);
    CREATE INDEX IF NOT EXISTS idx_pages_deleted ON pages(is_deleted);

    CREATE TABLE IF NOT EXISTS properties (
      id              TEXT PRIMARY KEY,
      page_id         TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      key             TEXT NOT NULL,
      type            TEXT NOT NULL,
      value_text      TEXT,
      value_number    REAL,
      value_date      TEXT,
      value_relation  TEXT,
      UNIQUE(page_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_properties_page ON properties(page_id);
    CREATE INDEX IF NOT EXISTS idx_properties_key ON properties(key);

    CREATE TABLE IF NOT EXISTS links (
      id              TEXT PRIMARY KEY,
      source_page_id  TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      target_page_id  TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      context         TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source_page_id, target_page_id)
    );

    CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_page_id);
    CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_page_id);

    CREATE TABLE IF NOT EXISTS activity_log (
      id          TEXT PRIMARY KEY,
      page_id     TEXT REFERENCES pages(id) ON DELETE CASCADE,
      event_type  TEXT NOT NULL,
      message     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
  `)
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
