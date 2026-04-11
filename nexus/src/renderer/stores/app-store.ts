import { create } from 'zustand'
import type { Page } from '../../shared/types'

const nowSql = () => new Date().toISOString().replace('T', ' ').split('.')[0]

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

  // Actions
  loadPages(): Promise<void>
  loadDeletedPages(): Promise<void>
  selectPage(id: string | null): Promise<void>
  createPage(): Promise<void>
  updatePage(id: string, data: Partial<Page>): Promise<void>
  deletePage(id: string): Promise<void>
  restorePage(id: string): Promise<void>
  hardDeletePage(id: string): Promise<void>
  duplicatePage(id: string): Promise<void>
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

  async createPage() {
    const page = await window.api.pages.create()
    await get().loadPages()
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
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))

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
    if (get().selectedPageId === id) {
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
    set({ isLassoActive: active })
  },

  setLassoRect(rect) {
    set({ lassoRect: rect })
  },
}))
