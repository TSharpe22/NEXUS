import React, { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '../stores/app-store'
import type { BacklinkResult } from '../../shared/types'

interface Props {
  pageId: string
}

export function BacklinksPanel({ pageId }: Props) {
  const selectPage = useAppStore((s) => s.selectPage)
  const [backlinks, setBacklinks] = useState<BacklinkResult[]>([])
  const [expanded, setExpanded] = useState(false)
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
        className="flex items-center gap-2 text-[12px] text-[var(--nx-text-tertiary)] hover:text-[var(--nx-text-secondary)] transition-colors duration-150"
        onClick={() => setExpanded((v) => !v)}
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
        <span>Backlinks ({backlinks.length})</span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-1 animate-fade-in">
          {backlinks.length === 0 ? (
            <p className="text-[12px] text-[var(--nx-text-tertiary)] pl-5">
              No other pages link here.
            </p>
          ) : (
            backlinks.map((bl) => (
              <button
                key={bl.sourcePageId}
                onClick={() => selectPage(bl.sourcePageId)}
                className="w-full flex items-start gap-2.5 px-3 py-2 rounded-[var(--nx-radius-md)] text-left hover:bg-[var(--nx-bg-hover)] transition-colors duration-100 group"
              >
                <span className="text-[14px] leading-none mt-0.5 shrink-0">
                  {bl.sourcePageIcon || '\u{1F4DD}'}
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
