import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import type { Page, Block, BacklinkResult, LinkTarget, SearchResult } from '../shared/types'

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

  initSearchIndex()
}

// ============================================================
// Full-text search
// ============================================================

// Sentinel characters wrapping matched terms in snippets. Control codes are
// used deliberately: they cannot occur in real note text, so the renderer can
// split on them without any HTML parsing or escaping.
const MARK_OPEN = '\u0002'
const MARK_CLOSE = '\u0003'

// FTS5 is compiled into better-sqlite3 by default, but a custom build could
// omit it. If the virtual table cannot be created we degrade to LIKE scans
// rather than leaving the app with no search at all.
let ftsAvailable = false

function initSearchIndex(): void {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(
        page_id UNINDEXED,
        title,
        body,
        tokenize = "unicode61 remove_diacritics 2"
      );
    `)
    ftsAvailable = true
  } catch (err) {
    console.error('[nexus] FTS5 unavailable, falling back to LIKE search:', err)
    ftsAvailable = false
    return
  }

  // Populate on first run after upgrading an existing vault. An empty index
  // alongside existing pages is also how a corrupted index heals itself.
  const indexed = (db.prepare('SELECT count(*) AS n FROM page_fts').get() as { n: number }).n
  const total = (db.prepare('SELECT count(*) AS n FROM pages').get() as { n: number }).n
  if (indexed === 0 && total > 0) {
    rebuildSearchIndex()
  }
}

/**
 * Recursively collect human-readable strings out of a parsed BlockNote block.
 *
 * Only values under keys literally named `text`, `content`, or `pageTitle` are
 * collected, so prop values like `textColor: "default"` never enter the index.
 * `pageTitle` is the label a `pageMention` renders, and users reasonably expect
 * a page containing [[Chemistry]] to be findable by "chemistry".
 *
 * Walking generically means new block types (and table cells) are covered
 * without needing a per-type branch here.
 */
function collectText(value: unknown, out: string[]): void {
  if (value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out)
    return
  }
  if (typeof value !== 'object') return

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      (key === 'text' || key === 'content' || key === 'pageTitle') &&
      typeof child === 'string'
    ) {
      if (child) out.push(child)
    } else {
      collectText(child, out)
    }
  }
}

/** Flatten one block's stored JSON content to plain text for indexing. */
export function blockContentToPlainText(content: string | null): string {
  if (!content) return ''
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    // Pre-JSON or corrupt rows: index the raw string rather than dropping it.
    return content
  }
  const out: string[] = []
  collectText(parsed, out)
  return out.join(' ')
}

function buildPageBody(pageId: string): string {
  const rows = db.prepare(
    'SELECT content FROM blocks WHERE page_id = ? ORDER BY sort_order ASC'
  ).all(pageId) as { content: string | null }[]
  return rows.map((r) => blockContentToPlainText(r.content)).filter(Boolean).join('\n')
}

/** Rewrite the index row for one page. Safe to call for a page that no longer exists. */
export function reindexPage(pageId: string): void {
  if (!ftsAvailable) return
  db.prepare('DELETE FROM page_fts WHERE page_id = ?').run(pageId)
  const page = db.prepare('SELECT title FROM pages WHERE id = ?').get(pageId) as
    | { title: string }
    | undefined
  if (!page) return
  db.prepare('INSERT INTO page_fts (page_id, title, body) VALUES (?, ?, ?)').run(
    pageId,
    page.title || '',
    buildPageBody(pageId)
  )
}

/** Drop and rebuild the whole index. Returns the number of pages indexed. */
export function rebuildSearchIndex(): number {
  if (!ftsAvailable) return 0
  const trx = db.transaction(() => {
    db.prepare('DELETE FROM page_fts').run()
    const rows = db.prepare('SELECT id, title FROM pages').all() as
      { id: string; title: string }[]
    const insert = db.prepare('INSERT INTO page_fts (page_id, title, body) VALUES (?, ?, ?)')
    for (const row of rows) {
      insert.run(row.id, row.title || '', buildPageBody(row.id))
    }
    return rows.length
  })
  return trx()
}

/**
 * Turn free-typed input into a valid FTS5 MATCH expression.
 *
 * Splitting on non-alphanumerics mirrors how the unicode61 tokenizer built the
 * index. Every token is quoted (with embedded quotes doubled) so no user input
 * can be read as FTS5 operator syntax, and each gets a prefix wildcard so
 * search-as-you-type matches partial words.
 */
function toMatchQuery(raw: string): string | null {
  const tokens = raw.split(/[^\p{L}\p{N}_]+/u).filter(Boolean)
  if (tokens.length === 0) return null
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ')
}

/** Wrap occurrences of any token in `text` with the snippet sentinels. */
function markTokens(text: string, tokens: string[]): string {
  if (!text || tokens.length === 0) return text
  const pattern = tokens
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length)
    .join('|')
  return text.replace(new RegExp(pattern, 'giu'), (m) => `${MARK_OPEN}${m}${MARK_CLOSE}`)
}

function likeFallback(query: string, limit: number): SearchResult[] {
  const tokens = query.split(/[^\p{L}\p{N}_]+/u).filter(Boolean)
  const rows = (db.prepare(`
    SELECT DISTINCT p.* FROM pages p
    LEFT JOIN blocks b ON b.page_id = p.id
    WHERE p.is_deleted = 0 AND p.is_archived = 0
      AND (p.title LIKE ? OR b.content LIKE ?)
    ORDER BY p.updated_at DESC
    LIMIT ?
  `).all(`%${query}%`, `%${query}%`, limit) as unknown[]).map(mapPage)

  return rows.map((page) => ({
    page,
    titleMarked: markTokens(page.title || 'Untitled', tokens),
    bodySnippet: null,
  }))
}

/**
 * Full-text search across page titles and block content.
 * Title matches are weighted an order of magnitude above body matches.
 */
export function searchPages(query: string, limit = 50): SearchResult[] {
  if (!query.trim()) return []
  if (!ftsAvailable) return likeFallback(query, limit)

  const match = toMatchQuery(query)
  if (!match) return []
  const tokens = query.split(/[^\p{L}\p{N}_]+/u).filter(Boolean)

  let rows: Record<string, unknown>[]
  try {
    rows = db.prepare(`
      SELECT p.*,
             snippet(page_fts, 2, ?, ?, '…', 12) AS body_snippet
      FROM page_fts
      JOIN pages p ON p.id = page_fts.page_id
      WHERE page_fts MATCH ?
        AND p.is_deleted = 0
        AND p.is_archived = 0
      ORDER BY bm25(page_fts, 0.0, 10.0, 1.0) ASC, p.updated_at DESC
      LIMIT ?
    `).all(MARK_OPEN, MARK_CLOSE, match, limit) as Record<string, unknown>[]
  } catch (err) {
    // A malformed MATCH expression should never take search down.
    console.error('[nexus] FTS query failed, falling back to LIKE:', err)
    return likeFallback(query, limit)
  }

  return rows.map((row) => {
    const { body_snippet, ...pageRow } = row
    const page = mapPage(pageRow)
    const snippet = typeof body_snippet === 'string' ? body_snippet.trim() : ''
    return {
      page,
      titleMarked: markTokens(page.title || 'Untitled', tokens),
      // Only surface a body preview when it actually contains a hit — FTS5
      // otherwise returns the opening words of the column, which is noise for
      // a title-only match.
      bodySnippet: snippet.includes(MARK_OPEN) ? snippet : null,
    }
  })
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
  reindexPage(id)
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

  // Body text is untouched here; only a title edit changes the index.
  if ('title' in data) reindexPage(id)
}

export function softDeletePage(id: string): void {
  db.prepare('UPDATE pages SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), id)
}

export function restorePage(id: string): void {
  db.prepare('UPDATE pages SET is_deleted = 0, updated_at = ? WHERE id = ?').run(now(), id)
}

export function hardDeletePage(id: string): void {
  db.prepare('DELETE FROM pages WHERE id = ?').run(id)
  if (ftsAvailable) db.prepare('DELETE FROM page_fts WHERE page_id = ?').run(id)
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

  reindexPage(newId)
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

    // Reindex inside the transaction so the index can never describe a state
    // the blocks table never had.
    reindexPage(pageId)
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
