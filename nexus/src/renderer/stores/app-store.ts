import { create } from 'zustand'
import type { Page } from '../../shared/types'
import { nx } from '../utils/toast'
import {
  useEditorStore,
  patchCurrentPageIfMatches,
  clearSelectionIfMatches,
} from './editor-store'

const nowSql = () => new Date().toISOString().replace('T', ' ').split('.')[0]

interface AppState {
  // Sidebar / page list
  pages: Page[]
  sidebarWidth: number
  sidebarCollapsed: boolean
  searchQuery: string

  // Trash
  showTrash: boolean
  deletedPages: Page[]

  // Command palette
  commandPaletteOpen: boolean

  // Actions
  loadPages(): Promise<void>
  loadDeletedPages(): Promise<void>
  createPage(): Promise<void>
  updatePage(id: string, data: Partial<Page>): Promise<void>
  deletePage(id: string): Promise<void>
  restorePage(id: string): Promise<void>
  hardDeletePage(id: string): Promise<void>
  duplicatePage(id: string): Promise<void>
  emptyTrash(): Promise<number>
  setSidebarWidth(w: number): void
  setSidebarCollapsed(c: boolean): void
  setSearchQuery(q: string): void
  setShowTrash(v: boolean): void
  setCommandPaletteOpen(v: boolean): void
}

export const useAppStore = create<AppState>((set, get) => ({
  pages: [],
  sidebarWidth: parseInt(localStorage.getItem('nx-sidebar-width') || '280'),
  sidebarCollapsed: localStorage.getItem('nx-sidebar-collapsed') === 'true',
  searchQuery: '',
  showTrash: false,
  deletedPages: [],
  commandPaletteOpen: false,

  async loadPages() {
    const pages = await window.api.pages.getAll()
    set({ pages })
  },

  async loadDeletedPages() {
    const deletedPages = await window.api.pages.getDeleted()
    set({ deletedPages })
  },

  async createPage() {
    try {
      const page = await window.api.pages.create()
      await get().loadPages()
      await useEditorStore.getState().selectPage(page.id)
    } catch {
      nx.error('Failed to create page')
    }
  },

  async updatePage(id, data) {
    try {
      await window.api.pages.update(id, data)
    } catch {
      nx.error('Failed to save changes')
      return
    }
    const updatedAt = nowSql()
    set((state) => {
      const pages = state.pages
        .map((page) => (
          page.id === id ? { ...page, ...data, updated_at: updatedAt } : page
        ))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))

      const deletedPages = state.deletedPages
        .map((page) => (
          page.id === id ? { ...page, ...data, updated_at: updatedAt } : page
        ))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))

      return { pages, deletedPages }
    })
    patchCurrentPageIfMatches(id, { ...data, updated_at: updatedAt })
  },

  async deletePage(id) {
    try {
      await window.api.pages.softDelete(id)
    } catch {
      nx.error('Failed to delete page')
      return
    }
    await get().loadPages()
    await get().loadDeletedPages()
    clearSelectionIfMatches(id)
  },

  async restorePage(id) {
    try {
      await window.api.pages.restore(id)
    } catch {
      nx.error('Failed to restore page')
      return
    }
    await get().loadPages()
    await get().loadDeletedPages()
    // Spec §1.2: restoring a page from trash auto-selects it.
    await useEditorStore.getState().selectPage(id)
  },

  async hardDeletePage(id) {
    try {
      await window.api.pages.hardDelete(id)
    } catch {
      nx.error('Failed to permanently delete page')
      return
    }
    await get().loadDeletedPages()
    clearSelectionIfMatches(id)
  },

  async duplicatePage(id) {
    try {
      const newPage = await window.api.pages.duplicate(id)
      await get().loadPages()
      await useEditorStore.getState().selectPage(newPage.id)
    } catch {
      nx.error('Failed to duplicate page')
    }
  },

  async emptyTrash() {
    const count = await window.api.pages.emptyTrash()
    await get().loadDeletedPages()
    return count
  },

  setSidebarWidth(w) {
    localStorage.setItem('nx-sidebar-width', String(w))
    set({ sidebarWidth: w })
  },

  setSidebarCollapsed(c) {
    localStorage.setItem('nx-sidebar-collapsed', String(c))
    set({ sidebarCollapsed: c })
  },

  setSearchQuery(q) { set({ searchQuery: q }) },

  setShowTrash(v) {
    set({ showTrash: v })
    if (v) get().loadDeletedPages()
  },

  setCommandPaletteOpen(v) { set({ commandPaletteOpen: v }) },
}))
