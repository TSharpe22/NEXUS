import type Database from 'better-sqlite3'

/**
 * Schema definition and forward-migration for the Nexus database.
 *
 * Kept free of any `electron` import so it can be exercised directly against a
 * throwaway file — see `scripts/check-migration.mjs`.
 */

let db: Database.Database

/**
 * Bump this when the schema changes in a way an existing database file has to
 * be brought forward for. `user_version` on the file is compared against it at
 * startup.
 *
 * 1 — first build: `blocks` rows per page, `property_values` keyed by
 *     property_def_id, no `pages.content`.
 * 2 — this build: BlockNote document stored as one JSON blob on
 *     `pages.content`, `properties` keyed by (page_id, key), `activity_log`.
 * 3 — organisation: `folders` tree with `pages.folder_id`, first-class
 *     `tags` / `page_tags`. Purely additive — a v2 file needs no rebuild,
 *     only the new tables and one ALTER.
 * 4 — `page_fts`: FTS5 index over page titles and body text, so search
 *     reaches note content and not just titles. Purely additive, and the
 *     index is a derived projection — it is rebuilt from `pages` whenever
 *     it is missing or empty, so losing it costs nothing.
 * 5 — vault mirror: a `settings` key/value table, and `mirror_files`, the
 *     manifest of files the mirror has written. Purely additive.
 * 6 — relation values move to the column they were always meant to live in.
 *     `setProperty` wrote every string to `value_text` regardless of type,
 *     while the properties panel read `value_relation` — so a relation saved,
 *     and then read back empty. No structural change; this step is the data
 *     repair for files written by that code.
 * 7 — templates: `types.template_page_id`, the page a new page of that type
 *     starts from. Purely additive. Built as 6 on its own branch, but 6 had
 *     already shipped as the relation repair — a version number that means two
 *     different things to two databases is not recoverable, so it became 7.
 * 8 — the tracker: `tasks`, one row per checkbox block in a page's document.
 *     Purely additive, and a derived projection like `page_fts` — it is
 *     rebuilt from `pages` whenever it is missing or empty, so losing it
 *     costs nothing and no user data lives here.
 * 9 — `links` gains `source` ('mention' | 'relation') and `property_key`, so
 *     a relation property can contribute a backlink without the next content
 *     save wiping it: `syncLinks` deletes what is not in the document, and
 *     before this it could not tell a relation's row from a stale mention.
 *     The table is dropped and recreated rather than altered — it is derived
 *     from documents and properties, so nothing is lost, and
 *     `repo.ensureLinkIndex()` refills it at startup.
 */
export const SCHEMA_VERSION = 9

