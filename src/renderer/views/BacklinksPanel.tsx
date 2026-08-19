import { useCallback, useEffect, useState } from 'react'
import type { BacklinkResult } from '@shared/types'
import { useAppStore } from '../store/app-store'

interface Props {
  pageId: string
}

export function BacklinksPanel({ pageId }: Props) {
  const openPage = useAppStore((s) => s.openPage)
  const [expanded, setExpanded] = useState(false)
  const [backlinks, setBacklinks] = useState<BacklinkResult[]>([])
  const [loading, setLoading] = useState(true)

  const fetchBacklinks = useCallback(async () => {
    setLoading(true)
    setBacklinks(await window.api.links.getBacklinks(pageId))
    setLoading(false)
  }, [pageId])

  useEffect(() => {
    fetchBacklinks()
  }, [fetchBacklinks])

  return (
    <div className="nx-backlinks">
      <button className="nx-backlinks__toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <svg
          className={`nx-backlinks__chevron ${expanded ? 'nx-backlinks__chevron--open' : ''}`}
          width="9"
          height="9"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
        >
          <path d="M4 3l4 3-4 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Backlinks ({loading ? '…' : backlinks.length})
      </button>

      {expanded &&
        (backlinks.length === 0 ? (
          <div className="nx-backlinks__empty">No other pages link here</div>
        ) : (
          <div className="nx-backlinks__list">
            {backlinks.map((bl) => (
              <button
                key={`${bl.sourcePageId}:${bl.source}:${bl.propertyKey ?? ''}`}
                className="nx-backlinks__item"
                onClick={() => openPage(bl.sourcePageId)}
              >
                <div className="nx-backlinks__title">
                  {bl.sourcePageTitle || 'Untitled'}
                  {/* A page can point here two ways, and which one it is
                      changes what you would do about it: a mention is a
                      sentence to go read, a relation is a field to go edit. */}
                  {bl.source === 'relation' && (
                    <span className="nx-backlinks__via nx-type-data">via {bl.propertyKey}</span>
                  )}
                </div>
                {bl.context && <div className="nx-backlinks__context">{bl.context}</div>}
              </button>
            ))}
          </div>
        ))}
    </div>
  )
}
