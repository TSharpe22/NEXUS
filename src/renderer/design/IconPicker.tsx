import { useEffect, useRef, useState } from 'react'
import { GLYPHS, Glyph, PageGlyph } from './Glyph'
import './IconPicker.css'

/**
 * The picker that gives `pages.icon` a way in.
 *
 * The column has existed since the first schema, and is read in five places —
 * Home's rows, the command palette, the mirror's frontmatter, a tracker task
 * and a backlink. Nothing in the renderer ever wrote it, so every one of those
 * readers was rendering a value that could not exist. This is the write.
 *
 * Deliberately a fixed list rather than a full emoji index — and, since the
 * glyph set landed, deliberately not emoji at all. `Glyph.tsx` says why: a
 * page icon is a glanceable marker, and fifty marks drawn on one grid at one
 * stroke weight in the theme's own colour read as a set, where fifty pieces of
 * somebody else's colour artwork read as fifty exceptions. Typing filters by
 * name, so the list stays reachable by keyboard.
 */

const CHOICES = Object.entries(GLYPHS).map(([key, def]) => ({ key, name: def.name }))

interface Props {
  value: string | null
  onChange: (icon: string | null) => void
}

export function IconPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  // Opening fresh every time: a filter left over from the last page is a
  // list that looks broken rather than filtered.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const q = query.trim().toLowerCase()
  const shown = q ? CHOICES.filter((c) => c.name.includes(q) || c.key.includes(q)) : CHOICES

  const choose = (icon: string | null) => {
    onChange(icon)
    setOpen(false)
  }

  return (
    <div className="nx-iconpick" ref={wrapRef}>
      <button
        className={`nx-iconpick__btn ${value ? 'has-icon' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={value ? 'Change icon' : 'Add an icon'}
        aria-label={value ? 'Change page icon' : 'Add a page icon'}
      >
        {value ? (
          <PageGlyph icon={value} size={22} />
        ) : (
          <span className="nx-iconpick__placeholder">+ icon</span>
        )}
      </button>

      {open && (
        <div className="nx-iconpick__pop">
          <input
            className="nx-input nx-iconpick__filter"
            autoFocus
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter takes the only remaining match, so a filter that
              // narrows to one thing does not still need the mouse.
              if (e.key === 'Enter' && shown.length > 0) choose(shown[0].key)
            }}
          />

          <div className="nx-iconpick__grid">
            {shown.map((choice) => (
              <button
                key={choice.key}
                className={`nx-iconpick__cell ${choice.key === value ? 'is-current' : ''}`}
                title={choice.key}
                onClick={() => choose(choice.key)}
              >
                <Glyph name={choice.key} size={17} />
              </button>
            ))}
            {shown.length === 0 && (
              <div className="nx-iconpick__none nx-type-data">Nothing matches “{query}”.</div>
            )}
          </div>

          {value && (
            <button className="nx-iconpick__clear" onClick={() => choose(null)}>
              Remove icon
            </button>
          )}
        </div>
      )}
    </div>
  )
}