const CURRENT_SCHEMA = `
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

  -- Folders: a tree for organising pages in the Notes list. A page sits in at
  -- most one folder (pages.folder_id); folders nest via parent_folder_id.
  --
  -- ON DELETE SET NULL on both references means removing a folder can never
  -- cascade into losing pages — worst case they surface at the root.
  -- deleteFolder() in repo.ts reparents explicitly so they land somewhere
  -- deliberate instead.
  CREATE TABLE IF NOT EXISTS folders (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    parent_folder_id  TEXT REFERENCES folders(id) ON DELETE SET NULL,
    sort_order        REAL NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_folder_id);

  CREATE TABLE IF NOT EXISTS pages (
    id          TEXT PRIMARY KEY,
    type_id     TEXT NOT NULL DEFAULT 'note' REFERENCES types(id),
    title       TEXT NOT NULL DEFAULT '',
    icon        TEXT,
    content     TEXT NOT NULL DEFAULT '[]',
    page_width  INTEGER NOT NULL DEFAULT 720,
    folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
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

  -- Backlinks, from two places a page can point at another.
  --
  -- source = 'mention'  — a [[wiki-link]] in the body. context is the text
  --                       around it; property_key is ''.
  -- source = 'relation' — a relation property. property_key is the property
  --                       it came from; context is NULL.
  --
  -- The discriminator is what lets the two be projected independently: a
  -- content save rewrites only this page's mentions, and setting a property
  -- rewrites only its relations. Without it, saving the body deleted the
  -- relation's row, because it was not in the document's mention set.
  --
  -- property_key is NOT NULL with an empty default rather than nullable, so
  -- the unique constraint actually holds for mentions — SQLite treats NULLs
  -- as distinct, which would have allowed one mention to be recorded twice.
  -- A page relating to the same target through two properties is two rows,
  -- which is the point of having the key in the key.
  CREATE TABLE IF NOT EXISTS links (
    id              TEXT PRIMARY KEY,
    source_page_id  TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    target_page_id  TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    source          TEXT NOT NULL DEFAULT 'mention',
    property_key    TEXT NOT NULL DEFAULT '',
    context         TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_page_id, target_page_id, source, property_key)
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


  -- Tags are deliberately their own tables rather than a multi_select
  -- property. Properties are schema-per-type: tagging a page through one
  -- means first defining a property on its type, which is the wrong amount of
  -- ceremony for "mark this note as reading". Structured multi-selects still
  -- exist for data that genuinely belongs to a type.
  CREATE TABLE IF NOT EXISTS tags (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT 'accent',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Case-insensitive so "Reading" and "reading" can't split into two tags.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name ON tags(name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS page_tags (
    page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (page_id, tag_id)
  );

  CREATE INDEX IF NOT EXISTS idx_page_tags_tag ON page_tags(tag_id);


  -- One row per checkbox block in a page's document. A projection, not a
  -- store: the block inside pages.content is the source of truth and this is
  -- only a queryable index of it, rebuilt by repo.projectDocument on every
  -- write to a page's body. Nothing here may be the only copy of anything
  -- the user typed.
  --
  -- Keyed by (page_id, block_id) because BlockNote block ids are stable
  -- across saves, which is what lets a row survive an edit to the block
  -- above it. completed_at is the one field with no counterpart in the
  -- document — the block records *that* it is checked, never when — so the
  -- projector carries it forward across a reprojection.
  CREATE TABLE IF NOT EXISTS tasks (
    page_id      TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    block_id     TEXT NOT NULL,
    text         TEXT NOT NULL DEFAULT '',
    is_done      INTEGER NOT NULL DEFAULT 0,
    due_date     TEXT,
    completed_at TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (page_id, block_id)
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
  CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(is_done);
`

// ============================================================
// Migration
// ============================================================

function tableExists(name: string): boolean {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)
}

function columnExists(table: string, column: string): boolean {
  if (!tableExists(table)) return false
  const cols = db.pragma(`table_info(${table})`) as { name: string }[]
  return cols.some((c) => c.name === column)
}

/**
 * The first build stored a page's body as rows in `blocks` and never had a
 * `pages.content` column. That single check is an unambiguous marker — a
 * database that has `pages` but no `content` on it can only have come from
 * the old build.
 */
function isLegacySchema(): boolean {
  return tableExists('pages') && !columnExists('pages', 'content')
}

/** Block types the current schema knows how to render. */
const KNOWN_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'quote',
  'codeBlock',
  'table',
  'image',
  'video',
  'audio',
  'file',
  'toggle',
  'callout'
])

interface LegacyBlock {
  id?: string
  type?: string
  props?: Record<string, unknown>
  content?: unknown
  children?: LegacyBlock[]
}

/**
 * The first build had multi-column layout blocks (`column` / `columnList`)
 * that this build deliberately dropped. BlockNote throws on a document
 * containing block types absent from its schema, so columns are unwrapped
 * into their contents and anything else unrecognised becomes a paragraph —
 * text survives, layout does not.
 */
function sanitizeBlocks(blocks: LegacyBlock[]): LegacyBlock[] {
  const out: LegacyBlock[] = []

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue

    const children = Array.isArray(block.children) ? sanitizeBlocks(block.children) : []

    if (block.type === 'column' || block.type === 'columnList') {
      // A column has no content of its own — its children are the real blocks.
      out.push(...children)
      continue
    }

    if (!block.type || !KNOWN_BLOCK_TYPES.has(block.type)) {
      out.push({ type: 'paragraph', content: block.content ?? [], children })
      continue
    }

    out.push({ ...block, children })
  }

  return out
}

