import type { Edge, Node } from '@xyflow/react'
import {
  CANVAS_SIDES,
  isKnownNode,
  type CanvasColor,
  type CanvasDoc,
  type CanvasEdge,
  type CanvasSide,
  type CanvasUnknownNode
} from '@shared/canvas'

/**
 * The seam between the stored document and React Flow.
 *
 * React Flow owns the live state while a canvas is open — positions mid-drag,
 * selection, measured sizes — and none of that is the document. These two
 * functions are the only place the two shapes meet, so a field React Flow
 * adds can never leak into `canvases.content`, and a field the document grows
 * can never be lost on the way through the board.
 */

export interface CardData extends Record<string, unknown> {
  color?: CanvasColor
  /** text cards */
  text?: string
  /** page cards */
  pageId?: string
  /** groups */
  label?: string
  /**
   * The stored node as it was read, for fields this build does not draw. An
   * unknown node type is written back from this, whole; a known one has its
   * unrecognised keys carried through from it.
   */
  raw: Record<string, unknown>
  /** Open in edit mode the moment it appears. Never stored. */
  autoEdit?: boolean
}

export type CardNode = Node<CardData>

export interface LinkData extends Record<string, unknown> {
  label?: string
  color?: CanvasColor
  toEnd?: 'arrow' | 'none'
  raw: Record<string, unknown>
}

export type LinkEdge = Edge<LinkData>

/** Groups draw under everything; cards over them. Selection never reorders. */
const GROUP_Z = 0
const CARD_Z = 1

const asSide = (handle: string | null | undefined): CanvasSide | undefined =>
  CANVAS_SIDES.includes(handle as CanvasSide) ? (handle as CanvasSide) : undefined

export function docToFlow(doc: CanvasDoc): { nodes: CardNode[]; edges: LinkEdge[] } {
  // Groups first, so a card placed later is never hidden behind a group that
  // happens to come after it in the document.
  const ordered = [...doc.nodes].sort((a, b) => Number(b.type === 'group') - Number(a.type === 'group'))
  const nodes: CardNode[] = ordered.map((node) => {
    const known = isKnownNode(node)
    const data: CardData = { raw: { ...node }, color: node.color }
    if (node.type === 'text') data.text = (node as { text: string }).text
    if (node.type === 'page') data.pageId = (node as { pageId: string }).pageId
    if (node.type === 'group') data.label = (node as { label?: string }).label
    return {
      id: node.id,
      type: known ? node.type : 'unknown',
      position: { x: node.x, y: node.y },
      width: node.width,
      height: node.height,
      zIndex: node.type === 'group' ? GROUP_Z : CARD_Z,
      data
    }
  })

  const edges: LinkEdge[] = doc.edges.map((edge) => ({
    id: edge.id,
    type: 'link',
    source: edge.fromNode,
    target: edge.toNode,
    sourceHandle: edge.fromSide ?? 'right',
    targetHandle: edge.toSide ?? 'left',
    data: { raw: { ...edge }, label: edge.label, color: edge.color, toEnd: edge.toEnd }
  }))

  return { nodes, edges }
}

export function flowToDoc(nodes: CardNode[], edges: LinkEdge[]): CanvasDoc {
  const ids = new Set<string>()
  const outNodes: CanvasDoc['nodes'] = nodes.map((node) => {
    ids.add(node.id)
    const width = Math.round(node.width ?? node.measured?.width ?? 0)
    const height = Math.round(node.height ?? node.measured?.height ?? 0)
    const base: Record<string, unknown> = {
      ...node.data.raw,
      id: node.id,
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      width,
      height
    }
    if (node.type === 'unknown') return base as CanvasUnknownNode

    base.type = node.type
    if (node.data.color) base.color = node.data.color
    else delete base.color
    if (node.type === 'text') base.text = node.data.text ?? ''
    if (node.type === 'page') base.pageId = node.data.pageId
    if (node.type === 'group') {
      if (node.data.label) base.label = node.data.label
      else delete base.label
    }
    return base as unknown as CanvasDoc['nodes'][number]
  })

  const outEdges: CanvasEdge[] = []
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue
    const out: Record<string, unknown> = {
      ...(edge.data?.raw ?? {}),
      id: edge.id,
      fromNode: edge.source,
      toNode: edge.target
    }
    const fromSide = asSide(edge.sourceHandle)
    const toSide = asSide(edge.targetHandle)
    if (fromSide) out.fromSide = fromSide
    else delete out.fromSide
    if (toSide) out.toSide = toSide
    else delete out.toSide
    for (const key of ['label', 'color', 'toEnd'] as const) {
      const value = edge.data?.[key]
      if (value) out[key] = value
      else delete out[key]
    }
    outEdges.push(out as unknown as CanvasEdge)
  }

  return { version: 1, nodes: outNodes, edges: outEdges }
}
