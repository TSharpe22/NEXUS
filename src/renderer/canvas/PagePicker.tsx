import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/app-store'

const LIMIT = 30

/**
 * Choose a page to put on the canvas, or make one.
 *
 * Titles only, from the list the store already holds. The palette searches
 * bodies because it is how you find a thing you half remember; this is how you
 * place a thing you already know is there, and a title match is what you are
 * looking at while you type it.
 */
export function PagePicker({ onPick, onClose }: { onPick: (pageId: string) => void; onClose: () => void }) {
  const pages = useAppStore((s) => s.pages)
  const refresh = useAppStore((s) => s.refresh)
  const types = useAppStore((s) => s.types)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...pages].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return (q ? sorted.filter((p) => (p.title || 'Untitled').toLowerCase().includes(q)) : sorted).slice(0, LIMIT)
  }, [pages, query])

  const exact = matches.some((p) => p.title.trim().toLowerCase() === query.trim().toLowerCase())
  const offerCreate = query.trim() !== '' && !exact
  const count = matches.length + (offerCreate ? 1 : 0)

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const create = async () => {
    const page = await window.api.pages.create()
    await window.api.pages.update(page.id, { title: query.trim() })
    await refresh()
    onPick(page.id)
  }

  const choose = (index: number) => {
    if (index < matches.length) onPick(matches[index].id)
    else if (offerCreate) void create()
  }

  return (
    <div className="nx-canvas-picker nokey" ref={rootRef}>
      <input
        className="nx-canvas-picker__input"
        autoFocus
        placeholder="Find a page, or name a new one"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(count - 1, i + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(0, i - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            choose(active)
          }
        }}
      />
      <div className="nx-canvas-picker__list">
        {matches.map((page, i) => (
          <button
            key={page.id}
            className={`nx-canvas-picker__item ${i === active ? 'is-active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(i)}
          >
            <span className="nx-canvas-picker__title">{page.title || 'Untitled'}</span>
            <span className="nx-type-data">{types.find((t) => t.id === page.type_id)?.name ?? 'Note'}</span>
          </button>
        ))}
        {offerCreate && (
          <button
            className={`nx-canvas-picker__item ${active === matches.length ? 'is-active' : ''}`}
            onMouseEnter={() => setActive(matches.length)}
            onClick={() => choose(matches.length)}
          >
            <span className="nx-canvas-picker__title">New page “{query.trim()}”</span>
          </button>
        )}
        {count === 0 && <div className="nx-canvas-picker__empty nx-type-data">no pages yet</div>}
      </div>
    </div>
  )
}