/** Legacy `page_width` was TEXT and could hold a preset name. */
const LEGACY_WIDTH_MAP: Record<string, number> = { narrow: 640, default: 720, wide: 900, full: 0 }

function coercePageWidth(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') {
    if (raw in LEGACY_WIDTH_MAP) return LEGACY_WIDTH_MAP[raw]
    const n = parseInt(raw, 10)
    if (!Number.isNaN(n)) return n
  }
  return 720
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'property'
  )
}

function migrateFromV1(): void {
  const run = db.transaction(() => {
    migratePages()
    migratePropertyDefinitions()
    migratePropertyValues()
    db.exec('DROP TABLE IF EXISTS blocks')
    db.exec('DROP TABLE IF EXISTS property_values')
  })
  run()
}

/**
 * Rebuild `pages` in the current shape, folding each page's `blocks` rows
 * into a single `content` JSON blob. Rebuilt rather than ALTER'd because the
 * old table also carries `cover`/`is_archived` columns this build doesn't
 * use, and its `page_width` has TEXT affinity.
 */
function migratePages(): void {
  const contentByPage = new Map<string, string>()

  if (tableExists('blocks')) {
    const rows = db
      .prepare('SELECT page_id, content FROM blocks ORDER BY page_id, sort_order')
      .all() as { page_id: string; content: string | null }[]

    const grouped = new Map<string, LegacyBlock[]>()
    for (const row of rows) {
      if (!row.content) continue
      let parsed: LegacyBlock | null = null
      try {
        parsed = JSON.parse(row.content) as LegacyBlock
      } catch {
        // A block row that isn't valid JSON is unrecoverable — skip it rather
        // than abort the whole migration over one corrupt row.
        continue
      }
      if (!parsed) continue
      const list = grouped.get(row.page_id) ?? []
      list.push(parsed)
      grouped.set(row.page_id, list)
    }

    for (const [pageId, blocks] of grouped) {
      contentByPage.set(pageId, JSON.stringify(sanitizeBlocks(blocks)))
    }
  }

  const legacyPages = db.prepare('SELECT * FROM pages').all() as Record<string, unknown>[]

  db.exec(`
    CREATE TABLE pages_migrated (
      id          TEXT PRIMARY KEY,
      type_id     TEXT NOT NULL DEFAULT 'note' REFERENCES types(id),
      title       TEXT NOT NULL DEFAULT '',
      icon        TEXT,
      content     TEXT NOT NULL DEFAULT '[]',
      page_width  INTEGER NOT NULL DEFAULT 720,
      is_deleted  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const insert = db.prepare(
    `INSERT INTO pages_migrated
       (id, type_id, title, icon, content, page_width, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  for (const page of legacyPages) {
    const id = String(page.id)
    insert.run(
      id,
      (page.type_id as string) || 'note',
      (page.title as string) ?? '',
      (page.icon as string) ?? null,
      contentByPage.get(id) ?? '[]',
      coercePageWidth(page.page_width),
      // The old build had a separate `is_archived`; fold it into the trash so
      // archived pages don't silently vanish from every view.
      Number(page.is_deleted) === 1 || Number(page.is_archived) === 1 ? 1 : 0,
      (page.created_at as string) ?? new Date().toISOString().replace('T', ' ').split('.')[0],
      (page.updated_at as string) ?? new Date().toISOString().replace('T', ' ').split('.')[0]
    )
  }

  db.exec('DROP TABLE pages')
  db.exec('ALTER TABLE pages_migrated RENAME TO pages')
  db.exec('CREATE INDEX IF NOT EXISTS idx_pages_type ON pages(type_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_pages_deleted ON pages(is_deleted)')
}

/**
 * Legacy definitions were identified by display name; this build keys them by
 * a slug so a property can be renamed without orphaning its values. The
 * legacy row id is preserved so `property_values` can still be joined.
 */
function migratePropertyDefinitions(): void {
  if (!tableExists('property_definitions')) return
  if (columnExists('property_definitions', 'key')) return

  const legacy = db.prepare('SELECT * FROM property_definitions').all() as Record<string, unknown>[]

  db.exec(`
    CREATE TABLE propdefs_migrated (
      id             TEXT PRIMARY KEY,
      type_id        TEXT NOT NULL REFERENCES types(id) ON DELETE CASCADE,
      key            TEXT NOT NULL,
      name           TEXT NOT NULL,
      property_type  TEXT NOT NULL,
      sort_order     REAL NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type_id, key)
    )
  `)

  const insert = db.prepare(
    `INSERT OR IGNORE INTO propdefs_migrated
       (id, type_id, key, name, property_type, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )

  for (const def of legacy) {
    const name = String(def.name ?? 'Property')
    insert.run(
      String(def.id),
      String(def.type_id),
      slugify(name),
      name,
      String(def.property_type ?? 'text'),
      Number(def.sort_order ?? 0),
      (def.created_at as string) ?? new Date().toISOString().replace('T', ' ').split('.')[0]
    )
  }

  db.exec('DROP TABLE property_definitions')
  db.exec('ALTER TABLE propdefs_migrated RENAME TO property_definitions')
  db.exec('CREATE INDEX IF NOT EXISTS idx_propdefs_type ON property_definitions(type_id)')
}

/**
 * `property_values` (keyed by property_def_id) becomes `properties` (keyed by
 * the definition's slug), so a page's property values can be read without
 * joining through its type.
 */
function migratePropertyValues(): void {
  if (!tableExists('property_values')) return

  db.exec(`
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
    )
  `)

  const rows = db
    .prepare(
      `SELECT v.id, v.page_id, d.key, d.property_type,
              v.value_text, v.value_number, v.value_date, v.value_boolean, v.value_json
       FROM property_values v
       JOIN property_definitions d ON d.id = v.property_def_id`
    )
    .all() as Record<string, unknown>[]

  const insert = db.prepare(
    `INSERT OR IGNORE INTO properties
       (id, page_id, key, type, value_text, value_number, value_date, value_relation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )

  for (const row of rows) {
    // Booleans and JSON collapse into value_text — this build stores
    // checkboxes as 'true'/'false' and multi-selects as a JSON array string.
    let valueText = (row.value_text as string) ?? null
    if (row.value_boolean != null) valueText = Number(row.value_boolean) === 1 ? 'true' : 'false'
    else if (row.value_json != null) valueText = String(row.value_json)

    insert.run(
      String(row.id),
      String(row.page_id),
      String(row.key),
      String(row.property_type ?? 'text'),
      valueText,
      row.value_number ?? null,
      (row.value_date as string) ?? null,
      null
    )
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_properties_page ON properties(page_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_properties_key ON properties(key)')
}

/**
 * Bring `database` up to the current schema, migrating a first-build file
 * forward if that's what it turns out to be. Returns the path of the backup
 * written before any destructive step, or null when nothing needed migrating.
 *
 * The caller is responsible for pragmas; foreign keys must be OFF on entry
 * (a table rebuild drops and recreates tables other tables reference) and are
 * the caller's to switch back on afterwards.
 */
export function applySchema(
  database: Database.Database,
  backup: (reason: string) => string | null
): string | null {
  db = database

  const version = db.pragma('user_version', { simple: true }) as number
  let backupPath: string | null = null

  if (version < SCHEMA_VERSION && isLegacySchema()) {
    backupPath = backup('legacy schema')
    migrateFromV1()
  }

  // v9. `links` grows a source discriminator, which SQLite cannot add to an
  // existing UNIQUE constraint without rebuilding the table.
  //
  // The rows are copied across rather than dropped and re-derived. They look
  // derived, and for anything this build wrote they are — but a file coming
  // from the first build has links that were extracted by the *old* app from
  // its own block rows, and nothing in the migrated document is guaranteed to
  // still produce them. Re-deriving would quietly delete backlinks the user
  // could see yesterday, which is not a migration's job. Everything carried
  // over is a mention; relations had no way to make a link before now.
  //
  // The second statement is the other half: every relation already stored
  // gets its link immediately, so an existing vault shows relation backlinks
  // on first launch rather than only after each property is touched again.
  // Ids are opaque, and this file stays free of any dependency, so they come
  // from randomblob rather than from uuid.
  if (tableExists('links') && !columnExists('links', 'source')) {
    db.exec(`
      CREATE TABLE links_v9 (
        id              TEXT PRIMARY KEY,
        source_page_id  TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        target_page_id  TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        source          TEXT NOT NULL DEFAULT 'mention',
        property_key    TEXT NOT NULL DEFAULT '',
        context         TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(source_page_id, target_page_id, source, property_key)
      );

      INSERT OR IGNORE INTO links_v9 (id, source_page_id, target_page_id, source, property_key, context, created_at)
        SELECT id, source_page_id, target_page_id, 'mention', '', context, created_at FROM links;

      DROP TABLE links;
      ALTER TABLE links_v9 RENAME TO links;

      INSERT OR IGNORE INTO links (id, source_page_id, target_page_id, source, property_key, context, created_at)
        SELECT lower(hex(randomblob(16))), pr.page_id, pr.value_relation, 'relation', pr.key, NULL, datetime('now')
          FROM properties pr
          JOIN pages p ON p.id = pr.value_relation
         WHERE pr.type = 'relation'
           AND pr.value_relation IS NOT NULL AND pr.value_relation <> '';
    `)
  }

  db.exec(CURRENT_SCHEMA)

  // v3. `folders` is created by CURRENT_SCHEMA above, so the column's
  // reference target exists by the time this runs. Additive, so a v2 file
  // needs no backup and no table rebuild.
  if (!columnExists('pages', 'folder_id')) {
    db.exec(`ALTER TABLE pages ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL`)
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_pages_folder ON pages(folder_id)')

  // v4. Contentless-by-choice: the index stores its own copy of the text so
  // a query needs no join back to `pages` to rank. Additive, and derived —
  // `repo.rebuildSearchIndex()` refills it from `pages` on next startup.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(
      page_id UNINDEXED,
      title,
      body,
      tokenize = "unicode61 remove_diacritics 2"
    );
  `)

  // v5. General key/value settings, and the vault mirror's manifest.
  //
  // `mirror_files` deliberately has no foreign key to `pages`: the row must
  // outlive the page it describes, otherwise deleting a page would drop the
  // manifest row before the mirror could clean up the orphaned file on disk.
  // The mirror only ever deletes paths recorded here, so a file the user put
  // in the folder themselves is never touched.
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS mirror_files (
      page_id  TEXT PRIMARY KEY,
      rel_path TEXT NOT NULL
    );
  `)

  // v6. Relation values written into `value_text` by the old `setProperty`
  // move to `value_relation`, which is where every reader looks for them.
  // Guarded on the stored version rather than run every startup: it is a data
  // repair, not a structural step, and there is nothing to re-repair once a
  // file has been through it.
  if (version < 6) {
    db.exec(`
      UPDATE properties
         SET value_relation = value_text, value_text = NULL
       WHERE type = 'relation' AND value_relation IS NULL AND value_text IS NOT NULL
    `)
  }

  // v7. A type's default template. ON DELETE SET NULL so deleting the template
  // page leaves the type intact and simply un-templated, rather than cascading
  // into the type and taking every page of it along. Additive and idempotent,
  // so it lands on a file already stamped 6 by the step above.
  if (!columnExists('types', 'template_page_id')) {
    db.exec(
      `ALTER TABLE types ADD COLUMN template_page_id TEXT REFERENCES pages(id) ON DELETE SET NULL`
    )
  }

  // v8. `tasks` is created by CURRENT_SCHEMA above, so nothing structural is
  // left to do here. Like `page_fts` it is derived — `repo.ensureTaskIndex()`
  // fills it from `pages` at startup when it is missing or empty, which is
  // also how an existing file picks up every checkbox already written.

  db.pragma(`user_version = ${SCHEMA_VERSION}`)

  return backupPath
}
