import { parseCanvas, serializeCanvas, type CanvasDoc } from '@shared/canvas'
import { docToFlow, flowToDoc, type CardNode, type LinkEdge } from './flow'

/**
 * Copying cards, between canvases or within one.
 *
 * What goes on the clipboard is a canvas document — the same shape a canvas
 * is saved in — under a type only Nexus reads, beside a plain-text rendering
 * for anywhere else it is pasted. A paste reads it back through `parseCanvas`,
 * the validator every stored canvas goes through, because the clipboard is
 * input from outside the app like any other.
 *
 * The last copy is also held here, in memory. Chromium keeps a custom type
 * only for as long as the clipboard holds what it wrote, so when the plain
 * text on the clipboard is still exactly what this copy wrote, the copy is
 * what is meant even if the custom type did not survive the trip.
 */

export const CANVAS_MIME = 'application/x-nexus-canvas'

let lastCopy: { plain: string; fragment: string } | null = null

/** A group carries what is inside it when dragged, so copying one carries it too. */
function withContents(selected: CardNode[], all: CardNode[]): CardNode[] {
  const picked = new Map(selected.map((n) => [n.id, n]))
  const size = (n: CardNode) => ({ w: n.width ?? n.measured?.width ?? 0, h: n.height ?? n.measured?.height ?? 0 })
  for (const group of selected) {
    if (group.type !== 'group') continue
    const g = size(group)
    for (const node of all) {
      if (picked.has(node.id)) continue
      const s = size(node)
      if (
        node.position.x >= group.position.x &&
        node.position.y >= group.position.y &&
        node.position.x + s.w <= group.position.x + g.w &&
        node.position.y + s.h <= group.position.y + g.h
      )
        picked.set(node.id, node)
    }
  }
  return [...picked.values()]
}

/** What a copied card reads as outside Nexus. */
function plainText(doc: CanvasDoc, pageTitle: (id: string) => string | undefined): string {
  const parts: string[] = []
  for (const node of doc.nodes) {
    const n = node as unknown as Record<string, unknown>
    if (n.type === 'text' && typeof n.text === 'string' && n.text.trim()) parts.push(n.text.trim())
    else if (n.type === 'page' && typeof n.pageId === 'string') parts.push(`[[${pageTitle(n.pageId) || 'Untitled'}]]`)
    else if (n.type === 'group' && typeof n.label === 'string' && n.label) parts.push(`## ${n.label}`)
  }
  return parts.join('\n\n')
}

/**
 * The selection as a clipboard payload, or null when there is nothing to copy.
 * Arrows come along only when both their ends do.
 */
export function copySelection(
  nodes: CardNode[],
  edges: LinkEdge[],
  pageTitle: (id: string) => string | undefined
): { plain: string; fragment: string; ids: string[] } | null {
  const selected = nodes.filter((n) => n.selected)
  if (selected.length === 0) return null
  const picked = withContents(selected, nodes)
  const doc = flowToDoc(picked, edges)
  const fragment = serializeCanvas(doc)
  // Never empty: an empty plain text is what other apps treat as "nothing copied".
  const plain = plainText(doc, pageTitle) || `${doc.nodes.length} canvas card${doc.nodes.length === 1 ? '' : 's'}`
  lastCopy = { plain, fragment }
  return { plain, fragment, ids: picked.map((n) => n.id) }
}

/** The copied cards on the clipboard, if what is there is ours. */
export function readFragment(data: DataTransfer | null): CanvasDoc | null {
  if (!data) return null
  let fragment = data.getData(CANVAS_MIME)
  if (!fragment && lastCopy && data.getData('text/plain') === lastCopy.plain) fragment = lastCopy.fragment
  if (!fragment) return null
  const doc = parseCanvas(fragment)
  return doc.nodes.length > 0 ? doc : null
}

/**
 * The copied cards as new cards: fresh ids, every arrow re-pointed at the new
 * ids, and the whole arrangement centred on `centre` with its layout intact.
 */
export function placeFragment(
  doc: CanvasDoc,
  centre: { x: number; y: number }
): { nodes: CardNode[]; edges: LinkEdge[] } {
  const idMap = new Map(doc.nodes.map((n) => [n.id, crypto.randomUUID()]))
  const minX = Math.min(...doc.nodes.map((n) => n.x))
  const minY = Math.min(...doc.nodes.map((n) => n.y))
  const maxX = Math.max(...doc.nodes.map((n) => n.x + n.width))
  const maxY = Math.max(...doc.nodes.map((n) => n.y + n.height))
  const dx = Math.round(centre.x - (minX + maxX) / 2)
  const dy = Math.round(centre.y - (minY + maxY) / 2)

  const placed: CanvasDoc = {
    version: 1,
    nodes: doc.nodes.map((n) => ({ ...n, id: idMap.get(n.id)!, x: n.x + dx, y: n.y + dy })),
    edges: doc.edges.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      fromNode: idMap.get(e.fromNode)!,
      toNode: idMap.get(e.toNode)!
    }))
  }
  const flow = docToFlow(placed)
  return { nodes: flow.nodes.map((n) => ({ ...n, selected: true })), edges: flow.edges }
}

/**
 * The cards last copied in this window, for a "Paste" menu item that has no
 * clipboard event to read — but only while the clipboard still holds what
 * that copy wrote. Copying something in another app since means that is what
 * gets pasted.
 */
export function copiedFragment(clipboardText: string): CanvasDoc | null {
  if (!lastCopy || lastCopy.plain !== clipboardText) return null
  const doc = parseCanvas(lastCopy.fragment)
  return doc.nodes.length > 0 ? doc : null
}

/**
 * Copy from a menu, where there is no clipboard event to write a custom type
 * into. The plain text goes on the system clipboard; the cards are held in
 * `lastCopy`, which a later Ctrl+V recognises by that same plain text.
 */
export async function copySelectionFromMenu(
  nodes: CardNode[],
  edges: LinkEdge[],
  pageTitle: (id: string) => string | undefined
): Promise<string[] | null> {
  const copied = copySelection(nodes, edges, pageTitle)
  if (!copied) return null
  try {
    await navigator.clipboard.writeText(copied.plain)
  } catch {
    // The window lost focus mid-copy: the cards are still held for Paste here.
  }
  return copied.ids
}
