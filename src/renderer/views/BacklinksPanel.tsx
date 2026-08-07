import { useCallback, useEffect, useState } from 'react'
import type { BacklinkResult } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { Icon } from '../design/Icon'

interface Props {
  pageId: string
}

export function BacklinksPanel({ pageId }: Props) {
  const setActivePageId = useAppStore((s) => s.setActivePageId)
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
      <button className="nx-backlinks__toggle" onClick={() => setExpanded((v) => !v)}>
        <Icon shape="diamond" size={10} filled={expanded} color="var(--nx-text-dim)" />
        <span className="nx-type-label">Backlinks ({loading ? '…' : backlinks.length})</span>
      </button>

      {expanded &&
        (backlinks.length === 0 ? (
          <div className="nx-type-data" style={{ paddingLeft: 18 }}>
            no other pages link here
          </div>
        ) : (
          <div className="nx-backlinks__list">
            {backlinks.map((bl) => (
              <button key={bl.sourcePageId} className="nx-backlinks__item" onClick={() => setActivePageId(bl.sourcePageId)}>
                <div className="nx-type-body">{bl.sourcePageTitle || 'Untitled'}</div>
                {bl.context && <div className="nx-type-data">{bl.context}</div>}
              </button>
            ))}
          </div>
        ))}
    </div>
  )
}
