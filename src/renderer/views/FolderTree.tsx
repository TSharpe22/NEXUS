import { useCallback, useMemo, useState } from 'react'
import { SearchHighlight } from '../design/SearchHighlight'
import type { Folder, Page } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { Icon } from '../design/Icon'
import { relativeTime } from '../hooks/use-relative-time'

/**
 * The Notes list, as a folder tree.
 *
 * Folders nest arbitrarily and a page sits in exactly one of them (or at the
 * root). Both lists come from the store flat and are grouped here, so folder
 * and page state stay in one place.
 */

const ROOT = '__root__'
const INDENT = 12

/**
 * What is being dragged.
 *
 * Chromium blanks `dataTransfer.getData()` during dragover for security, so a
 * drop target can't read the payload while deciding whether to accept it. One
 * renderer window, one drag at a time — a module-level handle is enough.
 */
let dragPayload: { kind: 'page' | 'folder'; id: string } | null = null

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform var(--nx-motion)' }}
    >
      <path d="M4 3l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface Props {
  /** Pages already narrowed by the search box and tag filter. */
  pages: Page[]
  /** True while a search or tag filter is active. */
  filtering: boolean
  query: string
  /** Page id to body excerpt, for hits matched on content rather than title. */
  snippets?: Map<string, string>
  typeName: (typeId: string) => string
  onDuplicate: (page: Page) => void
  onTrash: (page: Page) => void
}

