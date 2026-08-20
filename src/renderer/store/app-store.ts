import { create } from 'zustand'
import type { CaptureTarget, Folder, Page, PageListItem, Tag, TagWithCount, TypeDef } from '@shared/types'

export type View = 'home' | 'notes' | 'tables' | 'tracker' | 'activity' | 'settings'

/**
 * The nav sections, in the order they appear.
 *
 * One list, because there were two: the sidebar's and the command palette's.
 * Adding the Tracker updated the sidebar and left ⌘K unable to reach it —
 * `App.tsx`'s `Record<View, …>` maps made every other omission a compile
 * error, and the palette's hand-written array was the one place that could go
 * stale in silence.
 *
 * A `Record` so a new member of `View` cannot be left out, and the nav order
 * is the key order — insertion order, which JS guarantees for string keys.
 */
export const VIEW_META: Record<View, { label: string; hint: string }> = {
  home: { label: 'Home', hint: 'Overview and graph' },
  notes: { label: 'Notes', hint: 'Write and edit pages' },
  tables: { label: 'Tables', hint: 'Browse pages by type' },
  tracker: { label: 'Tracker', hint: "What's due, week by week" },
  activity: { label: 'Activity', hint: 'What changed, when' },
  settings: { label: 'Settings', hint: 'Data, import and export' }
}

export const VIEW_ORDER = Object.keys(VIEW_META) as View[]

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** Tracker's three modes. Habits is not a date range, which is why it sits alongside one. */
export type TrackerMode = 'week' | 'quarter' | 'habits'

interface AppState {
  activeView: View
  activePageId: string | null
  tableTypeId: string | null
  /**
   * Which of Tracker's three modes is showing. In the store rather than in
   * `Tracker` so Home's habit panel can land on Habits — a link that dumps you
   * on Week and leaves you to find the tab is not a link.
   */
  trackerMode: TrackerMode

  /**
   * Pages, trash and types live here rather than in each view. Every entry
   * point into a page — the command palette, a [[mention]] chip, a backlink, a
   * row on Home — sets `activePageId`, and previously the Notes view resolved
   * that against its own list. Anything created or renamed elsewhere wasn't in
   * that list yet, so the view fell through to "No page selected". One copy of
   * the data means every one of those paths resolves.
   */
  pages: PageListItem[]
  trashed: PageListItem[]
  types: TypeDef[]
  folders: Folder[]
  tags: TagWithCount[]
  loaded: boolean

  /**
   * Document bodies for pages that have been opened, keyed by page id.
   *
   * `pages` carries no body, so this is where the editor's document comes
   * from. It is a cache the renderer *owns* rather than a copy of a list: it
   * is written when a page is loaded and on every save, and never dropped
   * while the app runs. That is deliberate. Re-reading the body from the
   * database on each open would race a save that has been flushed but not yet
   * committed, and handing BlockNote a stale document is how a page came back
   * empty and then saved that emptiness over the real one.
   */
  pageContent: Record<string, string>

  /** Folder ids currently expanded in the Notes tree; persisted. */
  expandedFolderIds: string[]
  /** Tag ids the Notes list is filtered by. A page matches if it has any of them. */
  activeTagFilter: string[]
  /** Tags on the page currently open in the editor. */
  activePageTags: Tag[]

  saveStatus: SaveStatus

  setActiveView: (view: View) => void
  setActivePageId: (id: string | null) => void
  /**
   * Pull a page's body into `pageContent` if it is not already there. Every
   * path that opens a page goes through this; the editor waits on it rather
   * than mounting against a body it does not have yet.
   */
  loadPageContent: (id: string) => Promise<void>
  /** Navigate to a page from anywhere: switches to Notes and selects it. */
  openPage: (id: string) => void
  setTableTypeId: (id: string | null) => void
  setTrackerMode: (mode: TrackerMode) => void
  setSaveStatus: (status: SaveStatus) => void

  refresh: () => Promise<void>
  createPage: (typeId?: string) => Promise<Page>
  /** Open today's journal entry, creating it from the template if needed. */
  openTodayEntry: () => Promise<Page>
  duplicatePage: (id: string) => Promise<Page>
  /** Pin a page to Home, or unpin it. */
  setPagePinned: (id: string, pinned: boolean) => Promise<void>
  /**
   * Capture one line from Home. Resolves with the page it landed on, without
   * navigating — capture is meant to cost nothing but the typing.
   */
  capture: (text: string, target: CaptureTarget) => Promise<Page>
  trashPage: (id: string) => Promise<void>
  restorePage: (id: string) => Promise<void>
  deletePageForever: (id: string) => Promise<void>
  emptyTrash: () => Promise<number>
  setPageType: (id: string, typeId: string) => Promise<void>
  createType: (name: string) => Promise<TypeDef>
  renameType: (id: string, name: string) => Promise<void>
  deleteType: (id: string) => Promise<{ reassigned: number }>
  /**
   * Reflect an edit locally without a round trip; the caller already persisted
   * it. A `content` in the patch lands in `pageContent`, everything else on
   * the list entry — the two halves of a page now live in different places.
   */
  patchPage: (id: string, patch: Partial<Page>) => void

