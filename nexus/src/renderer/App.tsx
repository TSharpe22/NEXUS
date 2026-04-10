import React, { useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { Sidebar } from './components/Sidebar'
import { Editor } from './components/Editor'
import { EmptyState } from './components/EmptyState'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { useAppStore } from './stores/app-store'
import { isMac } from './utils/shortcuts'

export function App() {
  const {
    selectedPageId,
    sidebarCollapsed, setSidebarCollapsed,
    createPage, deletePage,
    loadDeletedPages,
  } = useAppStore()

  // Load trash count on mount
  useEffect(() => {
    loadDeletedPages()
  }, [loadDeletedPages])

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key === 'n') {
        e.preventDefault()
        createPage()
      }

      if (mod && e.key === '\\') {
        e.preventDefault()
        setSidebarCollapsed(!sidebarCollapsed)
      }

      // Delete PAGE via Cmd+Backspace. Cmd+Shift+Backspace is reserved for
      // deleting the currently-focused block inside the editor.
      const deleteShortcutPressed = isMac()
        ? (mod && !e.shiftKey && e.key === 'Backspace')
        : (mod && !e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace'))

      if (deleteShortcutPressed && selectedPageId) {
        // Only delete the page if focus isn't in an editable element —
        // otherwise we'd stomp on normal in-editor backspace behavior.
        const active = document.activeElement
        const inEditable =
          active instanceof HTMLElement &&
          (active.isContentEditable ||
            active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA')
        if (!inEditable) {
          e.preventDefault()
          deletePage(selectedPageId)
        }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [createPage, setSidebarCollapsed, sidebarCollapsed, deletePage, selectedPageId])

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[var(--nx-bg)]">
      {/* Title bar drag region */}
      <div className="absolute top-0 left-0 right-0 h-[var(--nx-titlebar-height)] titlebar-drag z-40 pointer-events-none" />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        {/* Main content area */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0 bg-[var(--nx-bg)]">
          {/* Titlebar spacer */}
          <div className="h-[var(--nx-titlebar-height)] titlebar-drag shrink-0" />

          {/* Editor or empty state */}
          <div className="flex-1 overflow-hidden">
            {selectedPageId ? (
              <Editor key={selectedPageId} pageId={selectedPageId} />
            ) : (
              <EmptyState />
            )}
          </div>
        </main>
      </div>

      <StatusBar />
      <CommandPalette />

      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: 'var(--nx-bg-tertiary)',
            color: 'var(--nx-text)',
            border: '1px solid var(--nx-border)',
            fontSize: '13px',
            borderRadius: 'var(--nx-radius-md)',
            boxShadow: 'var(--nx-shadow-lg)',
          },
        }}
      />
    </div>
  )
}
