import { create } from 'zustand'
import type { ViewDef, ViewDraft } from '@shared/views'
import type { CaptureTarget, Folder, Page, PageListItem, Preferences, Tag, TagWithCount, TypeDef } from '@shared/types'
import { DEFAULT_DAY_START_HOUR, logicalDateISO } from '@shared/day'
import { localDateISO } from '@shared/journal-date'

export type View = 'home' | 'notes' | 'views' | 'tracker' | 'settings'

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
  views: { label: 'Views', hint: 'Saved questions about the vault' },
  tracker: { label: 'Tracker', hint: "What's due, week by week" },
  settings: { label: 'Settings', hint: 'Types, data, import and export' }
}

export const VIEW_ORDER = Object.keys(VIEW_META) as View[]

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** Tracker's three modes. Habits is not a date range, which is why it sits alongside one. */
export type TrackerMode = 'week' | 'quarter' | 'habits'

interface AppState {
  activeView: View
  activePageId: string | null
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
  /**
   * Saved views, and which one is open.
   *
   * The list lives here rather than in the screen because a view is reachable
   * from more than the screen — a pinned one belongs in the sidebar, and the
   * palette should be able to jump to one. The rows a view returns do *not*
   * live here: they are a query result, they go stale the moment anything is
   * written, and caching them is how a board would show a page it no longer
   * matches.
   */
  views: ViewDef[]
  activeViewId: string | null
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
  /**
   * Type ids the Notes list is filtered by; any of them matches.
   *
   * A separate axis from tags, and it exists because removing Tables took the
   * only way to ask "show me every Book" with it. That question is what a type
   * is *for*, and the Notes list already holds every page and its `type_id` —
   * it was one filter short of answering it.
   */
  activeTypeFilter: string[]
  /** Tags on the page currently open in the editor. */
  activePageTags: Tag[]

  saveStatus: SaveStatus

  /**
   * Settings, not data. Loaded once at boot and kept here so every view asks
   * the same question of the same answer — the bug being fixed was three views
   * disagreeing about what day it is.
   */
  prefs: Preferences

  /**
   * What day it is, by `prefs.dayStartHour`.
   *
   * A value in the store rather than a date each reader works out for itself.
   * `useToday()` used to compute it inside a selector, and a selector only
   * re-runs when something writes to the store — so a window left open past
   * the day-start hour went on answering yesterday until some unrelated action
   * happened to wake it: the journal button opening the entry for the day
   * before, the tracker marking the wrong row, overdue a day out. That is the
   * late-night session `shared/day.ts` was written for, so it was the one case
   * the feature did not cover. Computing it in a selector was also impure —
   * two components rendering in the same pass could be handed different days.
   */
  today: string

  /**
   * The calendar date on the wall clock, which is not always `today`.
   *
   * Home's header shows this one. Rendering the logical day there made moving
   * the day-start hour look like the app's clock had been changed: set the
   * start to 6pm at 5pm and the header read yesterday's date, with no way to
   * tell that was deliberate. The logical day decides what gets filed where;
   * it does not get to decide what day it is.
   */
  wallToday: string

  setActiveView: (view: View) => void
  setDayStartHour: (hour: number) => Promise<void>
  setTaskSection: (name: string) => Promise<void>
  /** The system-wide capture key; '' turns it off. */
  setCaptureAccelerator: (accelerator: string) => Promise<void>
  /** Open the inbox page, making it on first use. */
  openInbox: () => Promise<Page>
  setActivePageId: (id: string | null) => void
  /**
   * Pull a page's body into `pageContent` if it is not already there. Every
   * path that opens a page goes through this; the editor waits on it rather
   * than mounting against a body it does not have yet.
   */
  loadPageContent: (id: string) => Promise<void>
  /** Navigate to a page from anywhere: switches to Notes and selects it. */
  openPage: (id: string) => void
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
  /** One of the four semantic colour names from `tokens.css`. */
  setTagColor: (id: string, color: string) => Promise<void>
  deleteTag: (id: string) => Promise<void>
  toggleTagFilter: (tagId: string) => void
  clearTagFilter: () => void
  toggleTypeFilter: (typeId: string) => void
  clearTypeFilter: () => void