  createFolder: (name: string, parentFolderId: string | null) => Promise<Folder>
  renameFolder: (id: string, name: string) => Promise<void>
  moveFolder: (id: string, parentFolderId: string | null) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  movePageToFolder: (pageId: string, folderId: string | null) => Promise<void>
  toggleFolderExpanded: (id: string) => void
  setFolderExpanded: (id: string, expanded: boolean) => void

  loadPageTags: (pageId: string) => Promise<void>
  addTag: (pageId: string, name: string) => Promise<void>
  removeTag: (pageId: string, tagId: string) => Promise<void>
  renameTag: (id: string, name: string) => Promise<void>
  deleteTag: (id: string) => Promise<void>
  toggleTagFilter: (tagId: string) => void
  clearTagFilter: () => void
}

/**
 * Expanded folders survive a restart — collapsing a tree and finding it sprung
 * open again is exactly the friction folders exist to remove.
 */
function readExpandedFolders(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('nx-expanded-folders') ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  activeView: 'home',
  activePageId: null,
  tableTypeId: null,
  trackerMode: 'week',

  pages: [],
  trashed: [],
  pageContent: {},
  types: [],
  folders: [],
  tags: [],
  loaded: false,

  expandedFolderIds: readExpandedFolders(),
  activeTagFilter: [],
  activePageTags: [],

  saveStatus: 'idle',

  setActiveView: (view) => set({ activeView: view }),
  setActivePageId: (id) => {
    set({ activePageId: id, activePageTags: [] })
    if (id) {
      void get().loadPageTags(id)
      void get().loadPageContent(id)
    }
  },
  openPage: (id) => {
    set({ activeView: 'notes', activePageId: id, activePageTags: [] })
    void get().loadPageTags(id)
    void get().loadPageContent(id)
  },

  loadPageContent: async (id) => {
    if (get().pageContent[id] !== undefined) return
    const page = await window.api.pages.getById(id)
    if (!page) return
    // Re-checked after the await: a save that landed while this was in flight
    // holds the newer body, and overwriting it with what the database had
    // before that save is the stale-document bug all over again.
    if (get().pageContent[id] !== undefined) return
    set((state) => ({ pageContent: { ...state.pageContent, [id]: page.content } }))
  },
  setTableTypeId: (id) => set({ tableTypeId: id }),
  setTrackerMode: (mode) => set({ trackerMode: mode }),
  setSaveStatus: (status) => set({ saveStatus: status }),

  refresh: async () => {
    const [pages, trashed, types, folders, tags] = await Promise.all([
      window.api.pages.list(),
      window.api.pages.listDeleted(),
      window.api.types.list(),
      window.api.folders.list(),
      window.api.tags.list()
    ])
    set((state) => ({
      pages,
      trashed,
      types,
      folders,
      tags,
      loaded: true,
      // Drop filters pointing at tags that no longer exist.
      activeTagFilter: state.activeTagFilter.filter((id) => tags.some((t) => t.id === id))
    }))
  },

  openTodayEntry: async () => {
    const page = await window.api.journal.today()
    await get().refresh()
    // The entry lives in the Journal folder; open that folder so the page
    // appears in context rather than seemingly from nowhere.
    if (page.folder_id) get().setFolderExpanded(page.folder_id, true)
    set((state) => ({
      activeView: 'notes',
      activePageId: page.id,
      pageContent: { ...state.pageContent, [page.id]: page.content }
    }))
    void get().loadPageTags(page.id)
    return page
  },

  createPage: async (typeId) => {
    const page = await window.api.pages.create(typeId)
    await get().refresh()
    set((state) => ({
      activeView: 'notes',
      activePageId: page.id,
      pageContent: { ...state.pageContent, [page.id]: page.content }
    }))
    return page
  },

  duplicatePage: async (id) => {
    const copy = await window.api.pages.duplicate(id)
    await get().refresh()
    set((state) => ({
      activeView: 'notes',
      activePageId: copy.id,
      pageContent: { ...state.pageContent, [copy.id]: copy.content }
    }))
    return copy
  },

  setPagePinned: async (id, pinned) => {
    await window.api.pages.setPinned(id, pinned)
    await get().refresh()
  },

  capture: async (text, target) => {
    const page = await window.api.capture.line(text, target)
    // A journal or task capture appends to a document the main process just
    // rewrote. `pageContent` is a cache the renderer owns and never drops, so
    // a body cached from earlier in the session is now behind — and handing
    // that stale document back to the editor is precisely how a page saves
    // over what was written into it elsewhere.
    set((state) => ({ pageContent: { ...state.pageContent, [page.id]: page.content } }))
    await get().refresh()
    return page
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
    set((state) => {
      const { content, ...rest } = patch
      return {
        pages: state.pages.map((p) => (p.id === id ? { ...p, ...rest } : p)),
        pageContent:
          content === undefined ? state.pageContent : { ...state.pageContent, [id]: content }
      }
    }),

  // ----------------------------------------------------------
  // Folders
  // ----------------------------------------------------------

  createFolder: async (name, parentFolderId) => {
    const folder = await window.api.folders.create(name, parentFolderId)
    await get().refresh()
    // A new subfolder is useless if its parent stays shut.
    if (parentFolderId) get().setFolderExpanded(parentFolderId, true)
    get().setFolderExpanded(folder.id, true)
    return folder
  },

  renameFolder: async (id, name) => {
    await window.api.folders.rename(id, name)
    await get().refresh()
  },

  moveFolder: async (id, parentFolderId) => {
    await window.api.folders.move(id, parentFolderId)
    await get().refresh()
    if (parentFolderId) get().setFolderExpanded(parentFolderId, true)
  },

  deleteFolder: async (id) => {
    await window.api.folders.remove(id)
    await get().refresh()
  },

  movePageToFolder: async (pageId, folderId) => {
    await window.api.pages.move(pageId, folderId)
    set((state) => ({
      pages: state.pages.map((p) => (p.id === pageId ? { ...p, folder_id: folderId } : p))
    }))
    if (folderId) get().setFolderExpanded(folderId, true)
  },

  toggleFolderExpanded: (id) => get().setFolderExpanded(id, !get().expandedFolderIds.includes(id)),

  setFolderExpanded: (id, expanded) =>
    set((state) => {
      if (state.expandedFolderIds.includes(id) === expanded) return state
      const next = expanded
        ? [...state.expandedFolderIds, id]
        : state.expandedFolderIds.filter((f) => f !== id)
      localStorage.setItem('nx-expanded-folders', JSON.stringify(next))
      return { expandedFolderIds: next }
    }),

  // ----------------------------------------------------------
  // Tags
  // ----------------------------------------------------------

  loadPageTags: async (pageId) => {
    const tags = await window.api.tags.getForPage(pageId)
    // Guard against a slow response landing after the user moved on.
    if (get().activePageId !== pageId) return
    set({ activePageTags: tags })
  },

  addTag: async (pageId, name) => {
    await window.api.tags.addToPage(pageId, name)
    await Promise.all([get().loadPageTags(pageId), get().refresh()])
  },

  removeTag: async (pageId, tagId) => {
    await window.api.tags.removeFromPage(pageId, tagId)
    await Promise.all([get().loadPageTags(pageId), get().refresh()])
  },

  renameTag: async (id, name) => {
    await window.api.tags.rename(id, name)
    const active = get().activePageId
    await Promise.all([get().refresh(), active ? get().loadPageTags(active) : Promise.resolve()])
  },

  deleteTag: async (id) => {
    await window.api.tags.remove(id)
    const active = get().activePageId
    await Promise.all([get().refresh(), active ? get().loadPageTags(active) : Promise.resolve()])
  },

  toggleTagFilter: (tagId) =>
    set((state) => ({
      activeTagFilter: state.activeTagFilter.includes(tagId)
        ? state.activeTagFilter.filter((id) => id !== tagId)
        : [...state.activeTagFilter, tagId]
    })),

  clearTagFilter: () => set({ activeTagFilter: [] })
}))

/**
 * Look up a page by id across both live pages and trash. Carries no body —
 * callers wanting one read `pageContent`.
 */
export function usePageById(id: string | null): PageListItem | null {
  return useAppStore((s) => {
    if (!id) return null
    return s.pages.find((p) => p.id === id) ?? s.trashed.find((p) => p.id === id) ?? null
  })
}
