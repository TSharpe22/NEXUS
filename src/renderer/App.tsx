import { useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { useAppStore, View } from './store/app-store'
import { NavItem } from './design/NavItem'
import { CommandPalette } from './design/CommandPalette'
import { ConfirmHost } from './design/Confirm'
import { Home } from './views/Home'
import { Notes } from './views/Notes'
import { Tables } from './views/Tables'
import { Activity } from './views/Activity'
import { Settings } from './views/Settings'
import './App.css'

const NAV: { view: View; label: string; hint: string }[] = [
  { view: 'home', label: 'Home', hint: 'Overview and graph' },
  { view: 'notes', label: 'Notes', hint: 'Write and edit pages' },
  { view: 'tables', label: 'Tables', hint: 'Browse pages by type' },
  { view: 'activity', label: 'Activity', hint: 'What changed, when' },
  { view: 'settings', label: 'Settings', hint: 'Data, import and export' }
]

const VIEW_COMPONENT: Record<View, () => JSX.Element> = {
  home: Home,
  notes: Notes,
  tables: Tables,
  activity: Activity,
  settings: Settings
}

const VIEW_TITLE: Record<View, string> = {
  home: 'Home',
  notes: 'Notes',
  tables: 'Tables',
  activity: 'Activity',
  settings: 'Settings'
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
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const refresh = useAppStore((s) => s.refresh)
  const ActiveComponent = VIEW_COMPONENT[activeView]

  // Loaded once here rather than per view, so switching views doesn't refetch
  // and every view sees the same list.
  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="nx-app">
      <aside className="nx-sidebar">
        <div className="nx-sidebar__logo">NEXUS</div>
        <nav className="nx-sidebar__nav">
          {NAV.map((item) => (
            <NavItem
              key={item.view}
              label={item.label}
              title={item.hint}
              selected={activeView === item.view}
              onClick={() => setActiveView(item.view)}
            />
          ))}
        </nav>
        <div className="nx-sidebar__foot nx-type-data">⌘K to search</div>
      </aside>

      <div className="nx-main">
        <header className="nx-topbar">
          <div className="nx-topbar__title">{VIEW_TITLE[activeView]}</div>
          <SaveIndicator />
        </header>
        <main className="nx-content">
          <ActiveComponent />
        </main>
      </div>

      <CommandPalette />
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