export function FolderTree({
  pages,
  filtering,
  query,
  snippets,
  typeName,
  onDuplicate,
  onTrash
}: Props) {
  const folders = useAppStore((s) => s.folders)
  const expandedFolderIds = useAppStore((s) => s.expandedFolderIds)
  const activePageId = useAppStore((s) => s.activePageId)
  const setActivePageId = useAppStore((s) => s.setActivePageId)
  const toggleFolderExpanded = useAppStore((s) => s.toggleFolderExpanded)
  const movePageToFolder = useAppStore((s) => s.movePageToFolder)
  const moveFolder = useAppStore((s) => s.moveFolder)
  const renameFolder = useAppStore((s) => s.renameFolder)
  const deleteFolder = useAppStore((s) => s.deleteFolder)
  const createFolder = useAppStore((s) => s.createFolder)
  const createPage = useAppStore((s) => s.createPage)

  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  const foldersByParent = useMemo(() => {
    const map = new Map<string, Folder[]>()
    for (const folder of folders) {
      const key = folder.parent_folder_id ?? ROOT
      const list = map.get(key)
      if (list) list.push(folder)
      else map.set(key, [folder])
    }
    return map
  }, [folders])

  const pagesByFolder = useMemo(() => {
    const known = new Set(folders.map((f) => f.id))
    const map = new Map<string, Page[]>()
    for (const page of pages) {
      // A page whose folder was deleted from under it still has to appear
      // somewhere; unknown ids fall back to the root.
      const key = page.folder_id && known.has(page.folder_id) ? page.folder_id : ROOT
      const list = map.get(key)
      if (list) list.push(page)
      else map.set(key, [page])
    }
    return map
  }, [pages, folders])

  /**
   * Folders holding a match at any depth. While filtering, only these render
   * and they render open — otherwise a result could hide behind a collapsed
   * ancestor.
   */
  const matchingFolders = useMemo(() => {
    if (!filtering) return null
    const hit = new Set<string>()
    const parentOf = new Map(folders.map((f) => [f.id, f.parent_folder_id]))

    const mark = (folderId: string | null) => {
      let cursor = folderId
      for (let depth = 0; cursor && depth < 1000; depth++) {
        if (hit.has(cursor)) return
        hit.add(cursor)
        cursor = parentOf.get(cursor) ?? null
      }
    }

    for (const page of pages) mark(page.folder_id)
    const q = query.trim().toLowerCase()
    if (q) for (const f of folders) if (f.name.toLowerCase().includes(q)) mark(f.id)
    return hit
  }, [filtering, folders, pages, query])

  const isOpen = useCallback(
    (id: string) => (matchingFolders?.has(id) ?? false) || expandedFolderIds.includes(id),
    [expandedFolderIds, matchingFolders]
  )

  const acceptDrop = useCallback(
    (targetFolderId: string | null) => {
      const payload = dragPayload
      dragPayload = null
      setDropTarget(null)
      if (!payload) return

      if (payload.kind === 'page') {
        void movePageToFolder(payload.id, targetFolderId)
        return
      }
      if (payload.id === targetFolderId) return
      // The main process refuses cycles; on rejection the tree simply doesn't move.
      void moveFolder(payload.id, targetFolderId).catch(() => undefined)
    },
    [movePageToFolder, moveFolder]
  )

  const renderPage = (page: Page, depth: number) => (
    <div
      key={page.id}
      className={`nx-tree-row nx-tree-row--page ${page.id === activePageId ? 'is-active' : ''}`}
      style={{ paddingLeft: depth * INDENT + 8 }}
      draggable
      onDragStart={(e) => {
        dragPayload = { kind: 'page', id: page.id }
        e.dataTransfer.effectAllowed = 'move'
        // Chromium won't start a drag with an empty payload.
        e.dataTransfer.setData('text/plain', page.title || 'Untitled')
      }}
      onDragEnd={() => {
        dragPayload = null
      }}
      onClick={() => setActivePageId(page.id)}
    >
      <span className="nx-tree-row__icon">
        <Icon shape="circle" size={9} filled={page.id === activePageId} />
      </span>
      <span className="nx-tree-row__main">
        <span className="nx-tree-row__title">{page.title || 'Untitled'}</span>
        {snippets?.get(page.id) && (
          <span className="nx-tree-row__snippet">
            <SearchHighlight text={snippets.get(page.id)!} />
          </span>
        )}
        <span className="nx-tree-row__meta nx-type-data">
          {typeName(page.type_id)} · {relativeTime(page.updated_at)}
        </span>
      </span>
      <span className="nx-tree-row__actions">
        <button
          title="Duplicate"
          onClick={(e) => {
            e.stopPropagation()
            onDuplicate(page)
          }}
        >
          Copy
        </button>
        <button
          title="Move to trash"
          onClick={(e) => {
            e.stopPropagation()
            onTrash(page)
          }}
        >
          Trash
        </button>
      </span>
    </div>
  )

  const renderFolder = (folder: Folder, depth: number) => {
    if (matchingFolders && !matchingFolders.has(folder.id)) return null

    const open = isOpen(folder.id)
    const childFolders = foldersByParent.get(folder.id) ?? []
    const childPages = pagesByFolder.get(folder.id) ?? []

    return (
      <div key={folder.id}>
        <div
          className={`nx-tree-row nx-tree-row--folder ${dropTarget === folder.id ? 'is-drop-target' : ''}`}
          style={{ paddingLeft: depth * INDENT + 4 }}
          draggable={renamingId !== folder.id}
          onDragStart={(e) => {
            dragPayload = { kind: 'folder', id: folder.id }
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', folder.name)
          }}
          onDragEnd={() => {
            dragPayload = null
            setDropTarget(null)
          }}
          onDragOver={(e) => {
            if (!dragPayload) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropTarget(folder.id)
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return
            setDropTarget((cur) => (cur === folder.id ? null : cur))
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            acceptDrop(folder.id)
          }}
          onClick={() => toggleFolderExpanded(folder.id)}
        >
          <span className="nx-tree-row__chevron">
            <Chevron open={open} />
          </span>
          <span className="nx-tree-row__icon">
            <Icon shape="square" size={10} filled={dropTarget === folder.id} />
          </span>

          {renamingId === folder.id ? (
            <InlineRename
              initial={folder.name}
              onCommit={(name) => {
                void renameFolder(folder.id, name)
                setRenamingId(null)
              }}
              onCancel={() => setRenamingId(null)}
            />
          ) : (
            <>
              <span className="nx-tree-row__title nx-tree-row__title--folder">{folder.name}</span>
              {childPages.length > 0 && !open && (
                <span className="nx-tree-row__count nx-type-data">{childPages.length}</span>
              )}
              <span className="nx-tree-row__actions">
                <button
                  title="New page in this folder"
                  onClick={async (e) => {
                    e.stopPropagation()
                    const page = await createPage()
                    await movePageToFolder(page.id, folder.id)
                  }}
                >
                  Page
                </button>
                <button
                  title="New subfolder"
                  onClick={async (e) => {
                    e.stopPropagation()
                    const created = await createFolder('New folder', folder.id)
                    setRenamingId(created.id)
                  }}
                >
                  Sub
                </button>
                <button
                  title="Rename"
                  onClick={(e) => {
                    e.stopPropagation()
                    setRenamingId(folder.id)
                  }}
                >
                  Name
                </button>
                <button
                  className="nx-tree-row__danger"
                  // Contents are lifted to the parent, never deleted — see
                  // deleteFolder() in repo.ts. Nothing to confirm.
                  title="Delete folder (its pages move up a level)"
                  onClick={(e) => {
                    e.stopPropagation()
                    void deleteFolder(folder.id)
                  }}
                >
                  Del
                </button>
              </span>
            </>
          )}
        </div>

        {open && (
          <div>
            {childFolders.map((child) => renderFolder(child, depth + 1))}
            {childPages.map((page) => renderPage(page, depth + 1))}
            {childFolders.length === 0 && childPages.length === 0 && (
              <div className="nx-tree-empty nx-type-data" style={{ paddingLeft: (depth + 1) * INDENT + 20 }}>
                Empty
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={`nx-tree ${dropTarget === ROOT ? 'is-drop-target' : ''}`}
      onDragOver={(e) => {
        if (!dragPayload) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropTarget(ROOT)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDropTarget((cur) => (cur === ROOT ? null : cur))
      }}
      onDrop={(e) => {
        e.preventDefault()
        acceptDrop(null)
      }}
    >
      {(foldersByParent.get(ROOT) ?? []).map((folder) => renderFolder(folder, 0))}
      {(pagesByFolder.get(ROOT) ?? []).map((page) => renderPage(page, 0))}
    </div>
  )
}

function InlineRename({
  initial,
  onCommit,
  onCancel
}: {
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  // Commit fires from Enter and from blur; Escape has to suppress the blur
  // that immediately follows it.
  const [settled, setSettled] = useState(false)

  return (
    <input
      className="nx-input nx-tree-rename"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => {
        if (!settled) onCommit(value)
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          setSettled(true)
          onCommit(value)
        }
        if (e.key === 'Escape') {
          setSettled(true)
          onCancel()
        }
      }}
    />
  )
}