  refreshViews: () => Promise<void>
  setActiveViewId: (id: string | null) => void
  /** Make a view and open it. */
  createView: (draft: ViewDraft) => Promise<ViewDef>
  saveView: (id: string, patch: ViewDraft) => Promise<void>
  deleteView: (id: string) => Promise<void>
  /** Jump to a view from anywhere: switches to Views and selects it. */
  openView: (id: string) => void
}

/** How long "saved" stays on screen before the indicator goes quiet again. */
const SAVED_VISIBLE_MS = 1600
let saveStatusTimer: ReturnType<typeof setTimeout> | undefined

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
  activeTypeFilter: [],
  views: [],
  activeViewId: null,
  activePageTags: [],

  saveStatus: 'idle',

  prefs: {
    dayStartHour: DEFAULT_DAY_START_HOUR,
    taskSection: 'Tasks',
    captureAccelerator: '',
    captureAcceleratorActive: false
  },
  today: logicalDateISO(DEFAULT_DAY_START_HOUR),
  wallToday: localDateISO(),

  setActiveView: (view) => set({ activeView: view }),

  setDayStartHour: async (hour) => {
    const stored = await window.api.prefs.setDayStartHour(hour)
    set((state) => ({ prefs: { ...state.prefs, dayStartHour: stored } }))
    // Moving the hour can move the day — at 1am, going from 4 to midnight
    // makes it today rather than yesterday, and the views must not wait for
    // the next tick to hear about it.
    tickToday()
  },

  setTaskSection: async (name) => {
    const stored = await window.api.prefs.setTaskSection(name)
    set((state) => ({ prefs: { ...state.prefs, taskSection: stored } }))
  },

  setCaptureAccelerator: async (accelerator) => {
    // `active` is not the same as "stored": another application may already
    // hold the combination, and Settings says so rather than showing a key
    // that quietly does nothing.
    const { accelerator: stored, active } = await window.api.prefs.setCaptureAccelerator(accelerator)
    set((state) => ({
      prefs: { ...state.prefs, captureAccelerator: stored, captureAcceleratorActive: active }
    }))
  },

  openInbox: async () => {
    const page = await window.api.inbox.open()
    await get().refresh()
    set((state) => ({
      activeView: 'notes',
      activePageId: page.id,
      pageContent: { ...state.pageContent, [page.id]: page.content }
    }))
    void get().loadPageTags(page.id)
    return page
  },
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
  setTrackerMode: (mode) => set({ trackerMode: mode }),
  setSaveStatus: (status) => {
    // "saved" is a confirmation, not a state to sit in. Left latched, the
    // topbar read "saved" forever after the first save — on every view, hours
    // later — which makes it say nothing at all about the save you just made.
    // An error stays until the next save resolves it: that one is not news
    // that expires.
    clearTimeout(saveStatusTimer)
    set({ saveStatus: status })
    if (status === 'saved') {
      saveStatusTimer = setTimeout(
        () => useAppStore.getState().saveStatus === 'saved' && useAppStore.setState({ saveStatus: 'idle' }),
        SAVED_VISIBLE_MS
      )
    }
  },

  refresh: async () => {
    const [pages, trashed, types, folders, tags, prefs] = await Promise.all([
      window.api.pages.list(),
      window.api.pages.listDeleted(),
      window.api.types.list(),
      window.api.folders.list(),
      window.api.tags.list(),
      window.api.prefs.get()
    ])
    set((state) => ({
      pages,
      trashed,
      types,
      folders,
      tags,
      prefs,
      loaded: true,
      // Drop filters pointing at tags that no longer exist.
      activeTagFilter: state.activeTagFilter.filter((id) => tags.some((t) => t.id === id)),
      // Same for a type deleted while it was filtering the list.
      activeTypeFilter: state.activeTypeFilter.filter((id) => types.some((t) => t.id === id))
    }))
    // `prefs` has just come off disk, and the hour it carries may not be the
    // default the store started with — the first boot after this line runs is
    // the only chance to notice before the next tick.
    tickToday()
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
    await get().refresh()
    return result
  },

  /**
   * A content-only patch leaves `pages` alone, and that is the whole point of
   * the branch.
   *
   * Every autosave calls this, so rebuilding the array unconditionally handed
   * a new identity to everything selecting `pages` — the folder tree, Home,
   * the command palette — every 600ms while a sentence was being typed. Worse,
   * it handed the open page a new object, which walked down through
   * `activeEntry` into a fresh `page` prop for the editor and the properties
   * panel: the save the typing triggered re-rendered the editor doing the
   * typing. Nothing about a body change is visible in a list that does not
   * carry bodies.
   */
  patchPage: (id, patch) =>
    set((state) => {
      const { content, ...rest } = patch
      const touchesList = Object.keys(rest).length > 0
      return {
        pages: touchesList ? state.pages.map((p) => (p.id === id ? { ...p, ...rest } : p)) : state.pages,
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

  setTagColor: async (id, color) => {
    await window.api.tags.setColor(id, color)
    await get().refresh()
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

  clearTagFilter: () => set({ activeTagFilter: [] }),

  toggleTypeFilter: (typeId) =>
    set((state) => ({
      activeTypeFilter: state.activeTypeFilter.includes(typeId)
        ? state.activeTypeFilter.filter((id) => id !== typeId)
        : [...state.activeTypeFilter, typeId]
    })),

  clearTypeFilter: () => set({ activeTypeFilter: [] }),

  // ----------------------------------------------------------
  // Views
  // ----------------------------------------------------------

  refreshViews: async () => {
    const views = await window.api.views.list()
    set((state) => ({
      views,
      // A view deleted in another window, or by an import, must not stay
      // selected — the screen would ask for rows of something that is gone.
      activeViewId: views.some((v) => v.id === state.activeViewId) ? state.activeViewId : null
    }))
  },

  setActiveViewId: (id) => set({ activeViewId: id }),

  createView: async (draft) => {
    const view = await window.api.views.create(draft)
    await get().refreshViews()
    set({ activeViewId: view.id })
    return view
  },

  saveView: async (id, patch) => {
    await window.api.views.update(id, patch)
    await get().refreshViews()
  },

  deleteView: async (id) => {
    await window.api.views.remove(id)
    await get().refreshViews()
  },

  openView: (id) => set({ activeView: 'views', activeViewId: id })
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


/** How often the day is re-checked. A minute is finer than any view needs. */
const TICK_MS = 60_000

/**
 * Recompute the day, and write it only when it has actually changed.
 *
 * Zustand notifies on every `setState`, so a ticker that wrote the same string
 * once a minute would re-render every view that reads the store, all night,
 * for nothing.
 */
function tickToday(): void {
  const { prefs, today: current, wallToday: currentWall } = useAppStore.getState()
  const now = logicalDateISO(prefs.dayStartHour)
  const wall = localDateISO()
  // Two dates, one tick. They move at different moments — the wall date turns
  // over at midnight and the logical one at the day-start hour — and between
  // those two instants they disagree, which is the whole point of the setting.
  if (now !== current) useAppStore.setState({ today: now })
  if (wall !== currentWall) useAppStore.setState({ wallToday: wall })
}

// The only interval in the renderer, and it is meant to stay the only one:
// everything else here moves when the user or the main process moves it.
setInterval(tickToday, TICK_MS)
// An interval does not fire while the machine is asleep, and a laptop closed
// at 11pm and opened the next morning is exactly the window this covers — the
// app comes back to focus owing a day.
window.addEventListener('focus', tickToday)

/**
 * What day it is, according to the day-start hour.
 *
 * Every view used `localDateISO()` directly, which is calendar midnight —
 * so at 1am the tracker, the journal button and the overdue rule all silently
 * disagreed with the person still working. This is the one answer they share.
 */
export function useToday(): string {
  return useAppStore((s) => s.today)
}

/** The same, for code outside a component. */
export function today(): string {
  return useAppStore.getState().today
}

/** The calendar date, for the one place that shows a clock rather than a day. */
export function useWallToday(): string {
  return useAppStore((s) => s.wallToday)
}
