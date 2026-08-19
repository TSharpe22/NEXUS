/**
 * Exercises the first-build → current-build database migration against a
 * throwaway file built to match the old schema exactly.
 *
 *   node scripts/check-migration.mjs
 *
 * Run outside Electron on purpose: `src/main/schema.ts` has no electron
 * import, so the migration can be checked without launching the app.
 */
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { build } from 'esbuild'
import { pathToFileURL } from 'url'

const dir = mkdtempSync(join(tmpdir(), 'nexus-migration-'))
const dbPath = join(dir, 'nexus.db')
const bundlePath = join(dir, 'schema.mjs')

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`)
  if (!ok) console.log(`         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`)
}

// ------------------------------------------------------------------
// Build a database shaped exactly like the first build's.
// ------------------------------------------------------------------
const legacy = new Database(dbPath)
legacy.pragma('journal_mode = WAL')
legacy.exec(`
  CREATE TABLE types (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, icon TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO types (id, name, icon) VALUES ('note', 'Note', '📝');
  INSERT INTO types (id, name, icon) VALUES ('book', 'Book', NULL);

  CREATE TABLE pages (
    id TEXT PRIMARY KEY,
    type_id TEXT NOT NULL DEFAULT 'note' REFERENCES types(id),
    title TEXT NOT NULL DEFAULT '', icon TEXT, cover TEXT,
    is_archived INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    page_width TEXT NOT NULL DEFAULT '720'
  );

  CREATE TABLE blocks (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    parent_block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
    block_type TEXT NOT NULL DEFAULT 'paragraph',
    content TEXT, sort_order REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE property_definitions (
    id TEXT PRIMARY KEY,
    type_id TEXT NOT NULL REFERENCES types(id) ON DELETE CASCADE,
    name TEXT NOT NULL, property_type TEXT NOT NULL, config TEXT,
    sort_order REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(type_id, name)
  );

  CREATE TABLE property_values (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    property_def_id TEXT NOT NULL REFERENCES property_definitions(id) ON DELETE CASCADE,
    value_text TEXT, value_number REAL, value_date TEXT,
    value_boolean INTEGER, value_json TEXT,
    UNIQUE(page_id, property_def_id)
  );

  CREATE TABLE links (
    id TEXT PRIMARY KEY,
    source_page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    target_page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    context TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_page_id, target_page_id)
  );
`)

legacy
  .prepare(`INSERT INTO pages (id, type_id, title, page_width, is_archived, is_deleted) VALUES (?,?,?,?,?,?)`)
  .run('p1', 'note', 'Chemistry', 'wide', 0, 0)
legacy
  .prepare(`INSERT INTO pages (id, type_id, title, page_width, is_archived, is_deleted) VALUES (?,?,?,?,?,?)`)
  .run('p2', 'book', 'Archived one', '900', 1, 0)
legacy
  .prepare(`INSERT INTO pages (id, type_id, title, page_width, is_archived, is_deleted) VALUES (?,?,?,?,?,?)`)
  .run('p3', 'note', 'Empty page', 'default', 0, 0)

const insBlock = legacy.prepare(
  `INSERT INTO blocks (id, page_id, block_type, content, sort_order) VALUES (?,?,?,?,?)`
)
insBlock.run('b1', 'p1', 'heading', JSON.stringify({ id: 'b1', type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: 'Alkanes', styles: {} }] }), 0)
insBlock.run('b2', 'p1', 'paragraph', JSON.stringify({ id: 'b2', type: 'paragraph', content: [{ type: 'text', text: 'Body text', styles: {} }] }), 1)
// A multi-column block — dropped from this build's schema, must be unwrapped.
insBlock.run('b3', 'p1', 'columnList', JSON.stringify({
  id: 'b3', type: 'columnList', children: [
    { id: 'c1', type: 'column', props: { width: 1 }, children: [{ id: 'c1a', type: 'paragraph', content: [{ type: 'text', text: 'left col', styles: {} }] }] },
    { id: 'c2', type: 'column', props: { width: 1 }, children: [{ id: 'c2a', type: 'paragraph', content: [{ type: 'text', text: 'right col', styles: {} }] }] }
  ]
}), 2)
// A corrupt row must not abort the migration.
insBlock.run('b4', 'p1', 'paragraph', '{not json', 3)

legacy.prepare(`INSERT INTO property_definitions (id, type_id, name, property_type, sort_order) VALUES (?,?,?,?,?)`).run('d1', 'note', 'Due Date', 'date', 0)
legacy.prepare(`INSERT INTO property_definitions (id, type_id, name, property_type, sort_order) VALUES (?,?,?,?,?)`).run('d2', 'note', 'Done', 'boolean', 1)
legacy.prepare(`INSERT INTO property_definitions (id, type_id, name, property_type, sort_order) VALUES (?,?,?,?,?)`).run('d3', 'note', 'Tags', 'multi_select', 2)

legacy.prepare(`INSERT INTO property_values (id, page_id, property_def_id, value_date) VALUES (?,?,?,?)`).run('v1', 'p1', 'd1', '2026-01-15')
legacy.prepare(`INSERT INTO property_values (id, page_id, property_def_id, value_boolean) VALUES (?,?,?,?)`).run('v2', 'p1', 'd2', 1)
legacy.prepare(`INSERT INTO property_values (id, page_id, property_def_id, value_json) VALUES (?,?,?,?)`).run('v3', 'p1', 'd3', '["organic","exam"]')

legacy.prepare(`INSERT INTO links (id, source_page_id, target_page_id, context) VALUES (?,?,?,?)`).run('l1', 'p1', 'p3', 'see also')
legacy.close()

// ------------------------------------------------------------------
// Run the real migration.
// ------------------------------------------------------------------
await build({
  entryPoints: ['src/main/schema.ts'],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['better-sqlite3']
})
const { applySchema } = await import(pathToFileURL(bundlePath).href)

const db = new Database(dbPath)
db.pragma('foreign_keys = OFF')
let backupCalls = 0
applySchema(db, () => {
  backupCalls++
  return '/tmp/fake-backup'
})
db.pragma('foreign_keys = ON')

// ------------------------------------------------------------------
// Assertions.
// ------------------------------------------------------------------
console.log('\nmigration from first-build schema:')
check('backup taken before migrating', backupCalls, 1)
check('user_version stamped', db.pragma('user_version', { simple: true }), 5)
check('legacy blocks table dropped', db.prepare(`SELECT count(*) c FROM sqlite_master WHERE name='blocks'`).get().c, 0)
check('legacy property_values dropped', db.prepare(`SELECT count(*) c FROM sqlite_master WHERE name='property_values'`).get().c, 0)
check('activity_log created', db.prepare(`SELECT count(*) c FROM sqlite_master WHERE name='activity_log'`).get().c, 1)

const p1 = db.prepare('SELECT * FROM pages WHERE id = ?').get('p1')
const content = JSON.parse(p1.content)
check('page content assembled from blocks', content.length, 4)
check('block order preserved', content.map((b) => b.type), ['heading', 'paragraph', 'paragraph', 'paragraph'])
check('column contents unwrapped, not dropped', [content[2].content[0].text, content[3].content[0].text], ['left col', 'right col'])
check('page_width preset coerced to number', p1.page_width, 900)
check('page_width is a JS number', typeof p1.page_width, 'number')
check('cover/is_archived columns gone', db.pragma('table_info(pages)').map((c) => c.name), ['id', 'type_id', 'title', 'icon', 'content', 'page_width', 'is_deleted', 'created_at', 'updated_at', 'folder_id'])

// v3 — organisation tables. Additive, so they have to appear on a migrated
// first-build file just as they do on a fresh one.
check('folders table created', db.prepare(`SELECT count(*) c FROM sqlite_master WHERE name='folders'`).get().c, 1)
check('tags table created', db.prepare(`SELECT count(*) c FROM sqlite_master WHERE name='tags'`).get().c, 1)
check('page_tags table created', db.prepare(`SELECT count(*) c FROM sqlite_master WHERE name='page_tags'`).get().c, 1)
check('migrated pages start at the folder root', db.prepare('SELECT count(*) c FROM pages WHERE folder_id IS NOT NULL').get().c, 0)

// v4 — the full-text index. Also additive, and derived: the table has to exist
// after migrating, but stays empty until repo.ensureSearchIndex() fills it at
// startup, so an empty index here is the expected state and not a failure.
check('page_fts table created', db.prepare(`SELECT count(*) c FROM sqlite_master WHERE name='page_fts'`).get().c, 1)

// v5 — settings and the vault mirror manifest. Additive as well.
check('settings table created', db.prepare(`SELECT count(*) c FROM sqlite_master WHERE name='settings'`).get().c, 1)
check('mirror_files table created', db.prepare(`SELECT count(*) c FROM sqlite_master WHERE name='mirror_files'`).get().c, 1)
check('page_fts is queryable', (() => {
  try {
    db.prepare(`SELECT count(*) c FROM page_fts WHERE page_fts MATCH 'x'`).get()
    return true
  } catch {
    return false
  }
})(), true)

check('archived page folded into trash', db.prepare('SELECT is_deleted FROM pages WHERE id = ?').get('p2').is_deleted, 1)
check('page with no blocks gets empty doc', db.prepare('SELECT content FROM pages WHERE id = ?').get('p3').content, '[]')
check('all pages carried over', db.prepare('SELECT count(*) c FROM pages').get().c, 3)

const defs = db.prepare('SELECT * FROM property_definitions ORDER BY sort_order').all()
check('definitions keyed by slug', defs.map((d) => d.key), ['due_date', 'done', 'tags'])
check('definition names preserved', defs.map((d) => d.name), ['Due Date', 'Done', 'Tags'])

const props = db.prepare('SELECT * FROM properties WHERE page_id = ? ORDER BY key').all('p1')
check('property values rekeyed', props.map((p) => p.key), ['done', 'due_date', 'tags'])
check('boolean value became text', props.find((p) => p.key === 'done').value_text, 'true')
check('date value preserved', props.find((p) => p.key === 'due_date').value_date, '2026-01-15')
check('json value became text', props.find((p) => p.key === 'tags').value_text, '["organic","exam"]')

check('links survived the pages rebuild', db.prepare('SELECT count(*) c FROM links').get().c, 1)
check('foreign keys still satisfied', db.pragma('foreign_key_check'), [])

// ------------------------------------------------------------------
// Re-running must be a no-op, and a fresh file must work.
// ------------------------------------------------------------------
backupCalls = 0
applySchema(db, () => {
  backupCalls++
  return null
})
check('second run takes no backup', backupCalls, 0)
check('second run leaves data intact', db.prepare('SELECT count(*) c FROM pages').get().c, 3)
db.close()

console.log('\nfresh database:')
const freshPath = join(dir, 'fresh.db')
const fresh = new Database(freshPath)
fresh.pragma('foreign_keys = OFF')
let freshBackups = 0
applySchema(fresh, () => {
  freshBackups++
  return null
})
fresh.pragma('foreign_keys = ON')
check('no backup taken for a new file', freshBackups, 0)
check('base Note type seeded', fresh.prepare('SELECT name FROM types').all().map((t) => t.name), ['Note'])
check('pages table usable', (() => {
  fresh.prepare(`INSERT INTO pages (id, type_id, title, content) VALUES ('x','note','Hi','[]')`).run()
  return fresh.prepare('SELECT content FROM pages WHERE id = ?').get('x').content
})(), '[]')
fresh.close()

rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
