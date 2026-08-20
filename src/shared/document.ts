/**
 * Walks over a stored BlockNote document.
 *
 * A page's body is one JSON blob (`pages.content`), so every projection built
 * from it — the search index, the link graph, the task table — starts by
 * walking that tree. These walkers live in `shared` because the main process
 * owns the projections while the renderer holds the same document in memory,
 * and a second copy of this parsing is exactly how the two drift apart.
 */

import type { LinkTarget } from './types'

interface DocumentNode {
  id?: string
  type?: string
  props?: Record<string, unknown>
  content?: unknown
  children?: unknown[]
}

/**
 * Parse a stored document, tolerating the unparseable.
 *
 * A body that will not parse is not a reason to fail a save — the raw text is
 * still in the database, and the editor already recovers from it the same way.
 */
export function parseDocument(content: string | null): unknown[] {
  if (!content) return []
  try {
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** The plain text of one block's inline content, mentions included. */
function blockText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const node of content) {
    if (!node || typeof node !== 'object') continue
    const n = node as { type?: string; text?: unknown; props?: { pageTitle?: unknown } }
    if (n.type === 'pageMention') text += String(n.props?.pageTitle ?? '')
    else if ('text' in n) text += String(n.text)
  }
  return text
}

/** Walk a document tree depth-first, in document order. */
function walk(blocks: unknown[], visit: (block: DocumentNode, text: string) => void): void {
  for (const item of blocks) {
    if (!item || typeof item !== 'object') continue
    const block = item as DocumentNode
    visit(block, blockText(block.content))
    if (Array.isArray(block.children)) walk(block.children, visit)
  }
}

/** One checkbox block, as the `tasks` table records it. */
export interface ExtractedTask {
  blockId: string
  text: string
  isDone: boolean
  /** The `@YYYY-MM-DD` written in the block itself, or null. */
  dueDate: string | null
  /** Position in the document, so a page's tasks list back in reading order. */
  sortOrder: number
}

/**
 * A due date written into the text of a checkbox block, e.g. `@2026-08-20`.
 *
 * A checkbox block has text and a checked flag and nowhere else to put a date.
 * The alternative was a custom block spec with a real date prop, which means
 * fighting BlockNote's internals — the one thing this build exists to avoid.
 * A page's own `date` property supplies the fallback, and that is resolved at
 * query time rather than baked in here (see `effectiveDue` in `repo.ts`), so
 * editing the property does not leave every task on the page stale.
 */
const DUE_DATE = /@(\d{4})-(\d{2})-(\d{2})(?![\d-])/

/** Whether `y-m-d` names a day that exists — @2026-02-31 is text, not a date. */
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  return d <= new Date(y, m, 0).getDate()
}

export function parseDueDate(text: string): { dueDate: string | null; text: string } {
  const match = DUE_DATE.exec(text)
  if (!match) return { dueDate: null, text: text.trim() }

  const [token, y, m, d] = match
  if (!isRealDate(Number(y), Number(m), Number(d))) return { dueDate: null, text: text.trim() }

  // The token is markup, not prose: showing it in the tracker next to the date
  // column it produced reads as a duplicate. The block keeps it either way —
  // the block is the source of truth, this table is only an index of it.
  return {
    dueDate: `${y}-${m}-${d}`,
    text: text.replace(token, '').replace(/\s{2,}/g, ' ').trim()
  }
}

/**
 * Every checkbox block in a document, in reading order.
 *
 * `checkListItem` ships in BlockNote's `defaultBlockSpecs`, so this is the
 * capture surface as it already exists — writing a todo never means leaving
 * the page. Block ids are stable across saves and live in the stored JSON,
 * which is what lets a projected row survive an edit to the block above it.
 */
export function extractTasks(blocks: unknown[]): ExtractedTask[] {
  const tasks: ExtractedTask[] = []

  walk(blocks, (block, text) => {
    if (block.type !== 'checkListItem' || !block.id) return
    const parsed = parseDueDate(text)
    tasks.push({
      blockId: block.id,
      text: parsed.text,
      isDone: block.props?.checked === true,
      dueDate: parsed.dueDate,
      sortOrder: tasks.length
    })
  })

  return tasks
}

/**
 * Set the checked flag on one block, returning the document unchanged when
 * that block is not in it. Used by the tracker to tick a task off without
 * opening its page — the block stays the source of truth, so the write has to
 * go back into the document rather than into the projected row.
 */
export function setCheckedInDocument(blocks: unknown[], blockId: string, checked: boolean): {
  blocks: unknown[]
  found: boolean
} {
  let found = false

  const mapBlocks = (items: unknown[]): unknown[] =>
    items.map((item) => {
      if (!item || typeof item !== 'object') return item
      const block = item as DocumentNode
      const next: DocumentNode = { ...block }
      if (block.id === blockId && block.type === 'checkListItem') {
        found = true
        next.props = { ...(block.props ?? {}), checked }
      }
      if (Array.isArray(block.children)) next.children = mapBlocks(block.children)
      return next
    })

  return { blocks: mapBlocks(blocks), found }
}

/**
 * The opening prose of a document, for a preview line.
 *
 * Built on the same walker as every other projection rather than a second
 * parse of the JSON — which is the reason this file exists. Blocks are joined
 * with a separator instead of a space so a heading does not run into the
 * paragraph under it.
 */
export function documentPreview(content: string | null, limit = 240): string {
  const parts: string[] = []
  walk(parseDocument(content), (_block, text) => {
    const trimmed = text.trim()
    if (trimmed) parts.push(trimmed)
  })

  const joined = parts.join(' · ')
  if (joined.length <= limit) return joined
  // Cut at a word boundary where one is in reach, so a preview never ends
  // mid-word.
  const cut = joined.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  return `${(space > limit - 30 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Every distinct pageMention target in a document, with the text around it. */
export function extractLinkTargets(blocks: unknown[]): LinkTarget[] {
  const targets = new Map<string, string | null>()

  walk(blocks, (block, text) => {
    if (!Array.isArray(block.content)) return
    for (const node of block.content) {
      if (!node || typeof node !== 'object') continue
      const n = node as { type?: string; props?: { pageId?: string } }
      if (n.type === 'pageMention' && n.props?.pageId && !targets.has(n.props.pageId)) {
        targets.set(n.props.pageId, text.slice(0, 200) || null)
      }
    }
  })

  return Array.from(targets, ([targetPageId, context]) => ({ targetPageId, context }))
}
