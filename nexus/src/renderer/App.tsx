import React, { useEffect, useCallback } from 'react'
import { Toaster } from 'react-hot-toast'
import toast from 'react-hot-toast'
import { Sidebar } from './components/Sidebar'
import { Editor } from './components/Editor'
import { EmptyState } from './components/EmptyState'
import { StatusBar } from './components/StatusBar'
import { CommandPalette } from './components/CommandPalette'
import { useAppStore } from './stores/app-store'
import { useEditorStore } from './stores/editor-store'
import { isMac } from './utils/shortcuts'
import { flushAllPending } from './utils/flush-registry'

export function App() {
  const {
    sidebarCollapsed, setSidebarCollapsed,
    createPage, deletePage,
    loadPages,
    loadDeletedPages,
  } = useAppStore()
  const selectedPageId = useEditorStore((s) => s.selectedPageId)
  const selectPage = useEditorStore((s) => s.selectPage)

  // Load trash count on mount
  useEffect(() => {
    loadDeletedPages()
  }, [loadDeletedPages])

  // Main process asks the renderer to drain debounced writes before quitting.
  useEffect(() => {
    return window.lifecycle.onFlushPending(async () => {
      await flushAllPending()
    })
  }, [])

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

      // Cmd+Shift+E — Export current page
      if (mod && e.shiftKey && (e.key === 'e' || e.key === 'E') && selectedPageId) {
        e.preventDefault()
        ;(async () => {
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
        })()
        return
      }

      // Cmd+Shift+I — Import
      if (mod && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault()
        ;(async () => {
          const paths = await window.api.dialog.showOpenDialog({
            title: 'Import',
            filters: [{ name: 'All Supported', extensions: ['md', 'txt', 'json'] }],
            properties: ['openFile', 'multiSelections'],
          })
          if (!paths || paths.length === 0) return
          let imported = 0; let failed = 0; let firstPageId: string | null = null
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
        })()
        return
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
        gutter={8}
        toastOptions={{
          duration: 3000,
          ariaProps: { role: 'status', 'aria-live': 'polite' },
          style: {
            background: 'var(--nx-bg-tertiary)',
            color: 'var(--nx-text)',
            border: '1px solid var(--nx-border)',
            fontSize: '13px',
            borderRadius: 'var(--nx-radius-md)',
            boxShadow: 'var(--nx-shadow-lg)',
            maxWidth: '320px',
          },
          success: { duration: 2500 },
          error: { duration: 5000 },
        }}
      />
    </div>
  )
}
