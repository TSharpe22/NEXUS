import { useEffect, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import Fuse from 'fuse.js'
import { useAppStore, VIEW_META, VIEW_ORDER, type View } from '../store/app-store'
import { useSearch } from '../hooks/use-search'
import { SearchHighlight } from './SearchHighlight'
import './CommandPalette.css'

const VIEWS: { view: View; label: string }[] = VIEW_ORDER.map((view) => ({
  view,
  label: VIEW_META[view].label
}))

/** How many pages the palette will show at once. */
const LIMIT = 12

interface Hit {
  id: string
  title: string
  /** Title with matched terms marked, when the index answered. */
  titleMarked: string | null
  /** Body excerpt around the match, when the match was in the body. */
  snippet: string | null
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')

  // Read from the store rather than fetching on open: the list is already
  // loaded, and a page created here shows up everywhere else immediately.
  const pages = useAppStore((s) => s.pages)
  const openPage = useAppStore((s) => s.openPage)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const createPage = useAppStore((s) => s.createPage)

  /**
   * The palette searches what pages *say*, not only what they are called.
   *
   * `pages` carries no body — it is the list every view reads, and shipping
   * 1500 documents into the renderer to grep them is exactly the payload it
   * was trimmed to avoid. So the body half of this comes from the FTS index
   * the main process already keeps, through the same hook the Notes sidebar
   * uses. Before this, ⌘K matched titles alone: the one global way into the
   * vault could not find a sentence you had written, which for a note-taking
   * app is the search not working.
   */
  const { results: indexed } = useSearch(query, LIMIT)

  useEffect(() => {
    // Escape only. Everything else that opens or closes this now comes from
    // the window-wide map in `use-shortcuts.ts`, so there is one place a
    // binding can be added and one place it can go stale.
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [onClose])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  /**
   * Fuzzy title matching, kept alongside the index rather than replaced by it.
   *
   * FTS matches whole words and prefixes; Fuse forgives a typo and a
   * half-remembered name. They answer different questions and the union is
   * what a person means by "find it" — the index first, since a body hit is
   * the thing that was missing, then any title the index's stricter matching
   * passed over.
   */
  const fuzzyTitles = useMemo(() => {
    if (!query.trim()) return []
    return new Fuse(pages, { keys: ['title'], threshold: 0.4 })
      .search(query)
      .slice(0, LIMIT)
      .map((r) => r.item)
  }, [pages, query])

  const hits: Hit[] = useMemo(() => {
    if (!query.trim()) {
      return pages.slice(0, 8).map((p) => ({
        id: p.id,
        title: p.title || 'Untitled',
        titleMarked: null,
        snippet: null
      }))
    }

    const seen = new Set<string>()
    const out: Hit[] = []
    for (const r of indexed) {
      seen.add(r.page.id)
      out.push({
        id: r.page.id,
        title: r.page.title || 'Untitled',
        titleMarked: r.titleMarked,
        snippet: r.bodySnippet
      })
    }
    for (const p of fuzzyTitles) {
      if (seen.has(p.id)) continue
      out.push({ id: p.id, title: p.title || 'Untitled', titleMarked: null, snippet: null })
    }
    return out.slice(0, LIMIT)
  }, [query, indexed, fuzzyTitles, pages])

  if (!open) return null

  const select = (fn: () => void) => {
    fn()
    onClose()
  }

  return (
    <div className="nx-palette-backdrop" onClick={onClose}>
      <div className="nx-palette" onClick={(e) => e.stopPropagation()}>
        <Command shouldFilter={false} loop>
          <Command.Input
            autoFocus
            placeholder="Search pages and their text, or jump to a view…"
            value={query}
            onValueChange={setQuery}
          />
          <Command.List>
            <Command.Empty>No results</Command.Empty>

            {hits.length > 0 && (
              <Command.Group heading="Pages">
                {hits.map((hit) => (
                  <Command.Item
                    key={hit.id}
                    value={`page-${hit.id}`}
                    onSelect={() => select(() => openPage(hit.id))}
                  >
                    <span className="nx-palette__hit">
                      <span className="nx-palette__hit-title">
                        {hit.titleMarked ? <SearchHighlight text={hit.titleMarked} /> : hit.title}
                      </span>
                      {hit.snippet && (
                        <span className="nx-palette__hit-snippet">
                          <SearchHighlight text={hit.snippet} />
                        </span>
                      )}
                    </span>
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
