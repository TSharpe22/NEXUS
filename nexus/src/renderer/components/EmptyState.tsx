import React from 'react'
import { useAppStore } from '../stores/app-store'

export function EmptyState() {
  const { createPage } = useAppStore()

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6 animate-fade-in">
      {/* Subtle icon */}
      <div className="mb-5 text-[var(--nx-text-tertiary)] opacity-25">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      </div>

      <p className="text-[var(--nx-text-tertiary)] text-[14px] mb-5 max-w-[240px] leading-relaxed">
        Select a page or create a new one to get started
      </p>

      <button
        onClick={createPage}
        className="flex items-center gap-2 px-5 py-2.5 bg-[var(--nx-accent-muted)] text-[var(--nx-accent)] hover:bg-[var(--nx-accent)]/20 rounded-[var(--nx-radius-lg)] text-[13px] font-medium transition-all duration-150"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        New page
        <kbd className="text-[10px] text-[var(--nx-accent)]/60 font-mono ml-1">⌘N</kbd>
      </button>
    </div>
  )
}
