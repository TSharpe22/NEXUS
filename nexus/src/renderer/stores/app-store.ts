import { create } from 'zustand'
import type { Page } from '../../shared/types'

const nowSql = () => new Date().toISOString().replace('T', ' ').split('.')[0]

/** Mirrors the ORDER BY in `getAllPages` so local edits keep the DB's order. */
const byTreeOrder = (a: Page, b: Page) =>
  a.sort_order - b.sort_order || b.updated_at.localeCompare(a.updated_at)

function persistExpanded(ids: Set<string>): void {
  localStorage.setItem('nx-expanded-pages', JSON.stringify([...ids]))
}

interface AppState {
  // Sidebar
  pages: Page[]
  selectedPageId: string | null
  sidebarWidth: number
  sidebarCollapsed: boolean
  searchQuery: string

  // Editor
  currentPage: Page | null
  isSaving: boolean
  saveStatus: 'idle' | 'saving' | 'saved'

  // Trash
  showTrash: boolean
  deletedPages: Page[]

  // Command palette
  commandPaletteOpen: boolean

  // Multi-select (Phase 03)
  selectedBlockIds: string[]
  isLassoActive: boolean
  lassoRect: { x: number; y: number; width: number; height: number } | null

  // Backlinks panel — persist expanded state across page navigation
  backlinksExpanded: boolean

  // Sidebar tree — which parents are expanded (UI-only, persisted locally)
  expandedPageIds: Set<string>

  // Actions
  loadPages(): Promise<void>
  loadDeletedPages(): Promise<void>
  selectPage(id: string | null): Promise<void>
  createPage(parentPageId?: string | null): Promise<void>
  updatePage(id: string, data: Partial<Page>): Promise<void>
  deletePage(id: string): Promise<void>
  restorePage(id: string): Promise<void>
  hardDeletePage(id: string): Promise<void>
  duplicatePage(id: string): Promise<void>
  movePage(pageId: string, newParentId: string | null, targetIndex: number): Promise<void>
  toggleFavorite(id: string): Promise<void>
  toggleExpanded(id: string): void
  setExpanded(id: string, expanded: boolean): void
  setSidebarWidth(w: number): void
  setSidebarCollapsed(c: boolean): void
  setSearchQuery(q: string): void
  setShowTrash(v: boolean): void
  setCommandPaletteOpen(v: boolean): void
  setSaveStatus(s: 'idle' | 'saving' | 'saved'): void

  // Multi-select actions
  selectBlocks(ids: string[]): void
  deselectAllBlocks(): void
  toggleBlockSelection(id: string): void
  setLassoActive(active: boolean): void
  setLassoRect(rect: { x: number; y: number; width: number; height: number } | null): void
  setBacklinksExpanded(v: boolean): void
}

