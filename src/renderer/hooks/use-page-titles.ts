import { useMemo } from 'react'
import { useAppStore } from '../store/app-store'

/**
 * Resolves a page id to its current title.
 *
 * A relation property stores an id, so everything that displays one has to
 * look the title up — and it has to look it up live. Snapshotting the title at
 * save time is what left page mention chips showing a name the target had been
 * renamed out of; the store is the source of truth for both.
 *
 * Trashed pages resolve too: a relation pointing at one should read as the
 * page it names, not as a dangling id. Only a page deleted for good comes back
 * null.
 */
export function usePageTitles(): (id: string | null | undefined) => string | null {
  const pages = useAppStore((s) => s.pages)
  const trashed = useAppStore((s) => s.trashed)

  return useMemo(() => {
    const byId = new Map<string, string>()
    for (const page of pages) byId.set(page.id, page.title || 'Untitled')
    for (const page of trashed) byId.set(page.id, page.title || 'Untitled')
    return (id) => (id ? (byId.get(id) ?? null) : null)
  }, [pages, trashed])
}
