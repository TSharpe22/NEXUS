import { useState } from 'react'
import toast from 'react-hot-toast'
import { HOME_ID, commandIdFor } from '@shared/commands'
import { useAppStore } from '../store/app-store'
import { NavItem } from '../design/NavItem'
import { openMenu } from '../design/menu-host'
import { confirmDialog } from '../design/Confirm'

/**
 * Home, then the "Command" group in the sidebar: every other command page, a
 * + to make one, and a right-click menu to rename, remove, or open Nexus on it.
 */
export function CommandNav() {
  const commands = useAppStore((s) => s.commands)
  const activeView = useAppStore((s) => s.activeView)
  const activeCommandId = useAppStore((s) => s.activeCommandId)
  const openCommand = useAppStore((s) => s.openCommand)
  const saveCommands = useAppStore((s) => s.saveCommands)
  // The page being renamed, or 'new' while one is being named.
  const [naming, setNaming] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  if (!commands) return null
  const others = commands.pages.filter((p) => p.id !== HOME_ID)

  const commit = async () => {
    const name = draft.trim()
    const target = naming
    setNaming(null)
    if (!name || !target) return
    if (target === 'new') {
      const id = commandIdFor(name, commands.pages.map((p) => p.id))
      await saveCommands({ ...commands, pages: [...commands.pages, { id, name }] })
      openCommand(id)
    } else {
      await saveCommands({
        ...commands,
        pages: commands.pages.map((p) => (p.id === target ? { ...p, name } : p))
      })
    }
  }

  const remove = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: `Remove ${name}?`,
      message: 'Its layout is forgotten. The pages and views its widgets showed are not touched.',
      confirmLabel: 'Remove',
      danger: true
    })
    if (!ok) return
    await window.api.dashboard.set(null, id)
    await saveCommands({
      ...commands,
      pages: commands.pages.filter((p) => p.id !== id),
      start: commands.start === id ? HOME_ID : commands.start
    })
  }

  const move = (id: string, delta: -1 | 1) => {
    const pages = [...commands.pages]
    const i = pages.findIndex((p) => p.id === id)
    const to = i + delta
    // Home stays first.
    if (to < 1 || to >= pages.length) return
    ;[pages[i], pages[to]] = [pages[to], pages[i]]
    void saveCommands({ ...commands, pages })
  }

  const input = (
    <input
      className="nx-input nx-sidebar__name"
      autoFocus
      value={draft}
      placeholder="Name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void commit()
        if (e.key === 'Escape') setNaming(null)
      }}
    />
  )

  const startLabel = (id: string) => (commands.start === id ? ' · opens first' : '')

  return (
    <>
      <NavItem
        label="Home"
        title={`Home${startLabel(HOME_ID)}`}
        selected={activeView === 'home' && activeCommandId === HOME_ID}
        onClick={() => openCommand(HOME_ID)}
      />
      <div className="nx-sidebar__pins nx-sidebar__command">
        <span className="nx-type-label nx-sidebar__pins-head nx-sidebar__command-head">
          Command
          <button
            className="nx-sidebar__add"
            title="New command page"
            aria-label="New command page"
            onClick={() => {
              setDraft('')
              setNaming('new')
            }}
          >
            +
          </button>
        </span>
        {others.map((p) =>
          naming === p.id ? (
            <div key={p.id}>{input}</div>
          ) : (
            <div
              key={p.id}
              onContextMenu={(e) => {
                e.preventDefault()
                openMenu(e.clientX, e.clientY, [
                  {
                    label: 'Rename',
                    onSelect: () => {
                      setDraft(p.name)
                      setNaming(p.id)
                    }
                  },
                  {
                    label: commands.start === p.id ? 'Opens first' : 'Open Nexus on this page',
                    onSelect: () => {
                      if (commands.start === p.id) return
                      void saveCommands({ ...commands, start: p.id }).then(() =>
                        toast(`Nexus will open on ${p.name}`)
                      )
                    }
                  },
                  { label: 'Move up', onSelect: () => move(p.id, -1) },
                  { label: 'Move down', onSelect: () => move(p.id, 1) },
                  { label: 'Remove', danger: true, onSelect: () => void remove(p.id, p.name) }
                ])
              }}
            >
              <NavItem
                label={p.name}
                title={`${p.name}${startLabel(p.id)} — right-click to rename or remove`}
                selected={activeView === 'home' && activeCommandId === p.id}
                onClick={() => openCommand(p.id)}
              />
            </div>
          )
        )}
        {naming === 'new' && input}
      </div>
    </>
  )
}
