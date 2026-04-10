import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '../stores/app-store'
import { relativeTime } from '../hooks/use-relative-time'
import { ContextMenu } from './ContextMenu'
import { shortcutLabel } from '../utils/shortcuts'

export function Sidebar() {
  const {
    pages, selectedPageId, sidebarWidth, sidebarCollapsed,
    searchQuery, showTrash, deletedPages,
    loadPages, selectPage, createPage,
    updatePage, deletePage, restorePage, hardDeletePage, duplicatePage,
    setSidebarWidth, setSearchQuery, setShowTrash,
  } = useAppStore()

  const isResizing = useRef(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; pageId: string } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadPages() }, [loadPages])

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const startRename = (pageId: string) => {
    const page = pages.find((p) => p.id === pageId)
    setRenamingId(pageId)
    setRenameValue(page?.title || '')
  }

  const commitRename = async () => {
    if (renamingId) {
      await updatePage(renamingId, { title: renameValue })
      setRenamingId(null)
    }
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
  }

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isResizing.current = true
      e.preventDefault()
      const onMouseMove = (e: MouseEvent) => {
        if (!isResizing.current) return
        setSidebarWidth(Math.max(220, Math.min(480, e.clientX)))
      }
      const onMouseUp = () => {
        isResizing.current = false
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [setSidebarWidth]
  )

  const filteredPages = searchQuery
    ? pages.filter((p) =>
        (p.title || 'Untitled').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : pages

  // Collapsed state
  if (sidebarCollapsed) {
    return (
      <div className="flex flex-col items-center shrink-0 w-[52px] h-full border-r border-[var(--nx-border-subtle)] bg-[var(--nx-bg-secondary)]">
        <div className="h-[var(--nx-titlebar-height)] titlebar-drag w-full" />
        <button
          onClick={createPage}
          className="w-9 h-9 flex items-center justify-center rounded-[var(--nx-radius-md)] text-[var(--nx-text-tertiary)] hover:text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-hover)] transition-all duration-150 mt-1"
          title={`New page (${shortcutLabel('N')})`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <>
      <div
        className="relative flex flex-col h-full shrink-0 border-r border-[var(--nx-border-subtle)] bg-[var(--nx-bg-secondary)] select-none"
        style={{ width: sidebarWidth, minWidth: sidebarWidth }}
      >
        {/* Titlebar area with app name */}
        <div className="h-[var(--nx-titlebar-height)] titlebar-drag shrink-0 flex items-end px-4 pb-2">
          <span className="text-[11px] font-semibold tracking-[0.15em] uppercase text-[var(--nx-text-tertiary)] titlebar-no-drag">
            Nexus
          </span>
        </div>

        {/* New page + search */}
        <div className="px-3 pt-1 pb-2 flex flex-col gap-1.5 shrink-0">
          <button
            onClick={createPage}
            className="w-full flex items-center gap-2.5 px-2.5 py-[6px] rounded-[var(--nx-radius-md)] text-[13px] text-[var(--nx-text-secondary)] hover:text-[var(--nx-text-primary)] hover:bg-[var(--nx-bg-hover)] transition-all duration-150"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New page</span>
            <kbd className="ml-auto text-[10px] text-[var(--nx-text-tertiary)] bg-[var(--nx-bg-tertiary)] px-1.5 py-0.5 rounded font-mono">
              {shortcutLabel('N')}
            </kbd>
          </button>

          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--nx-text-tertiary)]"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search pages..."
              className="w-full pl-8 pr-3 py-[6px] bg-[var(--nx-bg-base)] border border-[var(--nx-border-subtle)] rounded-[var(--nx-radius-md)] text-[13px] text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-tertiary)] focus:outline-none focus:border-[var(--nx-accent)]/30 transition-all duration-150"
            />
          </div>
        </div>

        {/* Divider */}
        <div className="mx-4 h-px bg-[var(--nx-border-subtle)]" />

        {/* Page list or Trash */}
        <div className="flex-1 overflow-y-auto sidebar-scroll px-2 pt-2">
          {showTrash ? (
            <div className="animate-fade-in">
              <button
                onClick={() => setShowTrash(false)}
                className="flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-[var(--nx-text-tertiary)] hover:text-[var(--nx-text-secondary)] transition-colors mb-2"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Back to pages
              </button>

              <p className="px-2.5 text-[10px] font-semibold tracking-[0.12em] uppercase text-[var(--nx-text-tertiary)] mb-2">
                Trash
              </p>

              {deletedPages.length === 0 ? (
                <div className="px-2.5 py-10 text-center">
                  <svg
                    className="mx-auto mb-3 text-[var(--nx-text-tertiary)] opacity-40"
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                  <p className="text-[13px] text-[var(--nx-text-tertiary)]">Trash is empty</p>
                </div>
              ) : (
                deletedPages.map((page) => (
                  <div
                    key={page.id}
                    className="group flex items-center gap-2.5 px-2.5 py-[7px] rounded-[var(--nx-radius-md)] text-[13px] hover:bg-[var(--nx-bg-hover)] transition-all duration-100"
                  >
                    <span className="text-[15px] leading-none opacity-60">{page.icon || ''}</span>
                    <span className="flex-1 truncate text-[var(--nx-text-secondary)]">
                      {page.title || 'Untitled'}
                    </span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => restorePage(page.id)}
                        className="text-[11px] px-2 py-0.5 rounded bg-[var(--nx-accent-muted)] text-[var(--nx-accent)] hover:bg-[var(--nx-accent)]/20 transition-colors"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => hardDeletePage(page.id)}
                        className="text-[11px] px-2 py-0.5 rounded bg-[var(--nx-danger)]/8 text-[var(--nx-danger)] hover:bg-[var(--nx-danger)]/15 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              {filteredPages.length === 0 ? (
                <div className="px-2.5 py-12 text-center">
                  <svg
                    className="mx-auto mb-3 text-[var(--nx-text-tertiary)] opacity-30"
                    width="36"
                    height="36"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  <p className="text-[13px] text-[var(--nx-text-tertiary)]">
                    {searchQuery ? 'No pages match your search' : 'No pages yet'}
                  </p>
                  {!searchQuery && (
                    <button
                      onClick={createPage}
                      className="mt-3 text-[12px] text-[var(--nx-accent)] hover:text-[var(--nx-accent-hover)] transition-colors"
                    >
                      Create your first page
                    </button>
                  )}
                </div>
              ) : (
                filteredPages.map((page) => (
                  <div
                    key={page.id}
                    onClick={() => {
                      if (renamingId !== page.id) selectPage(page.id)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setCtxMenu({ x: e.clientX, y: e.clientY, pageId: page.id })
                    }}
                    onDoubleClick={() => startRename(page.id)}
                    className={`
                      relative group flex items-center gap-2.5 px-2.5 py-[6px] rounded-[var(--nx-radius-md)] text-[13px] cursor-pointer transition-all duration-100
                      ${
                        selectedPageId === page.id
                          ? 'nx-sidebar-page--selected bg-[var(--nx-bg-active)] text-[var(--nx-text-primary)]'
                          : 'text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-hover)] hover:text-[var(--nx-text-primary)]'
                      }
                    `}
                  >
                    <span className="text-[15px] leading-none shrink-0">{page.icon || ''}</span>

                    {renamingId === page.id ? (
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commitRename()
                          }
                          if (e.key === 'Escape') cancelRename()
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-1 bg-[var(--nx-bg-tertiary)] border border-[var(--nx-accent)]/30 rounded-[var(--nx-radius-sm)] px-2 py-0.5 text-[13px] text-[var(--nx-text)] outline-none min-w-0"
                      />
                    ) : (
                      <>
                        <span className="flex-1 truncate">{page.title || 'Untitled'}</span>
                        <span className="text-[10px] text-[var(--nx-text-tertiary)] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          {relativeTime(page.updated_at)}
                        </span>
                      </>
                    )}
                  </div>
                ))
              )}
            </>
          )}
        </div>

        {/* Trash toggle at bottom */}
        {!showTrash && (
          <div className="px-3 py-2.5 border-t border-[var(--nx-border-subtle)] shrink-0">
            <button
              onClick={() => setShowTrash(true)}
              className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-[var(--nx-radius-md)] text-[13px] text-[var(--nx-text-tertiary)] hover:text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-hover)] transition-all duration-150"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              <span>Trash</span>
              {deletedPages.length > 0 && (
                <span className="ml-auto text-[10px] bg-[var(--nx-bg-tertiary)] text-[var(--nx-text-tertiary)] px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {deletedPages.length}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Resize handle */}
        <div
          onMouseDown={onMouseDown}
          className="absolute top-0 right-0 w-[3px] h-full cursor-col-resize group/resize z-10"
        >
          <div className="w-px h-full bg-transparent group-hover/resize:bg-[var(--nx-accent)]/30 transition-colors duration-150 ml-[1px]" />
        </div>
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            {
              label: 'Rename',
              action: () => {
                startRename(ctxMenu.pageId)
                setCtxMenu(null)
              },
            },
            {
              label: 'Duplicate',
              action: () => {
                duplicatePage(ctxMenu.pageId)
                setCtxMenu(null)
              },
            },
            { type: 'separator' },
            {
              label: 'Delete',
              danger: true,
              action: () => {
                deletePage(ctxMenu.pageId)
                setCtxMenu(null)
              },
            },
          ]}
        />
      )}
    </>
  )
}
