import { useAppStore, type TrackerMode, type View } from './app-store'

/**
 * Back and Forward, across the whole app.
 *
 * Nothing calls in here to record a move. There are dozens of ways to go
 * somewhere — the sidebar, ⌘K, a [[mention]], a tile, a widget's "tracker →",
 * a made page opening itself — and asking each to remember to push history is
 * how one gets forgotten. Instead this watches where the store says you are
 * and records it once it settles: an open often lands in two or three
 * `set`s (switch to Notes, then the page, then its body), and only the place
 * it ends up is somewhere you went.
 */

interface Location {
  view: View
  commandId: string | null
  pageId: string | null
  viewId: string | null
  canvasId: string | null
  trackerMode: TrackerMode
}

/** How long a move has to sit still before it counts. */
const SETTLE_MS = 150
const LIMIT = 100

let entries: Location[] = []
let index = -1
/** Set while Back / Forward is putting a location on screen, so it is not recorded as a new move. */
let restoring = false
let timer: ReturnType<typeof setTimeout> | undefined

function current(): Location {
  const s = useAppStore.getState()
  return {
    view: s.activeView,
    commandId: s.activeCommandId,
    pageId: s.activePageId,
    viewId: s.activeViewId,
    canvasId: s.activeCanvasId,
    trackerMode: s.trackerMode
  }
}

/** Two locations are the same place if what is on screen is the same — only the field the view shows counts. */
function same(a: Location, b: Location): boolean {
  if (a.view !== b.view) return false
  switch (a.view) {
    case 'home':
      return a.commandId === b.commandId
    case 'notes':
      return a.pageId === b.pageId
    case 'views':
      return a.viewId === b.viewId
    case 'canvas':
      return a.canvasId === b.canvasId
    case 'tracker':
      return a.trackerMode === b.trackerMode
    default:
      return true
  }
}

function publish(): void {
  useAppStore.setState({ canGoBack: index > 0, canGoForward: index < entries.length - 1 })
}

function record(): void {
  const here = current()
  // Home before the command list has loaded is not a place yet.
  if (here.view === 'home' && here.commandId === null) return
  if (index >= 0 && same(entries[index], here)) {
    // Same place, newer detail (the tracker mode under Notes, say): keep it current.
    entries[index] = here
    return
  }
  entries = [...entries.slice(0, index + 1), here].slice(-LIMIT)
  index = entries.length - 1
  publish()
}

/** Whether a location can still be shown — a page or view may have been deleted since. */
function reachable(loc: Location): boolean {
  const s = useAppStore.getState()
  switch (loc.view) {
    case 'home':
      return !!s.commands?.pages.some((p) => p.id === loc.commandId)
    case 'notes':
      return loc.pageId === null || s.pages.some((p) => p.id === loc.pageId)
    case 'views':
      return loc.viewId === null || s.views.some((v) => v.id === loc.viewId)
    case 'canvas':
      return loc.canvasId === null || s.canvases.some((c) => c.id === loc.canvasId)
    default:
      return true
  }
}

function show(loc: Location): void {
  const s = useAppStore.getState()
  restoring = true
  clearTimeout(timer)
  useAppStore.setState({
    activeView: loc.view,
    activeCommandId: loc.commandId ?? s.activeCommandId,
    activeViewId: loc.viewId,
    activeCanvasId: loc.canvasId,
    trackerMode: loc.trackerMode
  })
  // Through the store's own path, so the page's body and tags load.
  if (loc.pageId !== s.activePageId) s.setActivePageId(loc.pageId)
  restoring = false
}

function go(delta: -1 | 1): void {
  // A move still settling is recorded first, so Back from it returns to where it started.
  if (timer) {
    clearTimeout(timer)
    timer = undefined
    record()
  }
  let to = index + delta
  while (to >= 0 && to < entries.length && !reachable(entries[to])) to += delta
  if (to < 0 || to >= entries.length) return
  index = to
  show(entries[index])
  publish()
}

export const goBack = (): void => go(-1)
export const goForward = (): void => go(1)

/** Start watching. Called once, from App. Returns the unsubscribe. */
export function startHistory(): () => void {
  const unsubscribe = useAppStore.subscribe((state, prev) => {
    if (restoring) return
    if (
      state.activeView === prev.activeView &&
      state.activeCommandId === prev.activeCommandId &&
      state.activePageId === prev.activePageId &&
      state.activeViewId === prev.activeViewId &&
      state.activeCanvasId === prev.activeCanvasId &&
      state.trackerMode === prev.trackerMode
    ) {
      return
    }
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      record()
    }, SETTLE_MS)
  })
  record()
  return () => {
    unsubscribe()
    clearTimeout(timer)
  }
}
