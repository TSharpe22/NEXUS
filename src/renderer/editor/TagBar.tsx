import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/app-store'

/**
 * Tag chips under the page title.
 *
 * Deliberately separate from the properties panel: properties are defined per
 * type, so tagging through them means designing a schema first. This is the
 * low-ceremony path — type a name, press Enter, done.
 */
export function TagBar({ pageId }: { pageId: string }) {
  const activePageTags = useAppStore((s) => s.activePageTags)
  const allTags = useAppStore((s) => s.tags)
  const addTag = useAppStore((s) => s.addTag)
  const removeTag = useAppStore((s) => s.removeTag)

  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Switching pages shouldn't leave a stray open input behind.
  useEffect(() => {
    setEditing(false)
    setQuery('')
  }, [pageId])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  useEffect(() => {
    if (!editing) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setEditing(false)
        setQuery('')
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [editing])

  const attached = useMemo(() => new Set(activePageTags.map((t) => t.id)), [activePageTags])

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allTags
      .filter((t) => !attached.has(t.id))
      .filter((t) => (q ? t.name.toLowerCase().includes(q) : true))
      .slice(0, 8)
  }, [allTags, attached, query])

  const typed = query.trim().replace(/^#/, '')
  // Only offer "create" when the name isn't already a tag, or the create row
  // and the suggestion above it would do the same thing.
  const canCreate = typed.length > 0 && !allTags.some((t) => t.name.toLowerCase() === typed.toLowerCase())
  const options: (typeof allTags[number] | null)[] = canCreate ? [...suggestions, null] : suggestions

  useEffect(() => setHighlight(0), [query])

  const commit = async (name: string) => {
    if (!name.trim()) return
    await addTag(pageId, name)
    setQuery('')
    setHighlight(0)
    inputRef.current?.focus()
  }

  return (
    <div className="nx-tagbar" ref={wrapRef}>
      {activePageTags.map((tag) => (
        <span key={tag.id} className={`nx-tag-chip nx-tag-chip--${tag.color}`}>
          <span className="nx-tag-chip__label">{tag.name}</span>
          <button
            className="nx-tag-chip__x"
            aria-label={`Remove tag ${tag.name}`}
            onClick={() => void removeTag(pageId, tag.id)}
          >
            ×
          </button>
        </span>
      ))}

      {editing ? (
        <div className="nx-tagbar__field">
          <input
            ref={inputRef}
            className="nx-input nx-tagbar__input"
            placeholder="Tag name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                setEditing(false)
                setQuery('')
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setHighlight((h) => (options.length ? (h + 1) % options.length : 0))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHighlight((h) => (options.length ? (h - 1 + options.length) % options.length : 0))
                return
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                const picked = options[highlight]
                if (picked) void commit(picked.name)
                else if (typed) void commit(typed)
                return
              }
              // Backspace on an empty field drops the last chip — the usual
              // token-field affordance.
              if (e.key === 'Backspace' && !query && activePageTags.length) {
                e.preventDefault()
                void removeTag(pageId, activePageTags[activePageTags.length - 1].id)
              }
            }}
          />

          {options.length > 0 && (
            <div className="nx-tagbar__menu">
              {options.map((option, i) => (
                <button
                  key={option ? option.id : '__create__'}
                  className={`nx-tagbar__option ${i === highlight ? 'is-highlighted' : ''}`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void commit(option ? option.name : typed)}
                >
                  {option ? (
                    <>
                      <span className={`nx-tagbar__dot nx-tag-chip--${option.color}`} />
                      <span className="nx-tagbar__name">{option.name}</span>
                      <span className="nx-tagbar__count nx-type-data">{option.page_count}</span>
                    </>
                  ) : (
                    <>
                      <span className="nx-tagbar__create nx-type-label">new</span>
                      <span className="nx-tagbar__name">{typed}</span>
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button className="nx-tagbar__add" onClick={() => setEditing(true)}>
          + {activePageTags.length === 0 ? 'Add tag' : ''}
        </button>
      )}
    </div>
  )
}
