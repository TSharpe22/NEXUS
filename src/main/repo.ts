import { v4 as uuidv4 } from 'uuid'
import { getDb, getDbPath } from './database'
import { journalEntryTitle, localDateISO } from '@shared/journal-date'
import { extractLinkTargets, parseDocument } from '@shared/document'
import { statSync } from 'fs'
import type {
  Page,
  Property,
  PropertyType,
  BacklinkResult,
  LinkTarget,
  ActivityLogEntry,
  StorageStats,
  PageSummary,
  GraphPreview,
  GraphData,
  GraphNode,
  GraphEdge,
  TypeDef,
  PropertyDefinition,
  Folder,
  Tag,
  TagWithCount,
  SearchResult
} from '../shared/types'

const now = () => new Date().toISOString().replace('T', ' ').split('.')[0]

// ============================================================
// Pages
// ============================================================

/**
 * The value a property holds, whichever of the sparse columns it lives in.
 *
 * Every copier needs this, and each one had written its own version that
 * forgot `value_relation` — so duplicating a page, or creating one from a
 * template, silently dropped its relations while copying everything else.
 * Mirrors the column routing in `setProperty`, which is the only thing that
 * decides where a value goes.
 */
function propertyValue(prop: Property): string | number | null {
  if (prop.type === 'date') return prop.value_date
  if (prop.type === 'relation') return prop.value_relation
  return prop.value_text ?? prop.value_number
}

export function createPage(typeId: string = 'note', folderId: string | null = null): Page {
  const db = getDb()
  const id = uuidv4()
  const ts = now()

  // A type can name one page as its template; a new page of that type starts
  // from a copy of it. Blank when the type has none, or when the template page
  // has since been deleted.
  const template = getTypeTemplate(typeId)
  const content = template?.content ?? '[]'

  db.prepare(
    `INSERT INTO pages (id, type_id, title, content, folder_id, created_at, updated_at)
     VALUES (?, ?, '', ?, ?, ?, ?)`
  ).run(id, typeId, content, folderId, ts, ts)

  // Property *values* come across too, so a template can carry defaults —
  // a Journal entry's mood left blank, a Trade Log's account pre-filled.
  if (template) {
    for (const prop of getPropertiesForPage(template.id)) {
      const value = propertyValue(prop)
      if (value !== null && value !== undefined && value !== '') {
        setProperty(id, prop.key, prop.type, value)
      }
    }
  }

  reindexPage(id)
  // A template's body can carry mentions and checkboxes of its own, and a page
  // created from one never passes through the editor before it is looked at.
  projectDocument(id)
  logActivity(id, 'created', template ? 'page created from template' : 'page created')
  return getPageById(id)!
}

// ============================================================
// Templates
// ============================================================

/** The page a type's new pages start from, or null. */
export function getTypeTemplate(typeId: string): Page | null {
  const row = getDb()
    .prepare(
      `SELECT p.* FROM types t
       JOIN pages p ON p.id = t.template_page_id
       WHERE t.id = ? AND p.is_deleted = 0`
    )
    .get(typeId) as Page | undefined
  return row ?? null
}

/**
 * Point a type at a template page, or clear it with null.
 *
 * The template is deliberately a page OF the type it templates, which is what
 * lets a per-type picker list candidates. Nothing recurses: creating a page
 * copies the template's content and property values, it never creates from the
 * new page in turn.
 */
export function setTypeTemplate(typeId: string, pageId: string | null): void {
  if (pageId) {
    const page = getPageById(pageId)
    if (!page) throw new Error(`Page not found: ${pageId}`)
  }
  getDb().prepare('UPDATE types SET template_page_id = ? WHERE id = ?').run(pageId, typeId)
}

export function getAllPages(): Page[] {
  return getDb()
    .prepare('SELECT * FROM pages WHERE is_deleted = 0 ORDER BY updated_at DESC')
    .all() as Page[]
}

export function getPagesSummary(typeId?: string): PageSummary[] {
  const db = getDb()
  const rows = (
    typeId
      ? db.prepare('SELECT * FROM pages WHERE is_deleted = 0 AND type_id = ? ORDER BY updated_at DESC').all(typeId)
      : db.prepare('SELECT * FROM pages WHERE is_deleted = 0 ORDER BY updated_at DESC').all()
  ) as Page[]

  if (rows.length === 0) return []

  const placeholders = rows.map(() => '?').join(',')
  const allProps = db
    .prepare(`SELECT * FROM properties WHERE page_id IN (${placeholders})`)
    .all(...rows.map((r) => r.id)) as Property[]

  const byPage = new Map<string, Property[]>()
  for (const prop of allProps) {
    const list = byPage.get(prop.page_id) ?? []
    list.push(prop)
    byPage.set(prop.page_id, list)
  }

  return rows.map((page) => ({ ...page, properties: byPage.get(page.id) ?? [] }))
}

export function getPageById(id: string): Page | null {
  return (getDb().prepare('SELECT * FROM pages WHERE id = ?').get(id) as Page) ?? null
}

