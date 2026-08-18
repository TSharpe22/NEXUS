import { v4 as uuidv4 } from 'uuid'
import { getDb, getDbPath } from './database'
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
  TagWithCount
} from '../shared/types'

const now = () => new Date().toISOString().replace('T', ' ').split('.')[0]

// ============================================================
// Pages
// ============================================================

export function createPage(typeId: string = 'note'): Page {
  const db = getDb()
  const id = uuidv4()
  const ts = now()
  db.prepare(
    `INSERT INTO pages (id, type_id, title, content, created_at, updated_at) VALUES (?, ?, '', '[]', ?, ?)`
  ).run(id, typeId, ts, ts)
  logActivity(id, 'created', 'page created')
  return getPageById(id)!
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
  getDb().prepare('DELETE FROM pages WHERE id = ?').run(id)
}

export function emptyTrash(): number {
  const db = getDb()
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM pages WHERE is_deleted = 1').get() as { c: number }
  db.prepare('DELETE FROM pages WHERE is_deleted = 1').run()
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
    const value = prop.type === 'date' ? prop.value_date : (prop.value_text ?? prop.value_number)
    setProperty(newId, prop.key, prop.type, value)
  }

  // A copy lands beside the original, in the same folder and with the same tags.
  db.prepare(
    `INSERT INTO page_tags (page_id, tag_id, created_at)
     SELECT ?, tag_id, ? FROM page_tags WHERE page_id = ?`
  ).run(newId, ts, id)

  return getPageById(newId)!
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

  db.prepare(
    `INSERT INTO property_definitions (id, type_id, key, name, property_type, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(type_id, key) DO UPDATE SET name = excluded.name, property_type = excluded.property_type`
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

export function setProperty(
  pageId: string,
  key: string,
  type: PropertyType,
  value: string | number | null
): void {
  const db = getDb()
  const id = uuidv4()
  const valueText = type === 'date' ? null : typeof value === 'string' ? value : null
  const valueNumber = typeof value === 'number' ? value : null
  const valueDate = type === 'date' && typeof value === 'string' ? value : null

  db.prepare(
    `INSERT INTO properties (id, page_id, key, type, value_text, value_number, value_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(page_id, key) DO UPDATE SET
       type = excluded.type, value_text = excluded.value_text,
       value_number = excluded.value_number, value_date = excluded.value_date`
  ).run(id, pageId, key, type, valueText, valueNumber, valueDate)

  logActivity(pageId, 'property', `set "${key}"`)
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
    if (Array.isArray(parsed)) for (const item of parsed) if (typeof item === 'string') bump(item)
    else bump(row.v)
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

export function syncLinks(pageId: string, linkTargets: LinkTarget[]): void {
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
