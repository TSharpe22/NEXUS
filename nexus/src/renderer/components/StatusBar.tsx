import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useAppStore } from '../stores/app-store'
import { relativeTime } from '../hooks/use-relative-time'

export function StatusBar() {
  const { saveStatus, currentPage, mirrorConfig, syncMirrorNow } = useAppStore()
  const [showSaved, setShowSaved] = useState(false)
  const [syncing, setSyncing] = useState(false)

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
      <div className="flex items-center gap-3">
        {mirrorConfig?.enabled && (
          <button
            onClick={async () => {
              setSyncing(true)
              try {
                const r = await syncMirrorNow()
                toast.success(
                  `Vault mirrored — ${r.written} written, ${r.deleted} removed, ${r.unchanged} unchanged`,
                )
              } catch {
                toast.error('Vault mirror sync failed')
              } finally {
                setSyncing(false)
              }
            }}
            title={`Vault mirror: ${mirrorConfig.folder ?? 'not set'}\nClick to sync now`}
            className="flex items-center gap-1.5 hover:text-[var(--nx-text-secondary)] transition-colors"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                syncing ? 'bg-[var(--nx-accent)] animate-pulse' : 'bg-[var(--nx-accent)]/60'
              }`}
            />
            <span>
              Mirrored
              {mirrorConfig.lastSyncAt ? ` ${relativeTime(mirrorConfig.lastSyncAt)}` : ''}
            </span>
          </button>
        )}

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