export function updatePage(
  id: string,
  data: Partial<Pick<Page, 'title' | 'icon' | 'content' | 'page_width' | 'type_id'>>
): void {
  const db = getDb()
  const allowed = ['title', 'icon', 'content', 'page_width', 'type_id'] as const
  const sets: string[] = []
  const values: unknown[] = []

  for (const key of allowed) {
    if (key in data) {
      sets.push(`${key} = ?`)
      values.push(data[key])
    }
  }
  if (sets.length === 0) return

  sets.push('updated_at = ?')
  values.push(now(), id)
  db.prepare(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`).run(...values)

  // Only the two indexed fields need the index rewritten.
  if ('title' in data || 'content' in data) reindexPage(id)
  if ('content' in data) projectDocument(id)

  if ('title' in data) logActivity(id, 'renamed', `renamed to "${data.title}"`)
  else if ('type_id' in data) logActivity(id, 'retyped', 'type changed')
  else if ('content' in data) logEdit(id)
}

export function softDeletePage(id: string): void {
  getDb().prepare('UPDATE pages SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now(), id)
  logActivity(id, 'deleted', 'moved to trash')
}

export function restorePage(id: string): void {
  getDb().prepare('UPDATE pages SET is_deleted = 0, updated_at = ? WHERE id = ?').run(now(), id)
  logActivity(id, 'restored', 'restored from trash')
}

export function hardDeletePage(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM pages WHERE id = ?').run(id)
  db.prepare('DELETE FROM page_fts WHERE page_id = ?').run(id)
}

export function emptyTrash(): number {
  const db = getDb()
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM pages WHERE is_deleted = 1').get() as { c: number }
  const trx = db.transaction(() => {
    db.prepare(
      'DELETE FROM page_fts WHERE page_id IN (SELECT id FROM pages WHERE is_deleted = 1)'
    ).run()
    db.prepare('DELETE FROM pages WHERE is_deleted = 1').run()
  })
  trx()
  return c
}

export function getDeletedPages(): Page[] {
  return getDb()
    .prepare('SELECT * FROM pages WHERE is_deleted = 1 ORDER BY updated_at DESC')
    .all() as Page[]
}

export function duplicatePage(id: string): Page {
  const db = getDb()
  const source = getPageById(id)
  if (!source) throw new Error(`Page not found: ${id}`)

  const newId = uuidv4()
  const ts = now()
  db.prepare(
    `INSERT INTO pages (id, type_id, title, icon, content, page_width, folder_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId, source.type_id, `${source.title} (copy)`, source.icon, source.content,
    source.page_width, source.folder_id ?? null, ts, ts
  )

  for (const prop of getPropertiesForPage(id)) {
    setProperty(newId, prop.key, prop.type, propertyValue(prop))
  }

  // A copy lands beside the original, in the same folder and with the same tags.
  db.prepare(
    `INSERT INTO page_tags (page_id, tag_id, created_at)
     SELECT ?, tag_id, ? FROM page_tags WHERE page_id = ?`
  ).run(newId, ts, id)

  reindexPage(newId)
  projectDocument(newId)
  return getPageById(newId)!
}

// ============================================================
// Journal
// ============================================================

const JOURNAL_TYPE_NAME = 'Journal'
const JOURNAL_FOLDER_NAME = 'Journal'
const JOURNAL_DATE_KEY = 'date'
const TEMPLATES_FOLDER_NAME = 'Templates'

function findFolderByName(name: string): Folder | null {
  const row = getDb()
    .prepare('SELECT * FROM folders WHERE name = ? AND parent_folder_id IS NULL')
    .get(name) as Folder | undefined
  return row ?? null
}

/** A paragraph/heading block in the shape BlockNote itself round-trips. */
function block(type: string, text: string, level?: number): Record<string, unknown> {
  const props: Record<string, unknown> = {
    textColor: 'default',
    backgroundColor: 'default',
    textAlignment: 'left'
  }
  if (level !== undefined) props.level = level
  return {
    id: uuidv4(),
    type,
    props,
    content: text ? [{ type: 'text', text, styles: {} }] : [],
    children: []
  }
}

/**
 * Ensure the Journal type, its folder, its date property and a starter
 * template all exist. Lazy — nothing is created until the first entry is
 * asked for, so a vault that never journals stays clean.
 */
function ensureJournalSetup(): { typeId: string; folderId: string } {
  const db = getDb()

  let type = db.prepare('SELECT * FROM types WHERE name = ?').get(JOURNAL_TYPE_NAME) as
    | TypeDef
    | undefined
  if (!type) type = createType(JOURNAL_TYPE_NAME)

  if (!getPropertyDefinitions(type.id).some((d) => d.key === JOURNAL_DATE_KEY)) {
    defineProperty(type.id, 'Date', 'date')
  }

  const folder = findFolderByName(JOURNAL_FOLDER_NAME) ?? createFolder(JOURNAL_FOLDER_NAME, null)

  // A starter template, so the feature is visible rather than theoretical.
  // It is an ordinary page — rewrite it, or point the type elsewhere.
  if (!getTypeTemplate(type.id)) {
    const templatesFolder =
      findFolderByName(TEMPLATES_FOLDER_NAME) ?? createFolder(TEMPLATES_FOLDER_NAME, null)
    const templateId = uuidv4()
    const ts = now()
    // The template is a page OF the type it templates, so a per-type picker can
    // list it. It lives in Templates rather than Journal, and carries no date
    // property, so it is never mistaken for an entry.
    db.prepare(
      `INSERT INTO pages (id, type_id, title, content, folder_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      templateId,
      type.id,
      'Journal template',
      JSON.stringify([
        block('heading', 'Today', 2),
        block('paragraph', ''),
        block('heading', 'Done', 2),
        block('paragraph', ''),
        block('heading', 'Notes', 2),
        block('paragraph', '')
      ]),
      templatesFolder.id,
      ts,
      ts
    )
    reindexPage(templateId)
    setTypeTemplate(type.id, templateId)
  }

  return { typeId: type.id, folderId: folder.id }
}

/**
 * Today's journal entry, created from the Journal type's template if it does
 * not exist yet. Matching is on the entry's `date` property rather than its
 * title, so renaming an entry never produces a duplicate for that day.
 */
export function getOrCreateTodayEntry(): Page {
  const { typeId, folderId } = ensureJournalSetup()
  const today = localDateISO()

  const existing = getDb()
    .prepare(
      `SELECT p.* FROM pages p
       JOIN properties pr ON pr.page_id = p.id
       WHERE p.type_id = ? AND p.is_deleted = 0
         AND pr.key = ? AND pr.value_date = ?
       LIMIT 1`
    )
    .get(typeId, JOURNAL_DATE_KEY, today) as Page | undefined
  if (existing) return existing

  const page = createPage(typeId, folderId)
  updatePage(page.id, { title: journalEntryTitle() })
  setProperty(page.id, JOURNAL_DATE_KEY, 'date', today)
  return getPageById(page.id)!
}

// ============================================================
// Settings (key/value) and the vault-mirror manifest
// ============================================================

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string | null }
    | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value)
}

/** Page id to the relative path the mirror last wrote for it. */
export function getMirrorManifest(): Map<string, string> {
  const rows = getDb().prepare('SELECT page_id, rel_path FROM mirror_files').all() as {
    page_id: string
    rel_path: string
  }[]
  return new Map(rows.map((r) => [r.page_id, r.rel_path]))
}

export function replaceMirrorManifest(entries: Map<string, string>): void {
  const db = getDb()
  const insert = db.prepare('INSERT INTO mirror_files (page_id, rel_path) VALUES (?, ?)')
  const trx = db.transaction(() => {
    db.prepare('DELETE FROM mirror_files').run()
    for (const [pageId, relPath] of entries) insert.run(pageId, relPath)
  })
  trx()
}

// ============================================================
// Full-text search
// ============================================================

// Sentinels wrapping matched terms in results. Control codes are used
// deliberately: they cannot occur in real note text, so the renderer can split
// on them without any HTML parsing or escaping.
const SEARCH_MARK_OPEN = '\u0002'
const SEARCH_MARK_CLOSE = '\u0003'

/**
 * Collect the readable strings out of a parsed BlockNote document.
 *
 * Only values under keys named `text`, `content`, or `pageTitle` are taken, so
 * prop values like `textColor: "default"` never enter the index. `pageTitle` is
 * the label a page mention renders, so a page containing [[Chemistry]] stays
 * findable by "chemistry". Walking generically covers table cells and nested
 * children without needing a branch per block type.
 */
function collectText(value: unknown, out: string[]): void {
  if (value === null || value === undefined) return
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out)
    return
  }
  if (typeof value !== 'object') return

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((key === 'text' || key === 'content' || key === 'pageTitle') && typeof child === 'string') {
      if (child) out.push(child)
    } else {
      collectText(child, out)
    }
  }
}

/** Flatten a page's stored BlockNote document to plain text for indexing. */
export function documentToPlainText(content: string | null): string {
  if (!content) return ''
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return content
  }
  const out: string[] = []
  collectText(parsed, out)
  return out.join(' ')
}

/** Rewrite the index row for one page. Safe for a page that no longer exists. */
export function reindexPage(pageId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM page_fts WHERE page_id = ?').run(pageId)
  const page = db.prepare('SELECT title, content FROM pages WHERE id = ?').get(pageId) as
    | { title: string; content: string }
    | undefined
  if (!page) return
  db.prepare('INSERT INTO page_fts (page_id, title, body) VALUES (?, ?, ?)').run(
    pageId,
    page.title || '',
    documentToPlainText(page.content)
  )
}

/**
 * Rebuild every projection derived from a page's body.
 *
 * Called from each path that writes `pages.content` — `updatePage`,
 * `createPage` (a template's body comes across whole) and `duplicatePage` —
 * so a projection can never be more current than the document it came from.
 *
 * Link extraction used to run in the renderer, from `Editor.tsx`, after the
 * save round-tripped. That made a React component the only writer of the link
 * graph, and pages that never mount it — anything created by `io.importJSON`,
 * by a template, by the journal button — contributed no backlinks at all.
 * `reindexPage` was always called from here and never had that problem; this
 * is the same rule applied to the rest.
 */
export function projectDocument(pageId: string): void {
  const row = getDb().prepare('SELECT content FROM pages WHERE id = ?').get(pageId) as
    | { content: string | null }
    | undefined
  if (!row) return
  const blocks = parseDocument(row.content)
  syncLinks(pageId, extractLinkTargets(blocks))
}

/** Drop and rebuild the whole index. Returns the number of pages indexed. */
export function rebuildSearchIndex(): number {
  const db = getDb()
  const trx = db.transaction(() => {
    db.prepare('DELETE FROM page_fts').run()
    const rows = db.prepare('SELECT id, title, content FROM pages').all() as {
      id: string
      title: string
      content: string
    }[]
    const insert = db.prepare('INSERT INTO page_fts (page_id, title, body) VALUES (?, ?, ?)')
    for (const row of rows) insert.run(row.id, row.title || '', documentToPlainText(row.content))
    return rows.length
  })
  return trx()
}

/**
 * Fill the index when it is empty but pages exist — the state right after the
 * v4 migration creates the table, and the self-heal if it is ever lost. Called
 * once at startup.
 */
export function ensureSearchIndex(): void {
  const db = getDb()
  const indexed = (db.prepare('SELECT count(*) AS n FROM page_fts').get() as { n: number }).n
  const total = (db.prepare('SELECT count(*) AS n FROM pages').get() as { n: number }).n
  if (indexed === 0 && total > 0) rebuildSearchIndex()
}

function searchTokens(raw: string): string[] {
  return raw.split(/[^\p{L}\p{N}_]+/u).filter(Boolean)
}

/**
 * Turn free-typed input into a valid FTS5 MATCH expression.
 *
 * Splitting on non-alphanumerics mirrors how the unicode61 tokenizer built the
 * index. Every token is quoted (embedded quotes doubled) so nothing the user
 * types can be read as FTS5 operator syntax, and each gets a prefix wildcard so
 * search-as-you-type matches partial words.
 */
function toMatchQuery(raw: string): string | null {
  const tokens = searchTokens(raw)
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
  return text.replace(
    new RegExp(pattern, 'giu'),
    (m) => `${SEARCH_MARK_OPEN}${m}${SEARCH_MARK_CLOSE}`
  )
}

/**
 * Full-text search across page titles and body text. Title matches are
 * weighted an order of magnitude above body matches; ties fall back to
 * recency, which is common for a single-token body hit.
 */
export function searchPages(query: string, limit = 50): SearchResult[] {
  if (!query.trim()) return []
  const match = toMatchQuery(query)
  if (!match) return []
  const tokens = searchTokens(query)
  const db = getDb()

  let rows: Record<string, unknown>[]
  try {
    rows = db
      .prepare(
        `SELECT p.*, snippet(page_fts, 2, ?, ?, '…', 12) AS body_snippet
         FROM page_fts
         JOIN pages p ON p.id = page_fts.page_id
         WHERE page_fts MATCH ? AND p.is_deleted = 0
         ORDER BY bm25(page_fts, 0.0, 10.0, 1.0) ASC, p.updated_at DESC
         LIMIT ?`
      )
      .all(SEARCH_MARK_OPEN, SEARCH_MARK_CLOSE, match, limit) as Record<string, unknown>[]
  } catch (err) {
    console.error('[nexus] full-text query failed:', err)
    return []
  }

  return rows.map((row) => {
    const { body_snippet, ...pageRow } = row
    const page = pageRow as unknown as Page
    const snippet = typeof body_snippet === 'string' ? body_snippet.trim() : ''
    return {
      page,
      titleMarked: markTokens(page.title || 'Untitled', tokens),
      // Only surface a body preview when it actually contains a hit — FTS5
      // otherwise returns the opening words of the column, which is noise on
      // a title-only match.
      bodySnippet: snippet.includes(SEARCH_MARK_OPEN) ? snippet : null
    }
  })
}

// ============================================================
// Types and property definitions — the user-created schema.
// A page's "shape" is entirely whatever properties have been defined
// on its type; nothing here is predetermined beyond the base 'note' type.
// ============================================================

export function getTypes(): TypeDef[] {
  return getDb().prepare('SELECT * FROM types ORDER BY name').all() as TypeDef[]
}

export function createType(name: string, icon: string | null = null): TypeDef {
  const db = getDb()
  const id = uuidv4()
  db.prepare('INSERT INTO types (id, name, icon) VALUES (?, ?, ?)').run(id, name, icon)
  return db.prepare('SELECT * FROM types WHERE id = ?').get(id) as TypeDef
}

export function renameType(id: string, name: string): TypeDef {
  const db = getDb()
  db.prepare('UPDATE types SET name = ? WHERE id = ?').run(name, id)
  return db.prepare('SELECT * FROM types WHERE id = ?').get(id) as TypeDef
}

/**
 * Deleting a type reassigns its pages to the base 'note' type rather than
 * cascading into them — losing a type's schema should never take the notes
 * with it. Its property definitions do go (they describe the type, not the
 * page), but the values already set on pages are left alone so re-creating
 * the property brings them back.
 */
export function deleteType(id: string): { reassigned: number } {
  if (id === 'note') throw new Error('The base Note type cannot be deleted')

  const db = getDb()
  const trx = db.transaction(() => {
    const { c } = db.prepare('SELECT COUNT(*) AS c FROM pages WHERE type_id = ?').get(id) as { c: number }
    db.prepare(`UPDATE pages SET type_id = 'note' WHERE type_id = ?`).run(id)
    db.prepare('DELETE FROM property_definitions WHERE type_id = ?').run(id)
    db.prepare('DELETE FROM types WHERE id = ?').run(id)
    return { reassigned: c }
  })
  return trx()
}

export function setPageType(pageId: string, typeId: string): void {
  updatePage(pageId, { type_id: typeId })
}

export function getPropertyDefinitions(typeId: string): PropertyDefinition[] {
  return getDb()
    .prepare('SELECT * FROM property_definitions WHERE type_id = ? ORDER BY sort_order, created_at')
    .all(typeId) as PropertyDefinition[]
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

export function defineProperty(typeId: string, name: string, propertyType: PropertyType): PropertyDefinition {
  const db = getDb()
  const key = slugify(name)
  const maxOrder = (
    db.prepare('SELECT MAX(sort_order) AS m FROM property_definitions WHERE type_id = ?').get(typeId) as {
      m: number | null
    }
  ).m
  const id = uuidv4()

  // Two names that slugify to the same key used to overwrite each other's
  // definition: adding "Status" as a number after "Status" as text flipped
  // `property_type` while every stored value stayed in `value_text`, so all of
  // them read back empty. Refuse instead and let the caller say so.
  const clash = db
    .prepare('SELECT name FROM property_definitions WHERE type_id = ? AND key = ?')
    .get(typeId, key) as { name: string } | undefined
  if (clash) throw new Error(`A property named "${clash.name}" already exists on this type`)

  db.prepare(
    `INSERT INTO property_definitions (id, type_id, key, name, property_type, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, typeId, key, name, propertyType, (maxOrder ?? -1) + 1)

  return db.prepare('SELECT * FROM property_definitions WHERE type_id = ? AND key = ?').get(typeId, key) as PropertyDefinition
}

export function renamePropertyDefinition(id: string, name: string): PropertyDefinition {
  const db = getDb()
  // The key is deliberately left alone — it's what already-set values on pages
  // are stored against, so renaming is display-only.
  db.prepare('UPDATE property_definitions SET name = ? WHERE id = ?').run(name, id)
  return db.prepare('SELECT * FROM property_definitions WHERE id = ?').get(id) as PropertyDefinition
}

/** Removes the property from the type's schema and its values from every page of that type. */
export function removePropertyDefinition(id: string): void {
  const db = getDb()
  const def = db.prepare('SELECT type_id, key FROM property_definitions WHERE id = ?').get(id) as
    | { type_id: string; key: string }
    | undefined
  if (!def) return

  const trx = db.transaction(() => {
    db.prepare(
      `DELETE FROM properties
       WHERE key = ? AND page_id IN (SELECT id FROM pages WHERE type_id = ?)`
    ).run(def.key, def.type_id)
    db.prepare('DELETE FROM property_definitions WHERE id = ?').run(id)
  })
  trx()
}

export function reorderPropertyDefinitions(typeId: string, orderedIds: string[]): void {
  const db = getDb()
  const update = db.prepare('UPDATE property_definitions SET sort_order = ? WHERE id = ? AND type_id = ?')
  const trx = db.transaction(() => {
    orderedIds.forEach((id, index) => update.run(index, id, typeId))
  })
  trx()
}

// ============================================================
// Properties — the actual values on a page, per the property
// definitions of that page's type.
// ============================================================

export function getPropertiesForPage(pageId: string): Property[] {
  return getDb().prepare('SELECT * FROM properties WHERE page_id = ?').all(pageId) as Property[]
}

/** Writes the value and returns the row as stored, so the caller never has to
 *  guess which of the sparse columns it landed in. */
export function setProperty(
  pageId: string,
  key: string,
  type: PropertyType,
  value: string | number | null
): Property {
  const db = getDb()
  const id = uuidv4()
  const text = typeof value === 'string' ? value : null
  // A relation is the id of another page, and every reader — the panel, the
  // Tables cell, the mirror's frontmatter — looks for it in `value_relation`.
  // This wrote it to `value_text` along with everything else, so a relation
  // saved and then read back empty every time.
  const valueRelation = type === 'relation' ? text : null
  const valueText = type === 'date' || type === 'relation' ? null : text
  const valueNumber = typeof value === 'number' ? value : null
  const valueDate = type === 'date' ? text : null

  const read = db.prepare('SELECT * FROM properties WHERE page_id = ? AND key = ?')
  const existing = read.get(pageId, key) as Property | undefined

  // Blurring a field you never touched still fired a write, and every write
  // logs — so opening a typed page and tabbing through it buried the Activity
  // feed under `set "…"` rows that recorded no actual change.
  if (
    existing &&
    existing.type === type &&
    existing.value_text === valueText &&
    existing.value_number === valueNumber &&
    existing.value_date === valueDate &&
    existing.value_relation === valueRelation
  ) {
    return existing
  }

  // Every column is written on conflict, including the ones this value does
  // not use: retyping a property otherwise left the old column populated and
  // the row read as two values at once.
  db.prepare(
    `INSERT INTO properties (id, page_id, key, type, value_text, value_number, value_date, value_relation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(page_id, key) DO UPDATE SET
       type = excluded.type, value_text = excluded.value_text,
       value_number = excluded.value_number, value_date = excluded.value_date,
       value_relation = excluded.value_relation`
  ).run(id, pageId, key, type, valueText, valueNumber, valueDate, valueRelation)

  logActivity(pageId, 'property', `set "${key}"`)

  return read.get(pageId, key) as Property
}

/**
 * Every distinct value recorded for a property key, across all live pages.
 * Multi-selects store a JSON array in value_text, so those are unpacked —
 * this is what lets the multi_select editor suggest values already in use
 * instead of asking for them to be retyped.
 */
export function getKnownPropertyValues(key: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT pr.value_text AS v
       FROM properties pr
       JOIN pages p ON p.id = pr.page_id AND p.is_deleted = 0
       WHERE pr.key = ? AND pr.value_text IS NOT NULL`
    )
    .all(key) as { v: string }[]

  const counts = new Map<string, number>()
  const bump = (value: string) => {
    const clean = value.trim()
    if (clean) counts.set(clean, (counts.get(clean) ?? 0) + 1)
  }

  for (const row of rows) {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(row.v)
    } catch {
      // Not JSON — a plain select/text value, which counts as one value.
    }
    // Braces matter here: without them the `else` binds to the inner `if`, so
    // the plain-value branch only ran for a non-string array element and every
    // ordinary select/text value was silently dropped.
    if (Array.isArray(parsed)) {
      for (const item of parsed) if (typeof item === 'string') bump(item)
    } else {
      bump(row.v)
    }
  }

  // Most-used first: the value you reach for again is usually the common one.
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value)
}

export function removeProperty(pageId: string, key: string): void {
  getDb().prepare('DELETE FROM properties WHERE page_id = ? AND key = ?').run(pageId, key)
}

// ============================================================
// Links
// ============================================================

export function getBacklinks(pageId: string): BacklinkResult[] {
  const rows = getDb()
    .prepare(
      `SELECT l.context, p.id AS source_page_id, p.title, p.icon
       FROM links l JOIN pages p ON p.id = l.source_page_id
       WHERE l.target_page_id = ? AND p.is_deleted = 0
       ORDER BY l.created_at DESC`
    )
    .all(pageId) as { source_page_id: string; title: string; icon: string | null; context: string | null }[]

  return rows.map((r) => ({
    sourcePageId: r.source_page_id,
    sourcePageTitle: r.title,
    sourcePageIcon: r.icon,
    context: r.context
  }))
}

/**
 * Replace a page's outgoing links with exactly the set given.
 *
 * Deliberately not exported: `projectDocument` is the only caller, so the
 * link graph cannot be written from anywhere that is not looking at the
 * document itself.
 */
function syncLinks(pageId: string, linkTargets: LinkTarget[]): void {
  const db = getDb()
  const trx = db.transaction(() => {
    const existing = db
      .prepare('SELECT id, target_page_id FROM links WHERE source_page_id = ?')
      .all(pageId) as { id: string; target_page_id: string }[]

    const existingTargets = new Set(existing.map((e) => e.target_page_id))

    // A mention whose target has since been permanently deleted still sits in
    // the document text. Inserting a link to it violates the foreign key and
    // would fail the whole save — so the page just becomes unsaveable. Drop
    // those targets instead; the chip stays in the text, it simply stops
    // contributing a backlink.
    const known = new Set(
      (db.prepare('SELECT id FROM pages').all() as { id: string }[]).map((p) => p.id)
    )
    const newTargets = new Map(
      linkTargets.filter((lt) => known.has(lt.targetPageId)).map((lt) => [lt.targetPageId, lt.context])
    )

    for (const row of existing) {
      if (!newTargets.has(row.target_page_id)) {
        db.prepare('DELETE FROM links WHERE id = ?').run(row.id)
      }
    }

    const insert = db.prepare(
      `INSERT OR IGNORE INTO links (id, source_page_id, target_page_id, context, created_at) VALUES (?, ?, ?, ?, ?)`
    )
    const updateCtx = db.prepare(
      'UPDATE links SET context = ? WHERE source_page_id = ? AND target_page_id = ?'
    )
    const ts = now()
    for (const [targetId, context] of newTargets) {
      if (existingTargets.has(targetId)) {
        updateCtx.run(context, pageId, targetId)
      } else {
        insert.run(uuidv4(), pageId, targetId, context, ts)
      }
    }
  })
  trx()
}

export function searchPagesForLink(query: string, excludePageId?: string): Page[] {
  const db = getDb()
  // A page linking to itself is never what's wanted and would show up as its
  // own backlink, so the page being edited is filtered out of its own picker.
  const exclude = excludePageId ?? ''
  if (!query.trim()) {
    return db
      .prepare('SELECT * FROM pages WHERE is_deleted = 0 AND id != ? ORDER BY updated_at DESC LIMIT 20')
      .all(exclude) as Page[]
  }
  return db
    .prepare(
      'SELECT * FROM pages WHERE is_deleted = 0 AND id != ? AND title LIKE ? ORDER BY updated_at DESC LIMIT 20'
    )
    .all(exclude, `%${query}%`) as Page[]
}

// ============================================================
// Activity log
// ============================================================

export function logActivity(pageId: string | null, eventType: string, message: string): void {
  getDb()
    .prepare('INSERT INTO activity_log (id, page_id, event_type, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), pageId, eventType, message, now())
}

/** How long a single "edited" entry keeps absorbing further edits to a page. */
const EDIT_COALESCE_MINUTES = 15

/**
 * Content saves fire on a short debounce while typing, so logging each one
 * verbatim buries every other event under hundreds of identical "content
 * saved" rows. One editing session on a page collapses into a single entry
 * whose timestamp moves forward as the session continues.
 */
function logEdit(pageId: string): void {
  const db = getDb()
  const recent = db
    .prepare(
      `SELECT id FROM activity_log
       WHERE page_id = ? AND event_type = 'edited'
         AND created_at >= datetime('now', ?)
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(pageId, `-${EDIT_COALESCE_MINUTES} minutes`) as { id: string } | undefined

  if (recent) {
    db.prepare('UPDATE activity_log SET created_at = ? WHERE id = ?').run(now(), recent.id)
    return
  }

  logActivity(pageId, 'edited', 'edited')
}

export function getRecentActivity(limit = 20): ActivityLogEntry[] {
  return getDb()
    .prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?')
    .all(limit) as ActivityLogEntry[]
}

// ============================================================
// Stats
// ============================================================

export function getStorageStats(): StorageStats {
  const db = getDb()
  const pageCount = (db.prepare('SELECT COUNT(*) AS c FROM pages WHERE is_deleted = 0').get() as { c: number }).c
  const taggedCount = (
    db.prepare('SELECT COUNT(DISTINCT page_id) AS c FROM properties').get() as { c: number }
  ).c

  let dbSizeBytes = 0
  try {
    dbSizeBytes = statSync(getDbPath()).size
  } catch {
    dbSizeBytes = 0
  }

  return {
    pageCount,
    dbSizeBytes,
    withPropertiesPercent: pageCount === 0 ? 0 : Math.round((taggedCount / pageCount) * 100)
  }
}

/**
 * The whole link graph over live pages. Small enough to send in one go — this
 * is a single-user vault, not a crawl — which lets the renderer lay it out and
 * respond to hover/drag without a round trip per interaction.
 */
export function getGraph(): GraphData {
  const db = getDb()

  const nodes = db
    .prepare(
      `SELECT p.id, p.title, p.type_id, p.updated_at,
              (SELECT COUNT(*) FROM links l
                 WHERE l.source_page_id = p.id OR l.target_page_id = p.id) AS degree
       FROM pages p
       WHERE p.is_deleted = 0
       ORDER BY p.updated_at DESC`
    )
    .all() as GraphNode[]

  // Restricted to live pages on both ends so the renderer never has to draw an
  // edge to a node it wasn't given.
  const edges = db
    .prepare(
      `SELECT l.source_page_id AS source, l.target_page_id AS target
       FROM links l
       JOIN pages s ON s.id = l.source_page_id AND s.is_deleted = 0
       JOIN pages t ON t.id = l.target_page_id AND t.is_deleted = 0`
    )
    .all() as GraphEdge[]

  return { nodes, edges }
}

export function getGraphPreview(): GraphPreview {
  const db = getDb()
  const edgeCount = (db.prepare('SELECT COUNT(*) AS c FROM links').get() as { c: number }).c
  const nodeCount = (db.prepare('SELECT COUNT(*) AS c FROM pages WHERE is_deleted = 0').get() as { c: number }).c
  return { nodeCount, edgeCount }
}

// ============================================================
// Folders
// ============================================================

export function getFolders(): Folder[] {
  return getDb()
    .prepare('SELECT * FROM folders ORDER BY sort_order ASC, name COLLATE NOCASE ASC')
    .all() as Folder[]
}

export function createFolder(name: string, parentFolderId: string | null): Folder {
  const db = getDb()
  const id = uuidv4()
  const ts = now()

  // New folders append to the end of their level.
  const { max } = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max FROM folders WHERE parent_folder_id IS ?')
    .get(parentFolderId) as { max: number }

  db.prepare(
    `INSERT INTO folders (id, name, parent_folder_id, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name.trim() || 'New folder', parentFolderId, max + 1, ts, ts)

  logActivity(null, 'folder', `created folder "${name.trim() || 'New folder'}"`)
  return db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as Folder
}

export function renameFolder(id: string, name: string): void {
  const clean = name.trim()
  if (!clean) return
  getDb().prepare('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?').run(clean, now(), id)
}

/** True when `candidateParentId` sits somewhere inside `folderId`'s subtree. */
function isDescendantOf(candidateParentId: string, folderId: string): boolean {
  const parentOf = getDb().prepare('SELECT parent_folder_id FROM folders WHERE id = ?')
  let cursor: string | null = candidateParentId
  // Bounded so a cycle already present in the data can't hang the main process.
  for (let depth = 0; cursor && depth < 1000; depth++) {
    if (cursor === folderId) return true
    const row = parentOf.get(cursor) as { parent_folder_id: string | null } | undefined
    cursor = row?.parent_folder_id ?? null
  }
  return false
}

export function moveFolder(id: string, parentFolderId: string | null): void {
  if (id === parentFolderId) return
  // Dropping a folder into its own descendant would detach that whole subtree
  // from the root and make it unreachable in the list.
  if (parentFolderId && isDescendantOf(parentFolderId, id)) {
    throw new Error('A folder cannot be moved inside one of its own subfolders')
  }

  const db = getDb()
  const { max } = db
    .prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS max FROM folders WHERE parent_folder_id IS ? AND id != ?'
    )
    .get(parentFolderId, id) as { max: number }

  db.prepare('UPDATE folders SET parent_folder_id = ?, sort_order = ?, updated_at = ? WHERE id = ?').run(
    parentFolderId,
    max + 1,
    now(),
    id
  )
}

/**
 * Delete a folder, lifting its pages and subfolders to its own parent.
 * Removing a container should never destroy notes.
 */
export function deleteFolder(id: string): void {
  const db = getDb()
  const run = db.transaction(() => {
    const folder = db.prepare('SELECT name, parent_folder_id FROM folders WHERE id = ?').get(id) as
      | { name: string; parent_folder_id: string | null }
      | undefined
    if (!folder) return
    const parent = folder.parent_folder_id ?? null

    db.prepare('UPDATE pages SET folder_id = ? WHERE folder_id = ?').run(parent, id)
    db.prepare('UPDATE folders SET parent_folder_id = ? WHERE parent_folder_id = ?').run(parent, id)
    db.prepare('DELETE FROM folders WHERE id = ?').run(id)
    logActivity(null, 'folder', `deleted folder "${folder.name}"`)
  })
  run()
}

export function movePageToFolder(pageId: string, folderId: string | null): void {
  getDb()
    .prepare('UPDATE pages SET folder_id = ?, updated_at = ? WHERE id = ?')
    .run(folderId, now(), pageId)
}

// ============================================================
// Tags
// ============================================================

export function getTags(): TagWithCount[] {
  return getDb()
    .prepare(
      `SELECT t.*, COUNT(p.id) AS page_count
       FROM tags t
       LEFT JOIN page_tags pt ON pt.tag_id = t.id
       LEFT JOIN pages p ON p.id = pt.page_id AND p.is_deleted = 0
       GROUP BY t.id
       ORDER BY t.name COLLATE NOCASE ASC`
    )
    .all() as TagWithCount[]
}

export function getTagsForPage(pageId: string): Tag[] {
  return getDb()
    .prepare(
      `SELECT t.* FROM tags t
       JOIN page_tags pt ON pt.tag_id = t.id
       WHERE pt.page_id = ?
       ORDER BY t.name COLLATE NOCASE ASC`
    )
    .all(pageId) as Tag[]
}

/**
 * The design system's four semantic colours. New tags cycle through them so a
 * vault gets some variety without the user choosing a colour every time.
 */
const TAG_COLORS = ['accent', 'info', 'success', 'critical']

export function addTagToPage(pageId: string, rawName: string): Tag {
  const db = getDb()
  const name = rawName.trim().replace(/^#/, '')
  if (!name) throw new Error('A tag needs a name')

  const run = db.transaction((): Tag => {
    let tag = db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE').get(name) as Tag | undefined

    if (!tag) {
      const { count } = db.prepare('SELECT COUNT(*) AS count FROM tags').get() as { count: number }
      const id = uuidv4()
      db.prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        name,
        TAG_COLORS[count % TAG_COLORS.length],
        now()
      )
      tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as Tag
    }

    db.prepare('INSERT OR IGNORE INTO page_tags (page_id, tag_id, created_at) VALUES (?, ?, ?)').run(
      pageId,
      tag.id,
      now()
    )
    return tag
  })

  const tag = run()
  logActivity(pageId, 'tag', `tagged "${tag.name}"`)
  return tag
}

export function removeTagFromPage(pageId: string, tagId: string): void {
  getDb().prepare('DELETE FROM page_tags WHERE page_id = ? AND tag_id = ?').run(pageId, tagId)
}

export function renameTag(id: string, rawName: string): void {
  const db = getDb()
  const name = rawName.trim().replace(/^#/, '')
  if (!name) return

  const run = db.transaction(() => {
    // Renaming onto a name that already exists merges the two rather than
    // failing the unique index — "these are the same tag" is the intent.
    const existing = db
      .prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id != ?')
      .get(name, id) as { id: string } | undefined

    if (existing) {
      db.prepare(
        `INSERT OR IGNORE INTO page_tags (page_id, tag_id, created_at)
         SELECT page_id, ?, ? FROM page_tags WHERE tag_id = ?`
      ).run(existing.id, now(), id)
      db.prepare('DELETE FROM tags WHERE id = ?').run(id)
      return
    }

    db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, id)
  })
  run()
}

export function deleteTag(id: string): void {
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(id)
}

export function setTagColor(id: string, color: string): void {
  getDb().prepare('UPDATE tags SET color = ? WHERE id = ?').run(color, id)
}

/** Ids of pages carrying at least one of the given tags. */
export function getPageIdsForTags(tagIds: string[]): string[] {
  if (tagIds.length === 0) return []
  const placeholders = tagIds.map(() => '?').join(', ')
  const rows = getDb()
    .prepare(`SELECT DISTINCT page_id FROM page_tags WHERE tag_id IN (${placeholders})`)
    .all(...tagIds) as { page_id: string }[]
  return rows.map((r) => r.page_id)
}
