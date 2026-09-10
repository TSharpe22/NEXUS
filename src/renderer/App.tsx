import { useCallback, useEffect, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { useAppStore, VIEW_META, VIEW_ORDER, View } from './store/app-store'
import { flushPendingWrites } from './pending-writes'
import { NavItem } from './design/NavItem'
import { CommandPalette } from './design/CommandPalette'
import { QuickCapture } from './design/CaptureBar'
import { useShortcuts } from './hooks/use-shortcuts'
import { ConfirmHost } from './design/Confirm'
import { Home } from './views/Home'
import { Notes } from './views/Notes'
import { Views } from './views/Views'
import { Tracker } from './views/Tracker'
import { Settings } from './views/Settings'
import './App.css'

const VIEW_COMPONENT: Record<View, () => JSX.Element> = {
  home: Home,
  notes: Notes,
  views: Views,
  tracker: Tracker,
  settings: Settings
}

function SaveIndicator() {
  const status = useAppStore((s) => s.saveStatus)
  if (status === 'idle') return null

  if (status === 'error') {
    return <span className="nx-save nx-save--error">could not save</span>
  }

  return <span className="nx-save">{status === 'saving' ? 'saving…' : 'saved'}</span>
}

export function App() {
  // The two things a shortcut can put over the screen. They live here rather
  // than inside themselves because the keyboard map opens them, and a
  // component that owns its own "am I open" cannot be opened from outside it.
  const [searchOpen, setSearchOpen] = useState(false)
  const [captureOpen, setCaptureOpen] = useState(false)
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const refresh = useAppStore((s) => s.refresh)
  const refreshViews = useAppStore((s) => s.refreshViews)
  const views = useAppStore((s) => s.views)
  const activeViewId = useAppStore((s) => s.activeViewId)
  const setActiveViewId = useAppStore((s) => s.setActiveViewId)
  const ActiveComponent = VIEW_COMPONENT[activeView]

  /**
   * Saved views the user has pinned, under the five fixed destinations.
   *
   * The sidebar named mechanisms — Home, Notes, Views, Tracker — while the
   * thing anybody actually navigates by is their own subject: this project,
   * that log, the open positions. `views.is_pinned` had been in the schema
   * since views shipped and was read by nothing, so the only way to reach a
   * saved question was Views → find it in a list.
   *
   * This is what a hand-maintained page of links in another app is for, and
   * unlike that page it cannot go stale, because each of these is a query.
   */
  const pinnedViews = views.filter((v) => v.is_pinned)

  // Loaded once here rather than per view, so switching views doesn't refetch
  // and every view sees the same list.
  useEffect(() => {
    refresh()
  }, [refresh])

  // The sidebar draws pinned views, so the list has to be loaded before the
  // Views screen has ever been opened.
  useEffect(() => {
    void refreshViews()
  }, [refreshViews])

  // The main process holds the window open while this runs, so a save still
  // sitting in a debounce when you hit quit lands before the database closes.
  useEffect(() => window.api.lifecycle.onFlushRequest(flushPendingWrites), [])

  const openCapture = useCallback(() => {
    setSearchOpen(false)
    setCaptureOpen(true)
  }, [])

  useShortcuts({
    onSearch: () => {
      setCaptureOpen(false)
      setSearchOpen((v) => !v)
    },
    onCapture: openCapture
  })

  // The global accelerator fires in the main process — Nexus need not be the
  // focused application, which is the whole point of it — and arrives here as
  // a request to show the same box the in-app shortcut shows.
  useEffect(() => window.api.lifecycle.onCaptureRequest(openCapture), [openCapture])

  // Escape closes whichever is up. The capture box stops its own keys before
  // they reach here, so this cannot close the overlay you are typing into by
  // way of a key it handled itself.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCaptureOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="nx-app">
      <aside className="nx-sidebar">
        <div className="nx-sidebar__logo">NEXUS</div>
        <nav className="nx-sidebar__nav">
          {VIEW_ORDER.map((view) => (
            <NavItem
              key={view}
              label={VIEW_META[view].label}
              title={VIEW_META[view].hint}
              selected={activeView === view}
              onClick={() => setActiveView(view)}
            />
          ))}

          {pinnedViews.length > 0 && (
            <div className="nx-sidebar__pins">
              <span className="nx-type-label nx-sidebar__pins-head">Pinned</span>
              {pinnedViews.map((view) => (
                <NavItem
                  key={view.id}
                  label={view.icon ? `${view.icon} ${view.name}` : view.name}
                  title={`${view.name} — a saved view`}
                  selected={activeView === 'views' && activeViewId === view.id}
                  onClick={() => {
                    setActiveViewId(view.id)
                    setActiveView('views')
                  }}
                />
              ))}
            </div>
          )}
        </nav>
        <div className="nx-sidebar__foot nx-type-data">
          ⌘K to search · ⌘⇧K to capture
        </div>
      </aside>

      <div className="nx-main">
        <header className="nx-topbar">
          <div className="nx-topbar__title">{VIEW_META[activeView].label}</div>
          <SaveIndicator />
        </header>
        <main className="nx-content">
          <ActiveComponent />
        </main>
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      {captureOpen && <QuickCapture onClose={() => setCaptureOpen(false)} />}
      <ConfirmHost />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--nx-surface-raised)',
            border: '1px solid var(--nx-border)',
            borderRadius: 'var(--nx-radius-md)',
            color: 'var(--nx-text)',
            fontFamily: 'var(--nx-font-sans)',
            fontSize: '13px',
            boxShadow: 'none'
          }
        }}
      />
    </div>
  )
}
