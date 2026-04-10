import React, { useEffect, useState } from 'react'
import { useAppStore } from '../stores/app-store'

export function StatusBar() {
  const { saveStatus, currentPage } = useAppStore()
  const [showSaved, setShowSaved] = useState(false)

  // Keep the "Saved" badge visible briefly, then fade.
  useEffect(() => {
    if (saveStatus === 'saved') {
      setShowSaved(true)
      const t = setTimeout(() => setShowSaved(false), 2000)
      return () => clearTimeout(t)
    }
    if (saveStatus === 'saving') {
      setShowSaved(false)
    }
  }, [saveStatus])

  return (
    <div className="h-7 flex items-center px-4 border-t border-[var(--nx-border-subtle)] text-[10px] text-[var(--nx-text-tertiary)] shrink-0 bg-[var(--nx-bg-surface)]">
      <div className="flex-1">
        {currentPage && (
          <span className="uppercase tracking-[0.08em]">
            {currentPage.type_id === 'note' ? 'Note' : currentPage.type_id}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {saveStatus === 'saving' && (
          <span className="flex items-center gap-1.5 text-[var(--nx-text-tertiary)]">
            <span className="nx-save-dot" />
            Saving…
          </span>
        )}
        {saveStatus !== 'saving' && showSaved && (
          <span
            className="flex items-center gap-1.5 text-[var(--nx-text-secondary)] transition-opacity duration-500"
            style={{ opacity: showSaved ? 1 : 0 }}
          >
            <svg
              className="nx-save-check"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Saved
          </span>
        )}
      </div>
    </div>
  )
}
