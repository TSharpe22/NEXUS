import { createContext, useContext } from 'react'
import type { CanvasColor } from '@shared/canvas'
import type { CardData, LinkData } from './flow'

/**
 * What a card or an arrow can ask the board to do.
 *
 * Cards are rendered by React Flow, which hands them their own props and
 * nothing else, so everything that changes the document goes through here —
 * and so through the one `setNodes` the board's history and autosave watch.
 */
export interface CanvasActions {
  /**
   * The one card or arrow in edit mode, if any. One at a time is the rule that
   * keeps a canvas of page cards from being a page of live block editors: an
   * editor mounts for the card being edited and unmounts when it is left.
   * Arrows are named `edge:<id>` so the two can never collide.
   */
  editingId: string | null
  setEditingId(id: string | null): void
  updateCard(id: string, patch: Partial<CardData>): void
  updateLink(id: string, patch: Partial<LinkData>): void
  setColor(ids: string[], color: CanvasColor | undefined): void
  remove(ids: string[]): void
  /** Turn a text card into a real page, and the card into that page's card. */
  makePage(id: string): Promise<void>
  /** A text card at a screen point — double-clicking inside a group. */
  createTextAt(clientX: number, clientY: number): void
  openPage(pageId: string): void
  /** Show an image card's picture at its own proportions, keeping its width. */
  fitImage(id: string, naturalWidth: number, naturalHeight: number): void
  /** Follow a `[[Title]]`: open the page with that title, or make it. */
  openTitle(title: string): Promise<void>
}

export const CanvasContext = createContext<CanvasActions | null>(null)

export function useCanvas(): CanvasActions {
  const actions = useContext(CanvasContext)
  if (!actions) throw new Error('useCanvas outside a canvas board')
  return actions
}
