import { useEffect, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { useAppStore, View } from './store/app-store'
import { NavItem } from './design/NavItem'
import { CommandPalette } from './design/CommandPalette'
import { Atlas } from './views/Atlas'
import { Vault } from './views/Vault'
import { Command } from './views/Command'
import { Flow } from './views/Flow'
import { Settings } from './views/Settings'
import './App.css'

const NAV: { view: View; label: string }[] = [
  { view: 'atlas', label: 'atlas' },
  { view: 'vault', label: 'vault' },
  { view: 'command', label: 'command' },
  { view: 'flow', label: 'flow' },
  { view: 'settings', label: 'settings' }
]

const VIEW_COMPONENT: Record<View, () => JSX.Element> = {
  atlas: Atlas,
  vault: Vault,
  command: Command,
  flow: Flow,
  settings: Settings
}

const VIEW_SUBTITLE: Record<View, string> = {
  atlas: 'overview',
  vault: 'notes',
  command: 'directives',
  flow: 'activity',
  settings: 'preferences'
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function App() {
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const now = useClock()
  const ActiveComponent = VIEW_COMPONENT[activeView]
  const time = now.toLocaleTimeString('en-GB')

  return (
    <div className="nx-app">
      <aside className="nx-sidebar">
        <div className="nx-sidebar__logo">NEXUS</div>
        <nav className="nx-sidebar__nav">
          {NAV.map((item) => (
            <NavItem
              key={item.view}
              label={item.label}
              selected={activeView === item.view}
              onClick={() => setActiveView(item.view)}
            />
          ))}
        </nav>
      </aside>
      <div className="nx-main">
        <header className="nx-topbar">
          <div className="nx-topbar__title">
            {activeView} <span>// {VIEW_SUBTITLE[activeView]}</span>
          </div>
          <div className="nx-topbar__clock">
            {time} <span className="nx-online">// ONLINE</span>
          </div>
        </header>
        <main className="nx-content">
          <ActiveComponent />
        </main>
      </div>
      <CommandPalette />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--nx-panel)',
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
