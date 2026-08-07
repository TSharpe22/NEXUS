import { useEffect, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import Fuse from 'fuse.js'
import type { Page } from '@shared/types'
import { useAppStore, type View } from '../store/app-store'
import { Icon } from './Icon'
import './CommandPalette.css'

const VIEWS: View[] = ['atlas', 'vault', 'command', 'flow', 'settings']

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pages, setPages] = useState<Page[]>([])
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setActivePageId = useAppStore((s) => s.setActivePageId)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'n' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        window.api.pages.create().then((page) => {
          setActiveView('vault')
          setActivePageId(page.id)
        })
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [setActiveView, setActivePageId])

  useEffect(() => {
    if (open) window.api.pages.getAll().then(setPages)
    else setQuery('')
  }, [open])

  const filteredPages = useMemo(() => {
    if (!query.trim()) return pages.slice(0, 8)
    return new Fuse(pages, { keys: ['title'], threshold: 0.4 }).search(query).map((r) => r.item)
  }, [pages, query])

  const openPage = (id: string) => {
    setActiveView('vault')
    setActivePageId(id)
    setOpen(false)
  }

  const goToView = (view: View) => {
    setActiveView(view)
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="nx-palette-backdrop" onClick={() => setOpen(false)}>
      <div className="nx-palette" onClick={(e) => e.stopPropagation()}>
        <Command shouldFilter={false}>
          <Command.Input autoFocus placeholder="Search pages or jump to a view…" value={query} onValueChange={setQuery} />
          <Command.List>
            <Command.Empty>No results</Command.Empty>
            <Command.Group heading="Pages">
              {filteredPages.map((page) => (
                <Command.Item key={page.id} onSelect={() => openPage(page.id)}>
                  <Icon shape="square" size={11} />
                  {page.title || 'Untitled'}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Go to">
              {VIEWS.map((view) => (
                <Command.Item key={view} onSelect={() => goToView(view)}>
                  <Icon shape="diamond" size={11} />
                  {view}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  )
}
