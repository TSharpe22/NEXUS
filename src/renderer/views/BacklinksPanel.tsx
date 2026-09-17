import { useCallback, useEffect, useState } from 'react'
import type { BacklinkResult } from '@shared/types'
import type { CanvasListItem } from '@shared/canvas'
import { useAppStore } from '../store/app-store'

interface Props {
  pageId: string
}

export function BacklinksPanel({ pageId }: Props) {
  const openPage = useAppStore((s) => s.openPage)
  const openCanvas = useAppStore((s) => s.openCanvas)
  const [expanded, setExpanded] = useState(false)
  const [backlinks, setBacklinks] = useState<BacklinkResult[]>([])
  const [loading, setLoading] = useState(true)
  /**
   * Canvases this page is on. Listed with the backlinks rather than beside
   * them: "where else does this page appear" is one question, and a canvas
   * card is as much an answer to it as a mention is.
   */
  const [canvases, setCanvases] = useState<CanvasListItem[]>([])

  const fetchBacklinks = useCallback(async () => {
    setLoading(true)
    const [links, onCanvases] = await Promise.all([
      window.api.links.getBacklinks(pageId),
      window.api.canvases.forPage(pageId)
    ])
    setBacklinks(links)
    setCanvases(onCanvases)
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
        Backlinks ({loading ? '…' : backlinks.length + canvases.length})
      </button>

      {expanded &&
        (backlinks.length + canvases.length === 0 ? (
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
            {canvases.map((canvas) => (
              <button
                key={`canvas:${canvas.id}`}
                className="nx-backlinks__item"
                onClick={() => openCanvas(canvas.id)}
              >
                <div className="nx-backlinks__title">
                  {canvas.title || 'Untitled canvas'}
                  <span className="nx-backlinks__via nx-type-data">on canvas</span>
                </div>
              </button>
            ))}
          </div>
        ))}
    </div>
  )
}
