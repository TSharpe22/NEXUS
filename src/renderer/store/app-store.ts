import { create } from 'zustand'
import type { Page, TypeDef } from '@shared/types'

export type View = 'home' | 'notes' | 'tables' | 'activity' | 'settings'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface AppState {
  activeView: View
  activePageId: string | null
  tableTypeId: string | null

  /**
   * Pages, trash and types live here rather than in each view. Every entry
   * point into a page — the command palette, a [[mention]] chip, a backlink, a
   * row on Home — sets `activePageId`, and previously the Notes view resolved
   * that against its own list. Anything created or renamed elsewhere wasn't in
   * that list yet, so the view fell through to "No page selected". One copy of
   * the data means every one of those paths resolves.
   */
  pages: Page[]
  trashed: Page[]
  types: TypeDef[]
  loaded: boolean

  saveStatus: SaveStatus

  setActiveView: (view: View) => void
  setActivePageId: (id: string | null) => void
  /** Navigate to a page from anywhere: switches to Notes and selects it. */
  openPage: (id: string) => void
  setTableTypeId: (id: string | null) => void
  setSaveStatus: (status: SaveStatus) => void

  refresh: () => Promise<void>
  createPage: (typeId?: string) => Promise<Page>
  duplicatePage: (id: string) => Promise<Page>
  trashPage: (id: string) => Promise<void>
  restorePage: (id: string) => Promise<void>
  deletePageForever: (id: string) => Promise<void>
  emptyTrash: () => Promise<number>
  setPageType: (id: string, typeId: string) => Promise<void>
  createType: (name: string) => Promise<TypeDef>
  renameType: (id: string, name: string) => Promise<void>
  deleteType: (id: string) => Promise<{ reassigned: number }>
  /** Reflect an edit locally without a round trip; the editor already persisted it. */
  patchPage: (id: string, patch: Partial<Page>) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  activeView: 'home',
  activePageId: null,
  tableTypeId: null,

  pages: [],
  trashed: [],
  types: [],
  loaded: false,

  saveStatus: 'idle',

  setActiveView: (view) => set({ activeView: view }),
  setActivePageId: (id) => set({ activePageId: id }),
  openPage: (id) => set({ activeView: 'notes', activePageId: id }),
  setTableTypeId: (id) => set({ tableTypeId: id }),
  setSaveStatus: (status) => set({ saveStatus: status }),

  refresh: async () => {
    const [pages, trashed, types] = await Promise.all([
      window.api.pages.getAll(),
      window.api.pages.getDeleted(),
      window.api.types.list()
    ])
    set({ pages, trashed, types, loaded: true })
  },

  createPage: async (typeId) => {
    const page = await window.api.pages.create(typeId)
    await get().refresh()
    set({ activeView: 'notes', activePageId: page.id })
    return page
  },

  duplicatePage: async (id) => {
    const copy = await window.api.pages.duplicate(id)
    await get().refresh()
    set({ activeView: 'notes', activePageId: copy.id })
    return copy
  },

  trashPage: async (id) => {
    await window.api.pages.softDelete(id)
    if (get().activePageId === id) set({ activePageId: null })
    await get().refresh()
  },

  restorePage: async (id) => {
    await window.api.pages.restore(id)
    await get().refresh()
  },

  deletePageForever: async (id) => {
    await window.api.pages.hardDelete(id)
    if (get().activePageId === id) set({ activePageId: null })
    await get().refresh()
  },

  emptyTrash: async () => {
    const count = await window.api.pages.emptyTrash()
    await get().refresh()
    return count
  },

  setPageType: async (id, typeId) => {
    await window.api.pages.setType(id, typeId)
    await get().refresh()
  },

  createType: async (name) => {
    const type = await window.api.types.create(name)
    await get().refresh()
    return type
  },

  renameType: async (id, name) => {
    await window.api.types.rename(id, name)
    await get().refresh()
  },

  deleteType: async (id) => {
    const result = await window.api.types.remove(id)
    const { tableTypeId } = get()
    if (tableTypeId === id) set({ tableTypeId: null })
    await get().refresh()
    return result
  },

  patchPage: (id, patch) =>
    set((state) => ({
      pages: state.pages.map((p) => (p.id === id ? { ...p, ...patch } : p))
    }))
}))

/** Look up a page by id across both live pages and trash. */
export function usePageById(id: string | null): Page | null {
  return useAppStore((s) => {
    if (!id) return null
    return s.pages.find((p) => p.id === id) ?? s.trashed.find((p) => p.id === id) ?? null
  })
}
