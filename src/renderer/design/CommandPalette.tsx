import { useEffect, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import Fuse from 'fuse.js'
import { useAppStore, VIEW_META, VIEW_ORDER, type View } from '../store/app-store'
import './CommandPalette.css'

const VIEWS: { view: View; label: string }[] = VIEW_ORDER.map((view) => ({
  view,
  label: VIEW_META[view].label
}))

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  // Read from the store rather than fetching on open: the list is already
  // loaded, and a page created here shows up everywhere else immediately.
  const pages = useAppStore((s) => s.pages)
  const openPage = useAppStore((s) => s.openPage)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const createPage = useAppStore((s) => s.createPage)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'n' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(false)
        createPage()
      }
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [createPage])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const filteredPages = useMemo(() => {
    if (!query.trim()) return pages.slice(0, 8)
    return new Fuse(pages, { keys: ['title'], threshold: 0.4 })
      .search(query)
      .slice(0, 12)
      .map((r) => r.item)
  }, [pages, query])

  if (!open) return null

  const select = (fn: () => void) => {
    fn()
    setOpen(false)
  }

  return (
    <div className="nx-palette-backdrop" onClick={() => setOpen(false)}>
      <div className="nx-palette" onClick={(e) => e.stopPropagation()}>
        <Command shouldFilter={false} loop>
          <Command.Input
            autoFocus
            placeholder="Search pages, or jump to a view…"
            value={query}
            onValueChange={setQuery}
          />
          <Command.List>
            <Command.Empty>No results</Command.Empty>

            {filteredPages.length > 0 && (
              <Command.Group heading="Pages">
                {filteredPages.map((page) => (
                  <Command.Item
                    key={page.id}
                    value={`page-${page.id}`}
                    onSelect={() => select(() => openPage(page.id))}
                  >
                    {page.title || 'Untitled'}
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="Go to">
              {VIEWS.map(({ view, label }) => (
                <Command.Item key={view} value={`view-${view}`} onSelect={() => select(() => setActiveView(view))}>
                  {label}
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="Actions">
              <Command.Item value="action-new" onSelect={() => select(() => createPage())}>
                New page
                <span className="nx-palette__hint">⌘N</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  )
}
