import React, { useEffect, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import Fuse from 'fuse.js'
import toast from 'react-hot-toast'
import { useAppStore } from '../stores/app-store'
import { shortcutLabel } from '../utils/shortcuts'

export function CommandPalette() {
  const {
    commandPaletteOpen, setCommandPaletteOpen,
    pages, selectPage, createPage, loadPages,
    selectedPageId,
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

            {selectedPageId && (
              <Command.Item
                onSelect={async () => {
                  setCommandPaletteOpen(false)
                  try {
                    const md = await window.api.io.exportPageMarkdown(selectedPageId)
                    const path = await window.api.dialog.showSaveDialog({
                      title: 'Export as Markdown',
                      defaultPath: 'page.md',
                      filters: [{ name: 'Markdown', extensions: ['md'] }],
                    })
                    if (path) {
                      await window.fs.writeFile(path, md)
                      toast.success('Exported as Markdown')
                    }
                  } catch { toast.error('Export failed') }
                }}
                className={itemClass}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span>Export Current Page</span>
                <kbd className="ml-auto text-[10px] text-[var(--nx-text-tertiary)] bg-[var(--nx-bg-active)] px-1.5 py-0.5 rounded font-mono">
                  {shortcutLabel('shift+E')}
                </kbd>
              </Command.Item>
            )}

            <Command.Item
              onSelect={async () => {
                setCommandPaletteOpen(false)
                const paths = await window.api.dialog.showOpenDialog({
                  title: 'Import',
                  filters: [
                    { name: 'All Supported', extensions: ['md', 'txt', 'json'] },
                  ],
                  properties: ['openFile', 'multiSelections'],
                })
                if (!paths || paths.length === 0) return
                let imported = 0
                let failed = 0
                let firstPageId: string | null = null
                for (const filePath of paths) {
                  try {
                    const content = await window.fs.readFile(filePath)
                    const filename = filePath.split(/[/\\]/).pop() || 'import'
                    const ext = filename.split('.').pop()?.toLowerCase()
                    let result: any
                    if (ext === 'json') result = await window.api.io.importJSON(content)
                    else if (ext === 'md') result = await window.api.io.importMarkdown(content, filename)
                    else result = await window.api.io.importPlainText(content, filename)
                    if (result?.id && !firstPageId) firstPageId = result.id
                    if (result?.imported) imported += result.imported
                    else imported++
                  } catch { failed++ }
                }
                await loadPages()
                if (firstPageId) selectPage(firstPageId)
                if (failed > 0) toast.error(`Imported ${imported} page(s). ${failed} failed.`)
                else toast.success(`Imported ${imported} page(s)`)
              }}
              className={itemClass}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Import</span>
              <kbd className="ml-auto text-[10px] text-[var(--nx-text-tertiary)] bg-[var(--nx-bg-active)] px-1.5 py-0.5 rounded font-mono">
                {shortcutLabel('shift+I')}
              </kbd>
            </Command.Item>

            <Command.Item
              onSelect={async () => {
                setCommandPaletteOpen(false)
                try {
                  const files = await window.api.io.exportAllMarkdown()
                  const folder = await window.api.dialog.showSelectFolder()
                  if (folder) {
                    await window.fs.writeFiles(folder, files)
                    toast.success(`Exported ${files.length} page(s) as Markdown`)
                  }
                } catch { toast.error('Export failed') }
              }}
              className={itemClass}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>Export All Pages</span>
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
