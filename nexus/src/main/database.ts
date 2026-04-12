import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import type { Page, Block, BacklinkResult, LinkTarget } from '../shared/types'

let db: Database.Database

// ============================================================
// Initialization
// ============================================================

export function initDatabase(): void {
  const dataDir = join(app.getPath('userData'), 'data')
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  const dbPath = join(dataDir, 'nexus.db')
  db = new Database(dbPath)

  // Performance pragmas
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  runMigrations()
}

export function closeDatabase(): void {
  if (db) db.close()
}

// ============================================================
// Schema / Migrations
// ============================================================

function columnExists(table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as { name: string }[]
  return cols.some((c) => c.name === column)
}

function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS types (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL UNIQUE,
      icon          TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO types (id, name, icon) VALUES ('note', 'Note', '📝');

    CREATE TABLE IF NOT EXISTS pages (
      id            TEXT PRIMARY KEY,
      type_id       TEXT NOT NULL DEFAULT 'note' REFERENCES types(id),
      title         TEXT NOT NULL DEFAULT '',
      icon          TEXT,
      cover         TEXT,
      is_archived   INTEGER NOT NULL DEFAULT 0,
      is_deleted    INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pages_type ON pages(type_id);
    CREATE INDEX IF NOT EXISTS idx_pages_archived ON pages(is_archived);
    CREATE INDEX IF NOT EXISTS idx_pages_deleted ON pages(is_deleted);

    CREATE TABLE IF NOT EXISTS blocks (
      id              TEXT PRIMARY KEY,
      page_id         TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      parent_block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
      block_type      TEXT NOT NULL DEFAULT 'paragraph',
      content         TEXT,
      sort_order      REAL NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_page ON blocks(page_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_parent ON blocks(parent_block_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_order ON blocks(page_id, sort_order);

    CREATE TABLE IF NOT EXISTS property_definitions (
      id            TEXT PRIMARY KEY,
      type_id       TEXT NOT NULL REFERENCES types(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      property_type TEXT NOT NULL,
      config        TEXT,
      sort_order    REAL NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type_id, name)
    );

    CREATE TABLE IF NOT EXISTS property_values (
      id              TEXT PRIMARY KEY,
      page_id         TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      property_def_id TEXT NOT NULL REFERENCES property_definitions(id) ON DELETE CASCADE,
      value_text      TEXT,
      value_number    REAL,
      value_date      TEXT,
      value_boolean   INTEGER,
      value_json      TEXT,
      UNIQUE(page_id, property_def_id)
    );

    CREATE INDEX IF NOT EXISTS idx_propvals_page ON property_values(page_id);
    CREATE INDEX IF NOT EXISTS idx_propvals_def ON property_values(property_def_id);

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
  `)

  // Phase 03 migration: page_width column (TEXT, stores legacy preset names or numeric px values)
  if (!columnExists('pages', 'page_width')) {
    db.exec(`ALTER TABLE pages ADD COLUMN page_width TEXT NOT NULL DEFAULT '720'`)
  }
}

// Map legacy string preset names to pixel values.
const LEGACY_WIDTH_MAP: Record<string, number> = {
  narrow: 640,
  default: 720,
  wide: 900,
  full: 0,
}

/** Coerce stored page_width value (legacy string or numeric string) to a number. */
function coercePageWidth(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') {
    if (raw in LEGACY_WIDTH_MAP) return LEGACY_WIDTH_MAP[raw]
    const n = parseInt(raw, 10)
    if (!isNaN(n)) return n
  }
  return 720
}

/** Map a Page row from SQLite, normalising page_width to a number. */
function mapPage(row: unknown): Page {
  const r = row as Record<string, unknown>
  return { ...r, page_width: coercePageWidth(r.page_width) } as unknown as Page
}

// ============================================================
// Page queries
// ============================================================

const now = () => new Date().toISOString().replace('T', ' ').split('.')[0]

export function createPage(): Page {
  const id = uuidv4()
  const timestamp = now()
  db.prepare(`
    INSERT INTO pages (id, type_id, title, created_at, updated_at)
    VALUES (?, 'note', '', ?, ?)
  `).run(id, timestamp, timestamp)
  return mapPage(db.prepare('SELECT * FROM pages WHERE id = ?').get(id))
}

export function getAllPages(): Page[] {
  return (db.prepare(
    'SELECT * FROM pages WHERE is_deleted = 0 ORDER BY updated_at DESC'
  ).all() as unknown[]).map(mapPage)
}

export function getPageById(id: string): Page | null {
  const row = db.prepare('SELECT * FROM pages WHERE id = ?').get(id)
  return row ? mapPage(row) : null
}

export function updatePage(id: string, data: Partial<Page>): void {
  const allowed = ['title', 'icon', 'cover', 'is_archived', 'page_width'] as const
  const sets: string[] = []
  const values: unknown[] = []

  for (const key of allowed) {
    if (key in data) {
      sets.push(`${key} = ?`)
      // page_width is stored as TEXT; store numeric value as string
      values.push(key === 'page_width' ? String(data[key]) : data[key])
    }
  }

  if (sets.length === 0) return

  sets.push('updated_at = ?')
  values.push(now())
  values.push(id)

  db.prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`).run(...values)
}

export function softDeletePage(id: string): void {
  db.prepare('UPDATE pages SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), id)
}

export function restorePage(id: string): void {
  db.prepare('UPDATE pages SET is_deleted = 0, updated_at = ? WHERE id = ?').run(now(), id)
}

export function hardDeletePage(id: string): void {
  db.prepare('DELETE FROM pages WHERE id = ?').run(id)
}

export function getDeletedPages(): Page[] {
  return (db.prepare(
    'SELECT * FROM pages WHERE is_deleted = 1 ORDER BY updated_at DESC'
  ).all() as unknown[]).map(mapPage)
}

export function duplicatePage(id: string): Page {
  const source = getPageById(id)
  if (!source) throw new Error(`Page not found: ${id}`)

  const newId = uuidv4()
  const timestamp = now()

  db.prepare(`
    INSERT INTO pages (id, type_id, title, icon, cover, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(newId, source.type_id, `${source.title} (copy)`, source.icon, source.cover, timestamp, timestamp)

  // Duplicate blocks while preserving parent-child relationships.
  const blocks = db.prepare(
    'SELECT * FROM blocks WHERE page_id = ? ORDER BY sort_order'
  ).all(id) as Block[]
  const idMap = new Map<string, string>()

  for (const block of blocks) {
    idMap.set(block.id, uuidv4())
  }

  const insertBlock = db.prepare(`
    INSERT INTO blocks (id, page_id, parent_block_id, block_type, content, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const block of blocks) {
    const newBlockId = idMap.get(block.id)!
    const newParentId = block.parent_block_id ? idMap.get(block.parent_block_id) ?? null : null
    insertBlock.run(
      newBlockId, newId, newParentId, block.block_type,
      block.content, block.sort_order, timestamp, timestamp
    )
  }

  return mapPage(db.prepare('SELECT * FROM pages WHERE id = ?').get(newId))
}

// ============================================================
// Block queries
// ============================================================

export function getBlocksByPageId(pageId: string): Block[] {
  return db.prepare(
    'SELECT * FROM blocks WHERE page_id = ? ORDER BY sort_order ASC'
  ).all(pageId) as Block[]
}

export function saveBlocks(pageId: string, blocks: Block[]): void {
  const timestamp = now()

  const trx = db.transaction(() => {
    db.prepare('DELETE FROM blocks WHERE page_id = ?').run(pageId)

    const insert = db.prepare(`
      INSERT INTO blocks (id, page_id, parent_block_id, block_type, content, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const block of blocks) {
      insert.run(
        block.id, pageId, block.parent_block_id || null,
        block.block_type, block.content, block.sort_order,
        block.created_at || timestamp, timestamp
      )
    }

    // Touch the page's updated_at
    db.prepare('UPDATE pages SET updated_at = ? WHERE id = ?').run(timestamp, pageId)
  })

  trx()
}

// ============================================================
// Link queries
// ============================================================

export function getBacklinks(pageId: string): BacklinkResult[] {
  const rows = db.prepare(`
    SELECT l.context, p.id AS source_page_id, p.title, p.icon
    FROM links l
    JOIN pages p ON p.id = l.source_page_id
    WHERE l.target_page_id = ? AND p.is_deleted = 0
    ORDER BY l.created_at DESC
  `).all(pageId) as { source_page_id: string; title: string; icon: string | null; context: string | null }[]

  return rows.map((r) => ({
    sourcePageId: r.source_page_id,
    sourcePageTitle: r.title,
    sourcePageIcon: r.icon,
    context: r.context,
  }))
}

export function syncLinks(pageId: string, linkTargets: LinkTarget[]): void {
  const trx = db.transaction(() => {
    const existing = db.prepare(
      'SELECT id, target_page_id FROM links WHERE source_page_id = ?'
    ).all(pageId) as { id: string; target_page_id: string }[]

    const existingTargets = new Set(existing.map((e) => e.target_page_id))
    const newTargets = new Map(linkTargets.map((lt) => [lt.targetPageId, lt.context]))

    // Delete links that no longer exist in the editor content
    for (const row of existing) {
      if (!newTargets.has(row.target_page_id)) {
        db.prepare('DELETE FROM links WHERE id = ?').run(row.id)
      }
    }

    // Insert new links
    const insert = db.prepare(`
      INSERT OR IGNORE INTO links (id, source_page_id, target_page_id, context, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    const timestamp = now()
    for (const [targetId, context] of newTargets) {
      if (!existingTargets.has(targetId)) {
        insert.run(uuidv4(), pageId, targetId, context, timestamp)
      }
    }

    // Update context for existing links that changed
    const updateCtx = db.prepare('UPDATE links SET context = ? WHERE source_page_id = ? AND target_page_id = ?')
    for (const [targetId, context] of newTargets) {
      if (existingTargets.has(targetId)) {
        updateCtx.run(context, pageId, targetId)
      }
    }
  })

  trx()
}

export function searchPagesForLink(query: string): Page[] {
  if (!query.trim()) {
    return (db.prepare(
      'SELECT * FROM pages WHERE is_deleted = 0 ORDER BY updated_at DESC LIMIT 20'
    ).all() as unknown[]).map(mapPage)
  }
  return (db.prepare(
    'SELECT * FROM pages WHERE is_deleted = 0 AND title LIKE ? ORDER BY updated_at DESC LIMIT 20'
  ).all(`%${query}%`) as unknown[]).map(mapPage)
}
