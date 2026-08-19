import { useEffect, useMemo, useState } from 'react'
import { useSearch } from '../hooks/use-search'
import toast from 'react-hot-toast'
import type { Page } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { Button } from '../design/Button'
import { EmptyState } from '../design/EmptyState'
import { Editor } from '../editor/Editor'
import { PropertiesPanel } from './PropertiesPanel'
import { BacklinksPanel } from './BacklinksPanel'
import { relativeTime } from '../hooks/use-relative-time'
import { FolderTree } from './FolderTree'
import { TagFilter } from './TagFilter'
import './Notes.css'

export function Notes() {
  const {
    pages,
    trashed,
    types,
    loaded,
    activePageId,
    setActivePageId,
    createPage,
    duplicatePage,
    trashPage,
    restorePage,
    deletePageForever,
    emptyTrash,
    folders,
    activeTagFilter,
    createFolder
  } = useAppStore()

  const [showTrash, setShowTrash] = useState(false)
  const [query, setQuery] = useState('')
  const [taggedPageIds, setTaggedPageIds] = useState<string[] | null>(null)
  const [newTypeName, setNewTypeName] = useState('')
  const [creatingType, setCreatingType] = useState(false)
  const [selectedTypeId, setSelectedTypeId] = useState('note')

  // Resolved against the store, so a page opened from the palette, a mention
  // or the graph is always found — not only ones this view happened to load.
  const activePage = useMemo(
    () => pages.find((p) => p.id === activePageId) ?? trashed.find((p) => p.id === activePageId) ?? null,
    [pages, trashed, activePageId]
  )
  const isTrashed = !!activePage && trashed.some((p) => p.id === activePage.id)

  const typeName = (typeId: string) => types.find((t) => t.id === typeId)?.name ?? 'Note'

  // Resolved in the main process so the page_tags join stays in SQL rather
  // than shipping every page's tags to the renderer to filter a list.
  useEffect(() => {
    let cancelled = false
    if (activeTagFilter.length === 0) {
      setTaggedPageIds(null)
      return
    }
    window.api.tags.pageIdsFor(activeTagFilter).then((ids) => {
      if (!cancelled) setTaggedPageIds(ids)
    })
    return () => {
      cancelled = true
    }
  }, [activeTagFilter])

  // Body text lives in `pages.content` as a BlockNote JSON document, so it
  // cannot be matched in the renderer. The main process owns an FTS index over
  // titles and that body text; this supplies the page matches below.
  const { results: searchResults } = useSearch(query)

  const searchSnippets = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of searchResults) if (r.bodySnippet) map.set(r.page.id, r.bodySnippet)
    return map
  }, [searchResults])

  const list = useMemo(() => {
    let source: Page[] = showTrash ? trashed : pages

    if (!showTrash && taggedPageIds) {
      const allowed = new Set(taggedPageIds)
      source = source.filter((p) => allowed.has(p.id))
    }

    const q = query.trim().toLowerCase()
    if (!q) return source

    // Trash is a flat list the index does not cover (it only holds live
    // pages), so it keeps matching on title alone.
    if (showTrash) {
      return source.filter((p) => (p.title || 'Untitled').toLowerCase().includes(q))
    }

    // A page also matches when its folder's name does, so searching for a
    // folder surfaces what's inside it.
    const matchingFolderIds = new Set(
      folders.filter((f) => f.name.toLowerCase().includes(q)).map((f) => f.id)
    )
    const matchedIds = new Set(searchResults.map((r) => r.page.id))
    return source.filter(
      (p) => matchedIds.has(p.id) || (p.folder_id ? matchingFolderIds.has(p.folder_id) : false)
    )
  }, [showTrash, trashed, pages, query, taggedPageIds, folders, searchResults])

  const filtering = query.trim().length > 0 || activeTagFilter.length > 0

  const handleCreateType = async () => {
    const name = newTypeName.trim()
    if (!name) return
    try {
      const type = await useAppStore.getState().createType(name)
      setSelectedTypeId(type.id)
      setNewTypeName('')
      setCreatingType(false)
    } catch {
      toast.error(`A type named "${name}" already exists`)
    }
  }

  const handleDeleteForever = async (page: Page) => {
    const label = page.title || 'Untitled'
    // Permanent and unrecoverable — the one place in the app that warrants a
    // confirm. Previously this fired straight from a hover button.
    if (!window.confirm(`Delete "${label}" permanently? This cannot be undone.`)) return
    await deletePageForever(page.id)
    toast.success('Page deleted')
  }

  const handleEmptyTrash = async () => {
    if (!window.confirm(`Permanently delete all ${trashed.length} page(s) in the trash?`)) return
    const count = await emptyTrash()
    toast.success(`Deleted ${count} page${count === 1 ? '' : 's'}`)
  }

  return (
    <div className="nx-notes">
      <aside className="nx-notes__list">
        <div className="nx-notes__list-top">
          <input
            className="nx-input nx-notes__search"
            placeholder={showTrash ? 'Search trash' : 'Search pages'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {!showTrash && (
            <div className="nx-notes__create">
              {creatingType ? (
                <input
                  className="nx-input nx-notes__type-input"
                  autoFocus
                  placeholder="New type name"
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateType()
                    if (e.key === 'Escape') {
                      setCreatingType(false)
                      setNewTypeName('')
                    }
                  }}
                  onBlur={() => !newTypeName && setCreatingType(false)}
                />
              ) : (
                <select
                  className="nx-select nx-notes__type-select"
                  value={selectedTypeId}
                  onChange={(e) => {
                    if (e.target.value === '__new__') setCreatingType(true)
                    else setSelectedTypeId(e.target.value)
                  }}
                  title="Type for new pages"
                >
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                  <option value="__new__">+ New type…</option>
                </select>
              )}
              <Button onClick={() => createPage(selectedTypeId)}>New</Button>
              <Button variant="quiet" onClick={() => createFolder('New folder', null)} title="New folder">
                Folder
              </Button>
            </div>
          )}

          {!showTrash && <TagFilter />}
        </div>

        <div className="nx-notes__list-scroll">
          {!loaded ? (
            <div className="nx-notes__hint nx-type-data">Loading…</div>
          ) : list.length === 0 && (showTrash || folders.length === 0) ? (
            <div className="nx-notes__hint nx-type-data">
              {filtering
                ? 'No matches'
                : showTrash
                  ? 'Trash is empty'
                  : 'No pages yet — create one above'}
            </div>
          ) : showTrash ? (
            // Trash stays a flat list — folders are for organising live pages.
            list.map((page) => (
              <div
                key={page.id}
                className={`nx-notes__item ${page.id === activePageId ? 'nx-notes__item--active' : ''}`}
                onClick={() => setActivePageId(page.id)}
              >
                <div className="nx-notes__item-main">
                  <div className="nx-notes__item-title">{page.title || 'Untitled'}</div>
                  <div className="nx-notes__item-meta nx-type-data">
                    {typeName(page.type_id)} · {relativeTime(page.updated_at)}
                  </div>
                </div>

                <div className="nx-notes__item-actions">
                  <button
                    title="Restore"
                    onClick={(e) => {
                      e.stopPropagation()
                      restorePage(page.id)
                    }}
                  >
                    Restore
                  </button>
                  <button
                    className="nx-notes__danger"
                    title="Delete permanently"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteForever(page)
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          ) : (
            <FolderTree
              pages={list}
              filtering={filtering}
              query={query}
              snippets={searchSnippets}
              typeName={typeName}
              onDuplicate={(page) => duplicatePage(page.id)}
              onTrash={(page) => trashPage(page.id)}
            />
          )}
        </div>

        <div className="nx-notes__list-foot">
          <button className="nx-notes__trash-toggle" onClick={() => setShowTrash((v) => !v)}>
            {showTrash ? '← Back to pages' : `Trash (${trashed.length})`}
          </button>
          {showTrash && trashed.length > 0 && (
            <button className="nx-notes__trash-toggle nx-notes__danger" onClick={handleEmptyTrash}>
              Empty trash
            </button>
          )}
        </div>
      </aside>

      <section className="nx-notes__main">
        {activePage ? (
          <div className="nx-notes__scroll">
            <div className="nx-notes__doc">
              {isTrashed && (
                <div className="nx-notes__banner">
                  This page is in the trash.
                  <button onClick={() => restorePage(activePage.id)}>Restore it</button>
                </div>
              )}
              <Editor key={activePage.id} page={activePage} />
              <PropertiesPanel page={activePage} />
              <BacklinksPanel pageId={activePage.id} />
            </div>
          </div>
        ) : (
          <EmptyState
            text="No page selected"
            meta="Pick one from the list, or create a new page."
            action={<Button onClick={() => createPage(selectedTypeId)}>New page</Button>}
          />
        )}
      </section>
    </div>
  )
}