export const useAppStore = create<AppState>((set, get) => ({
  pages: [],
  selectedPageId: null,
  sidebarWidth: parseInt(localStorage.getItem('nx-sidebar-width') || '280'),
  sidebarCollapsed: localStorage.getItem('nx-sidebar-collapsed') === 'true',
  searchQuery: '',
  currentPage: null,
  isSaving: false,
  saveStatus: 'idle',
  showTrash: false,
  deletedPages: [],
  commandPaletteOpen: false,
  selectedBlockIds: [],
  isLassoActive: false,
  lassoRect: null,
  backlinksExpanded: false,
  expandedPageIds: new Set<string>(
    JSON.parse(localStorage.getItem('nx-expanded-pages') || '[]') as string[]
  ),

  async loadPages() {
    const pages = await window.api.pages.getAll()
    set({ pages })
  },

  async loadDeletedPages() {
    const deletedPages = await window.api.pages.getDeleted()
    set({ deletedPages })
  },

  async selectPage(id) {
    if (!id) {
      set({ selectedPageId: null, currentPage: null })
      return
    }
    const page = await window.api.pages.getById(id)
    set({ selectedPageId: id, currentPage: page, showTrash: false })
  },

  async createPage(parentPageId = null) {
    const page = await window.api.pages.create(parentPageId)
    await get().loadPages()
    // A page created inside a collapsed parent would otherwise be invisible.
    if (parentPageId) get().setExpanded(parentPageId, true)
    await get().selectPage(page.id)
  },

  async updatePage(id, data) {
    await window.api.pages.update(id, data)
    const updatedAt = nowSql()
    set((state) => {
      const pages = state.pages
        .map((page) => (
          page.id === id
            ? { ...page, ...data, updated_at: updatedAt }
            : page
        ))
        .sort(byTreeOrder)

      const currentPage = state.currentPage?.id === id
        ? { ...state.currentPage, ...data, updated_at: updatedAt }
        : state.currentPage

      const deletedPages = state.deletedPages
        .map((page) => (
          page.id === id
            ? { ...page, ...data, updated_at: updatedAt }
            : page
        ))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))

      return { pages, currentPage, deletedPages }
    })
  },

  async deletePage(id) {
    await window.api.pages.softDelete(id)
    await get().loadPages()
    await get().loadDeletedPages()
    // Deleting a page takes its subtree with it, so the open page may have
    // disappeared even when it was not the one deleted.
    const { selectedPageId, pages } = get()
    if (selectedPageId && !pages.some((p) => p.id === selectedPageId)) {
      set({ selectedPageId: null, currentPage: null })
    }
  },

  async restorePage(id) {
    await window.api.pages.restore(id)
    await get().loadPages()
    await get().loadDeletedPages()
  },

  async hardDeletePage(id) {
    await window.api.pages.hardDelete(id)
    await get().loadDeletedPages()
    if (get().selectedPageId === id) {
      set({ selectedPageId: null, currentPage: null })
    }
  },

  async duplicatePage(id) {
    const newPage = await window.api.pages.duplicate(id)
    await get().loadPages()
    await get().selectPage(newPage.id)
  },

  async movePage(pageId, newParentId, targetIndex) {
    await window.api.pages.move(pageId, newParentId, targetIndex)
    await get().loadPages()
    if (newParentId) get().setExpanded(newParentId, true)
  },

  async toggleFavorite(id) {
    const page = get().pages.find((p) => p.id === id)
    if (!page) return
    await get().updatePage(id, { is_favorite: page.is_favorite ? 0 : 1 })
  },

  toggleExpanded(id) {
    const next = new Set(get().expandedPageIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    persistExpanded(next)
    set({ expandedPageIds: next })
  },

  setExpanded(id, expanded) {
    const current = get().expandedPageIds
    if (current.has(id) === expanded) return
    const next = new Set(current)
    if (expanded) next.add(id)
    else next.delete(id)
    persistExpanded(next)
    set({ expandedPageIds: next })
  },

  setSidebarWidth(w) {
    localStorage.setItem('nx-sidebar-width', String(w))
    set({ sidebarWidth: w })
  },

  setSidebarCollapsed(c) {
    localStorage.setItem('nx-sidebar-collapsed', String(c))
    set({ sidebarCollapsed: c })
  },

  setSearchQuery(q) {
    set({ searchQuery: q })
  },

  setShowTrash(v) {
    set({ showTrash: v })
    if (v) get().loadDeletedPages()
  },

  setCommandPaletteOpen(v) {
    set({ commandPaletteOpen: v })
  },

  setSaveStatus(s) {
    set({ saveStatus: s })
  },

  selectBlocks(ids) {
    set({ selectedBlockIds: ids })
  },

  deselectAllBlocks() {
    set({ selectedBlockIds: [], isLassoActive: false, lassoRect: null })
  },

  toggleBlockSelection(id) {
    set((state) => {
      const current = state.selectedBlockIds
      if (current.includes(id)) {
        return { selectedBlockIds: current.filter((bid) => bid !== id) }
      }
      return { selectedBlockIds: [...current, id] }
    })
  },

  setLassoActive(active) {
    // No-op when unchanged. LassoSelect's document-level mouseup handler runs
    // on every click in the app; an unconditional set() here published a new
    // store object each time, re-rendering every whole-store subscriber
    // (Editor included) on every mouseup.
    if (get().isLassoActive === active) return
    set({ isLassoActive: active })
  },

  setLassoRect(rect) {
    set({ lassoRect: rect })
  },

  setBacklinksExpanded(v) {
    set({ backlinksExpanded: v })
  },
}))
