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
  TypeDef,
  PropertyDefinition
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

export function updatePage(id: string, data: Partial<Pick<Page, 'title' | 'icon' | 'content' | 'page_width'>>): void {
  const db = getDb()
  const allowed = ['title', 'icon', 'content', 'page_width'] as const
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
  else if ('content' in data) logActivity(id, 'edited', 'content saved')
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
    `INSERT INTO pages (id, type_id, title, icon, content, page_width, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(newId, source.type_id, `${source.title} (copy)`, source.icon, source.content, source.page_width, ts, ts)

  for (const prop of getPropertiesForPage(id)) {
    const value = prop.type === 'date' ? prop.value_date : (prop.value_text ?? prop.value_number)
    setProperty(newId, prop.key, prop.type, value)
  }

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
    const newTargets = new Map(linkTargets.map((lt) => [lt.targetPageId, lt.context]))

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

export function searchPagesForLink(query: string): Page[] {
  const db = getDb()
  if (!query.trim()) {
    return db.prepare('SELECT * FROM pages WHERE is_deleted = 0 ORDER BY updated_at DESC LIMIT 20').all() as Page[]
  }
  return db
    .prepare('SELECT * FROM pages WHERE is_deleted = 0 AND title LIKE ? ORDER BY updated_at DESC LIMIT 20')
    .all(`%${query}%`) as Page[]
}

// ============================================================
// Activity log
// ============================================================

export function logActivity(pageId: string | null, eventType: string, message: string): void {
  getDb()
    .prepare('INSERT INTO activity_log (id, page_id, event_type, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), pageId, eventType, message, now())
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

export function getGraphPreview(): GraphPreview {
  const db = getDb()
  const edgeCount = (db.prepare('SELECT COUNT(*) AS c FROM links').get() as { c: number }).c
  const nodeCount = (db.prepare('SELECT COUNT(*) AS c FROM pages WHERE is_deleted = 0').get() as { c: number }).c

  const center = db
    .prepare('SELECT * FROM pages WHERE is_deleted = 0 ORDER BY updated_at DESC LIMIT 1')
    .get() as Page | undefined

  if (!center) return { nodeCount, edgeCount, center: null, neighbors: [] }

  const neighbors = db
    .prepare(
      `SELECT DISTINCT p.* FROM pages p
       WHERE p.is_deleted = 0 AND p.id != ? AND p.id IN (
         SELECT target_page_id FROM links WHERE source_page_id = ?
         UNION
         SELECT source_page_id FROM links WHERE target_page_id = ?
       )
       LIMIT 4`
    )
    .all(center.id, center.id, center.id) as Page[]

  return { nodeCount, edgeCount, center, neighbors }
}
