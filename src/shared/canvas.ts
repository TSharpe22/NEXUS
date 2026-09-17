/**
 * A canvas: cards on an infinite plane, and arrows between them.
 *
 * The stored shape is JSON Canvas (jsoncanvas.org) — the open format Obsidian
 * writes — with one deliberate difference: a card that shows a Nexus page is
 * `{ type: 'page', pageId }` rather than `{ type: 'file', file: 'path.md' }`.
 * A path is a fact about the mirror, and it changes whenever a page is renamed
 * or moved; an id never does. The mirror turns every page card back into a
 * `file` node pointing at the page's mirrored Markdown, so the `.canvas` files
 * it writes open in Obsidian as they are.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 * Everything here is serialised into `canvases.content`. Treat it the way
 * `views.ts` and `widgets.ts` ask to be treated:
 *
 *   • Adding a node type, an edge field or a colour is additive and safe.
 *   • Renaming or re-nesting anything already written is not.
 *   • A node whose `type` this build does not know is kept, drawn as a
 *     placeholder, and written back unchanged. It is never dropped — a canvas
 *     edited by a later Nexus must survive being opened in this one.
 */

import { ATTACHMENT_NAME_RE } from './attachments'

/**
 * A card's colour: the semantic tokens, never a palette of the canvas's own.
 * `critical` is allowed here where the graph leaves it out — a card marked red
 * is a card somebody wanted to read as a warning, which is what it means.
 */
export type CanvasColor = 'accent' | 'info' | 'warning' | 'critical' | 'success'

export const CANVAS_COLORS: CanvasColor[] = ['accent', 'info', 'warning', 'critical', 'success']

/** Which side of a card an arrow leaves or arrives at. */
export type CanvasSide = 'top' | 'right' | 'bottom' | 'left'

export const CANVAS_SIDES: CanvasSide[] = ['top', 'right', 'bottom', 'left']

interface NodeBase {
  id: string
  /** Top-left corner, in canvas units. */
  x: number
  y: number
  width: number
  height: number
  color?: CanvasColor
}

/** Markdown, rendered when not being edited. `[[Title]]` resolves to a page by title. */
export interface CanvasTextNode extends NodeBase {
  type: 'text'
  text: string
}

/** A Nexus page, shown as a preview and edited with the real block editor. */
export interface CanvasPageNode extends NodeBase {
  type: 'page'
  pageId: string
}

/**
 * A labelled region. Geometric, as in JSON Canvas: a card belongs to a group
 * by lying inside it, not by a parent id, so moving a card out of a group is
 * just moving it.
 */
export interface CanvasGroupNode extends NodeBase {
  type: 'group'
  label?: string
}

/**
 * A picture, held in the attachment store like one pasted into a page. `file`
 * is the stored name — the SHA-256 of its bytes and an extension — not a URL
 * and not a path, so the same screenshot on a page and on a canvas is one file,
 * and the mirror decides where it sits on disk.
 */
export interface CanvasImageNode extends NodeBase {
  type: 'image'
  file: string
}

/** A node from a later build. Carried, never interpreted. */
export interface CanvasUnknownNode extends NodeBase {
  type: string
  [key: string]: unknown
}

export type CanvasNode = CanvasTextNode | CanvasPageNode | CanvasGroupNode | CanvasImageNode

export interface CanvasEdge {
  id: string
  fromNode: string
  toNode: string
  fromSide?: CanvasSide
  toSide?: CanvasSide
  /** JSON Canvas defaults this to `'arrow'`, and so does Nexus. */
  toEnd?: 'arrow' | 'none'
  label?: string
  color?: CanvasColor
}

export interface CanvasDoc {
  /** Bumped only if a reader ever needs to branch on the shape. */
  version: 1
  nodes: (CanvasNode | CanvasUnknownNode)[]
  edges: CanvasEdge[]
}

/** What the canvas list carries — everything but the document. */
export interface CanvasListItem {
  id: string
  title: string
  is_deleted: number
  created_at: string
  updated_at: string
}

