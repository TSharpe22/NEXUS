import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../stores/app-store'
import type { BacklinkResult } from '../../shared/types'
import { PageIcon } from '../blocks/icons'

interface Props {
  pageId: string
}

export function BacklinksPanel({ pageId }: Props) {
  const selectPage = useAppStore((s) => s.selectPage)
  const expanded = useAppStore((s) => s.backlinksExpanded)
  const setExpanded = useAppStore((s) => s.setBacklinksExpanded)
  const [backlinks, setBacklinks] = useState<BacklinkResult[]>([])
  const [loading, setLoading] = useState(false)

  const fetchBacklinks = useCallback(async () => {
    setLoading(true)
    try {
      const results = await window.api.links.getBacklinks(pageId)
      setBacklinks(results)
    } catch {
      setBacklinks([])
    }
    setLoading(false)
  }, [pageId])

  useEffect(() => {
    fetchBacklinks()
  }, [fetchBacklinks])

  return (
    <div className="nx-backlinks mt-8 border-t border-[var(--nx-border-subtle)] pt-4">
      <button
        className="flex items-center gap-2 text-[12px] text-[var(--nx-text-tertiary)] hover:text-[var(--nx-text-secondary)] transition-colors duration-100 cursor-pointer active:text-[var(--nx-text-primary)]"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        >
          <path
            d="M4 3l4 3-4 3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Backlinks ({loading ? '…' : backlinks.length})</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-0.5 animate-fade-in">
          {backlinks.length === 0 ? (
            <p className="text-[12px] text-[var(--nx-text-tertiary)] pl-5">
              No other pages link here.
            </p>
          ) : (
            backlinks.map((bl) => (
              <button
                key={bl.sourcePageId}
                onClick={() => selectPage(bl.sourcePageId)}
                className="w-full flex items-start gap-2.5 px-3 py-2 rounded-[var(--nx-radius-md)] text-left hover:bg-[var(--nx-bg-hover)] active:bg-[var(--nx-bg-active)] transition-colors duration-75 cursor-pointer group"
              >
                <span className="text-[var(--nx-text-tertiary)] shrink-0 mt-0.5">
                  <PageIcon iconKey={bl.sourcePageIcon} size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-[var(--nx-text-primary)] truncate">
                    {bl.sourcePageTitle || 'Untitled'}
                  </div>
                  {bl.context && (
                    <div className="text-[11px] text-[var(--nx-text-tertiary)] truncate mt-0.5 leading-relaxed">
                      {bl.context}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
