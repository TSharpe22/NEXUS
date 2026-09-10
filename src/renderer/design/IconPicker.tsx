import { useEffect, useRef, useState } from 'react'
import './IconPicker.css'

/**
 * The picker that gives `pages.icon` a way in.
 *
 * The column has existed since the first schema, and is read in five places —
 * Home's rows, the command palette, the mirror's frontmatter, a tracker task
 * and a backlink. Nothing in the renderer ever wrote it, so every one of those
 * readers was rendering a value that could not exist. This is the write.
 *
 * Deliberately a fixed list rather than a full emoji index: a page icon is a
 * glanceable marker, and forty of them chosen for how they read at 16px is
 * more useful than every emoji sorted by codepoint. Typing filters by name, so
 * the list stays reachable by keyboard.
 */

interface Choice {
  glyph: string
  /** What typing in the filter box matches against. */
  name: string
}

const CHOICES: Choice[] = [
  { glyph: '📝', name: 'note write page' },
  { glyph: '📓', name: 'journal notebook diary' },
  { glyph: '📅', name: 'calendar date day' },
  { glyph: '✅', name: 'done check task complete' },
  { glyph: '🎯', name: 'goal target aim' },
  { glyph: '🧠', name: 'brain idea think mind' },
  { glyph: '💡', name: 'idea light bulb' },
  { glyph: '🔬', name: 'research science lab' },
  { glyph: '📊', name: 'chart data stats graph' },
  { glyph: '📈', name: 'up growth trend chart' },
  { glyph: '💰', name: 'money trading finance' },
  { glyph: '🏋️', name: 'training gym lift workout' },
  { glyph: '🏃', name: 'run running cardio' },
  { glyph: '🥗', name: 'food diet meal nutrition' },
  { glyph: '😴', name: 'sleep rest bed' },
  { glyph: '🧘', name: 'meditate calm mind' },
  { glyph: '📚', name: 'book reading library' },
  { glyph: '✍️', name: 'writing draft author' },
  { glyph: '🎓', name: 'study learn school' },
  { glyph: '🗺️', name: 'map plan route' },
  { glyph: '🧭', name: 'compass direction navigate' },
  { glyph: '⚙️', name: 'settings config system' },
  { glyph: '🔧', name: 'tool fix build' },
  { glyph: '🧩', name: 'piece puzzle component' },
  { glyph: '🏗️', name: 'build project construction' },
  { glyph: '🚀', name: 'launch ship release' },
  { glyph: '🔥', name: 'hot urgent streak' },
  { glyph: '⭐', name: 'star favourite important' },
  { glyph: '📌', name: 'pin pinned keep' },
  { glyph: '🗃️', name: 'archive box files' },
  { glyph: '📥', name: 'inbox capture in' },
  { glyph: '🔗', name: 'link reference connect' },
  { glyph: '🧵', name: 'thread series thought' },
  { glyph: '❓', name: 'question open unknown' },
  { glyph: '⚠️', name: 'warning risk careful' },
  { glyph: '🌱', name: 'seed new growing draft' },
  { glyph: '🌳', name: 'tree evergreen mature' },
  { glyph: '🎨', name: 'design art visual' },
  { glyph: '🎵', name: 'music audio sound' },
  { glyph: '🗓️', name: 'week planning schedule' }
]

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
  const shown = q ? CHOICES.filter((c) => c.name.includes(q)) : CHOICES

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
        {value ?? <span className="nx-iconpick__placeholder">+ icon</span>}
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
              if (e.key === 'Enter' && shown.length > 0) choose(shown[0].glyph)
            }}
          />

          <div className="nx-iconpick__grid">
            {shown.map((choice) => (
              <button
                key={choice.glyph}
                className={`nx-iconpick__cell ${choice.glyph === value ? 'is-current' : ''}`}
                title={choice.name.split(' ')[0]}
                onClick={() => choose(choice.glyph)}
              >
                {choice.glyph}
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
