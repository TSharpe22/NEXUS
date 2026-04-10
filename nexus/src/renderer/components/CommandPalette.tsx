import React, { useEffect, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import Fuse from 'fuse.js'
import { useAppStore } from '../stores/app-store'
import { shortcutLabel } from '../utils/shortcuts'

export function CommandPalette() {
  const {
    commandPaletteOpen, setCommandPaletteOpen,
    pages, selectPage, createPage,
    sidebarCollapsed, setSidebarCollapsed,
    setShowTrash,
  } = useAppStore()
  const [query, setQuery] = useState('')

  // Toggle shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCommandPaletteOpen(!commandPaletteOpen)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [commandPaletteOpen, setCommandPaletteOpen])

  // Clear query on close
  useEffect(() => {
    if (!commandPaletteOpen) setQuery('')
  }, [commandPaletteOpen])

  // Fuzzy-filtered pages — must be called unconditionally (hooks rule)
  const filteredPages = useMemo(() => {
    if (!query.trim()) return pages
    const fuse = new Fuse(pages, {
      keys: ['title'],
      threshold: 0.4,
      ignoreLocation: true,
    })
    return fuse.search(query).map((result) => result.item)
  }, [pages, query])

  // Early return AFTER all hooks
  if (!commandPaletteOpen) return null

  const itemClass =
    'flex items-center gap-3 px-3 py-2 rounded-[var(--nx-radius-md)] text-[13px] text-[var(--nx-text-secondary)] cursor-pointer data-[selected=true]:bg-[var(--nx-bg-hover)] data-[selected=true]:text-[var(--nx-text-primary)] transition-colors duration-75'
  const headingClass =
    '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-[var(--nx-text-tertiary)]'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setCommandPaletteOpen(false)}
      />

      {/* Dialog */}
      <Command
        className="relative w-[560px] max-h-[420px] bg-[var(--nx-bg-elevated)] border border-[var(--nx-border-subtle)] rounded-[var(--nx-radius-lg)] overflow-hidden animate-fade-in"
        style={{ boxShadow: 'var(--nx-shadow-lg)' }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setCommandPaletteOpen(false)
        }}
      >
        <Command.Input
          placeholder="Search pages or type a command..."
          value={query}
          onValueChange={setQuery}
          className="w-full px-4 py-3.5 bg-transparent text-[14px] text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-tertiary)] outline-none border-b border-[var(--nx-border-subtle)]"
          autoFocus
        />

        <Command.List className="max-h-[340px] overflow-y-auto p-1.5">
          <Command.Empty className="px-4 py-8 text-center text-[13px] text-[var(--nx-text-tertiary)]">
            No results found.
          </Command.Empty>

          {/* Actions */}
          <Command.Group heading="Actions" className={headingClass}>
            <Command.Item
              onSelect={() => {
                createPage()
                setCommandPaletteOpen(false)
              }}
              className={itemClass}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>New Page</span>
              <kbd className="ml-auto text-[10px] text-[var(--nx-text-tertiary)] bg-[var(--nx-bg-active)] px-1.5 py-0.5 rounded font-mono">
                {shortcutLabel('N')}
              </kbd>
            </Command.Item>

            <Command.Item
              onSelect={() => {
                setSidebarCollapsed(!sidebarCollapsed)
                setCommandPaletteOpen(false)
              }}
              className={itemClass}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
              <span>Toggle Sidebar</span>
              <kbd className="ml-auto text-[10px] text-[var(--nx-text-tertiary)] bg-[var(--nx-bg-active)] px-1.5 py-0.5 rounded font-mono">
                {shortcutLabel('\\')}
              </kbd>
            </Command.Item>

            <Command.Item
              onSelect={() => {
                setShowTrash(true)
                setCommandPaletteOpen(false)
              }}
              className={itemClass}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              <span>Go to Trash</span>
            </Command.Item>
          </Command.Group>

          {/* Pages */}
          {filteredPages.length > 0 && (
            <Command.Group heading="Pages" className={headingClass}>
              {filteredPages.map((page) => (
                <Command.Item
                  key={page.id}
                  value={page.title || 'Untitled'}
                  onSelect={() => {
                    selectPage(page.id)
                    setCommandPaletteOpen(false)
                  }}
                  className={itemClass}
                >
                  <span className="text-[14px] leading-none">{page.icon || ''}</span>
                  <span className="truncate">{page.title || 'Untitled'}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  )
}