export interface Canvas extends CanvasListItem {
  content: string
}

export const EMPTY_CANVAS: CanvasDoc = { version: 1, nodes: [], edges: [] }

/** Default card sizes, in canvas units. */
export const CARD_SIZE = {
  text: { width: 260, height: 140 },
  page: { width: 320, height: 220 },
  group: { width: 520, height: 360 },
  image: { width: 320, height: 240 }
} as const

/** The largest an image card starts at. It keeps its aspect ratio inside this box. */
export const MAX_IMAGE_CARD = { width: 480, height: 400 }

/** The smallest a card may be resized to. */
export const MIN_CARD = { width: 140, height: 60 }

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isColor = (v: unknown): v is CanvasColor => CANVAS_COLORS.includes(v as CanvasColor)
const isSide = (v: unknown): v is CanvasSide => CANVAS_SIDES.includes(v as CanvasSide)

export function isKnownNode(node: CanvasNode | CanvasUnknownNode): node is CanvasNode {
  return node.type === 'text' || node.type === 'page' || node.type === 'group' || node.type === 'image'
}

/**
 * Bring whatever is stored up to something drawable.
 *
 * Repairs what it can — a missing size gets the default for its type, a
 * colour nobody defined is dropped — and discards only what cannot be placed
 * at all: a node with no id or no position, an edge whose ends are gone. A node
 * with an unfamiliar `type` is kept whole, for the reason at the top of this
 * file.
 */
export function parseCanvas(content: string | null | undefined): CanvasDoc {
  if (!content) return { version: 1, nodes: [], edges: [] }
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return { version: 1, nodes: [], edges: [] }
  }
  if (!raw || typeof raw !== 'object') return { version: 1, nodes: [], edges: [] }
  const candidate = raw as { nodes?: unknown; edges?: unknown }

  const nodes: (CanvasNode | CanvasUnknownNode)[] = []
  const seen = new Set<string>()
  for (const entry of Array.isArray(candidate.nodes) ? candidate.nodes : []) {
    if (!entry || typeof entry !== 'object') continue
    const n = entry as Record<string, unknown>
    if (typeof n.id !== 'string' || !n.id || seen.has(n.id)) continue
    if (typeof n.type !== 'string' || !isNumber(n.x) || !isNumber(n.y)) continue

    const defaults = CARD_SIZE[n.type as keyof typeof CARD_SIZE] ?? CARD_SIZE.text
    const base = {
      ...n,
      id: n.id,
      type: n.type,
      x: n.x,
      y: n.y,
      width: isNumber(n.width) && n.width > 0 ? n.width : defaults.width,
      height: isNumber(n.height) && n.height > 0 ? n.height : defaults.height
    } as Record<string, unknown>
    if ('color' in base && !isColor(base.color)) delete base.color

    if (n.type === 'text') base.text = typeof n.text === 'string' ? n.text : ''
    else if (n.type === 'page') {
      if (typeof n.pageId !== 'string' || !n.pageId) continue
    } else if (n.type === 'image') {
      // The name is the whole of the traversal defence for attachments; a
      // card that names anything else is not one of ours and is not kept.
      if (typeof n.file !== 'string' || !ATTACHMENT_NAME_RE.test(n.file)) continue
    } else if (n.type === 'group') {
      if ('label' in base && typeof base.label !== 'string') delete base.label
    }
    // Only a node that is kept can be an arrow's end.
    seen.add(n.id)
    nodes.push(base as unknown as CanvasNode | CanvasUnknownNode)
  }

  const edges: CanvasEdge[] = []
  const edgeIds = new Set<string>()
  for (const entry of Array.isArray(candidate.edges) ? candidate.edges : []) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    if (typeof e.id !== 'string' || !e.id || edgeIds.has(e.id)) continue
    if (typeof e.fromNode !== 'string' || typeof e.toNode !== 'string') continue
    if (!seen.has(e.fromNode) || !seen.has(e.toNode)) continue
    edgeIds.add(e.id)
    const edge: CanvasEdge = { ...(e as object), id: e.id, fromNode: e.fromNode, toNode: e.toNode }
    if (!isSide(edge.fromSide)) delete edge.fromSide
    if (!isSide(edge.toSide)) delete edge.toSide
    if (edge.toEnd !== 'none' && edge.toEnd !== 'arrow') delete edge.toEnd
    if (typeof edge.label !== 'string' || !edge.label) delete edge.label
    if (!isColor(edge.color)) delete edge.color
    edges.push(edge)
  }

  return { version: 1, nodes, edges }
}

