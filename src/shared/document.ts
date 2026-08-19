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
