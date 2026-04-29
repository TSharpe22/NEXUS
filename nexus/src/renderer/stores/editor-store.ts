import { create } from 'zustand'
import type { Page } from '../../shared/types'
import { flushAllPending } from '../utils/flush-registry'
import { useAppStore } from './app-store'

interface EditorState {
  selectedPageId: string | null
  currentPage: Page | null
  saveStatus: 'idle' | 'saving' | 'saved'

  // Multi-select (Phase 03)
  selectedBlockIds: string[]
  isLassoActive: boolean
  lassoRect: { x: number; y: number; width: number; height: number } | null

  // Backlinks panel — persist expanded state across page navigation
  backlinksExpanded: boolean

  selectPage(id: string | null): Promise<void>
  setSaveStatus(s: 'idle' | 'saving' | 'saved'): void

  selectBlocks(ids: string[]): void
  deselectAllBlocks(): void
  toggleBlockSelection(id: string): void
  setLassoActive(active: boolean): void
  setLassoRect(rect: { x: number; y: number; width: number; height: number } | null): void
  setBacklinksExpanded(v: boolean): void
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedPageId: null,
  currentPage: null,
  saveStatus: 'idle',
  selectedBlockIds: [],
  isLassoActive: false,
  lassoRect: null,
  backlinksExpanded: false,

  async selectPage(id) {
    // Drain any pending debounced writes for the page we're leaving before
    // mutating selectedPageId — otherwise a quick switch can lose the last
    // 500ms of edits.
    await flushAllPending()
    if (!id) {
      set({ selectedPageId: null, currentPage: null })
      return
    }
    const page = await window.api.pages.getById(id)
    // Race: command palette / sidebar can hold an id for a page that was
    // deleted between fetch and click. Fall back to empty state instead of
    // showing a stale page.
    if (!page || page.is_deleted) {
      set({ selectedPageId: null, currentPage: null })
      return
    }
    useAppStore.getState().setShowTrash(false)
    set({ selectedPageId: id, currentPage: page })
  },

  setSaveStatus(s) { set({ saveStatus: s }) },

  selectBlocks(ids) { set({ selectedBlockIds: ids }) },
  deselectAllBlocks() { set({ selectedBlockIds: [], isLassoActive: false, lassoRect: null }) },
  toggleBlockSelection(id) {
    set((state) => {
      const current = state.selectedBlockIds
      if (current.includes(id)) {
        return { selectedBlockIds: current.filter((bid) => bid !== id) }
      }
      return { selectedBlockIds: [...current, id] }
    })
  },
  setLassoActive(active) { set({ isLassoActive: active }) },
  setLassoRect(rect) { set({ lassoRect: rect }) },
  setBacklinksExpanded(v) { set({ backlinksExpanded: v }) },
}))

// Helper used by app-store CRUD actions so they can mutate currentPage when
// the active page is updated/restored without importing the editor store at
// the top level (avoids circular import surface area).
export function patchCurrentPageIfMatches(id: string, patch: Partial<Page>): void {
  useEditorStore.setState((state) => {
    if (state.currentPage?.id === id) {
      return { currentPage: { ...state.currentPage, ...patch } }
    }
    return state
  })
}

export function clearSelectionIfMatches(id: string): void {
  useEditorStore.setState((state) => {
    if (state.selectedPageId === id) {
      return { selectedPageId: null, currentPage: null }
    }
    return state
  })
}