export function serializeCanvas(doc: CanvasDoc): string {
  return JSON.stringify({ version: 1, nodes: doc.nodes, edges: doc.edges })
}

/** `[[Title]]` and `[[Title|shown text]]` in a text card. */
export const WIKI_LINK = /\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]*))?\]\]/g

/** The page titles a text card links to, as written. */
export function wikiLinkTitles(text: string): string[] {
  const out: string[] = []
  for (const match of text.matchAll(WIKI_LINK)) out.push(match[1].trim())
  return out
}

/**
 * Every page a canvas refers to: the pages its cards show, and the pages its
 * text cards link to by title. `titleToId` resolves a title case-insensitively
 * and returns null for one that names no page.
 */
export function canvasPageRefs(doc: CanvasDoc, titleToId: (title: string) => string | null): string[] {
  const ids = new Set<string>()
  for (const node of doc.nodes) {
    if (node.type === 'page' && typeof (node as CanvasPageNode).pageId === 'string') {
      ids.add((node as CanvasPageNode).pageId)
    } else if (node.type === 'text') {
      for (const title of wikiLinkTitles((node as CanvasTextNode).text)) {
        const id = titleToId(title)
        if (id) ids.add(id)
      }
    }
  }
  return [...ids]
}

/** Every attachment a canvas's image cards point at. */
export function canvasAttachmentNames(doc: CanvasDoc): string[] {
  const names = new Set<string>()
  for (const node of doc.nodes) {
    if (node.type === 'image' && typeof (node as CanvasImageNode).file === 'string') {
      names.add((node as CanvasImageNode).file)
    }
  }
  return [...names]
}

/**
 * JSON Canvas's preset colours, "1" to "6": red, orange, yellow, green, cyan,
 * purple. The mapping is by meaning rather than by hue — `accent` is Nexus's
 * emerald, which Obsidian draws as its green.
 */
const JSON_CANVAS_COLOR: Record<CanvasColor, string> = {
  critical: '1',
  warning: '3',
  success: '4',
  accent: '4',
  info: '5'
}

/**
 * The document as Obsidian reads it. `pathFor` gives a page's path inside the
 * mirror, or null for a page that has none (trashed, deleted, locked pages all
 * still have one) — a card whose page has gone becomes a text card saying so,
 * rather than a file node pointing at nothing. `fileFor` gives an attachment's
 * path inside the mirror; image cards become `file` nodes pointing at it.
 */
export function toJsonCanvas(
  doc: CanvasDoc,
  pathFor: (pageId: string) => string | null,
  fileFor: (name: string) => string
): string {
  const nodes = doc.nodes.map((node) => {
    const { color, ...rest } = node as CanvasNode & { color?: CanvasColor }
    const base: Record<string, unknown> = { ...rest }
    if (color) base.color = JSON_CANVAS_COLOR[color]
    if (node.type === 'page') {
      const { pageId, ...withoutId } = base as { pageId: string } & Record<string, unknown>
      const file = pathFor(pageId)
      return file ? { ...withoutId, type: 'file', file } : { ...withoutId, type: 'text', text: '*A page that no longer exists.*' }
    }
    if (node.type === 'image') return { ...base, type: 'file', file: fileFor((node as CanvasImageNode).file) }
    return base
  })
  const edges = doc.edges.map((edge) => {
    const { color, ...rest } = edge
    return color ? { ...rest, color: JSON_CANVAS_COLOR[color] } : rest
  })
  return JSON.stringify({ nodes, edges }, null, '\t')
}
