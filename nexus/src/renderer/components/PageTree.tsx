import React, { useCallback, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import type { Page } from '../../shared/types'
import { useAppStore } from '../stores/app-store'
import { PageIcon } from '../blocks/icons'
import { relativeTime } from '../hooks/use-relative-time'

export interface TreeNode {
  page: Page
  children: TreeNode[]
}

/** Where a dragged page will land relative to the row under the cursor. */
type DropZone = 'before' | 'after' | 'inside'

/**
 * Build the sidebar tree from the flat page list.
 *
 * The incoming order already matches the database's (sort_order, updated_at)
 * ordering, so grouping preserves it. A page whose parent is missing from the
 * list is promoted to the root rather than vanishing — the tree must always
 * render every page it was given.
 */
export function buildTree(pages: Page[]): TreeNode[] {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const childrenOf = new Map<string | null, TreeNode[]>()

  for (const page of pages) {
    const parentId =
      page.parent_page_id && byId.has(page.parent_page_id) ? page.parent_page_id : null
    const bucket = childrenOf.get(parentId)
    const node: TreeNode = { page, children: [] }
    if (bucket) bucket.push(node)
    else childrenOf.set(parentId, [node])
  }

  const attach = (nodes: TreeNode[]): TreeNode[] => {
    for (const node of nodes) {
      node.children = attach(childrenOf.get(node.page.id) ?? [])
    }
    return nodes
  }

  return attach(childrenOf.get(null) ?? [])
}

interface RenameProps {
  renamingId: string | null
  renameValue: string
  onRenameChange(value: string): void
  onRenameCommit(): void
  onRenameCancel(): void
  onStartRename(pageId: string): void
  onContextMenu(e: React.MouseEvent, pageId: string): void
}

interface DragState {
  draggedId: string | null
  overId: string | null
  zone: DropZone | null
}

export function PageTree({ pages, ...rename }: { pages: Page[] } & RenameProps) {
  const movePage = useAppStore((s) => s.movePage)
  const [drag, setDrag] = useState<DragState>({ draggedId: null, overId: null, zone: null })
  const [rootDropActive, setRootDropActive] = useState(false)

  const tree = useMemo(() => buildTree(pages), [pages])

  // Sibling lists derived from the *rendered* tree, so drop indices always
  // agree with what the user sees (including promoted orphans).
  const siblingsOf = useCallback(
    (parentId: string | null): Page[] => {
      if (parentId === null) return tree.map((n) => n.page)
      const find = (nodes: TreeNode[]): TreeNode | null => {
        for (const node of nodes) {
          if (node.page.id === parentId) return node
          const hit = find(node.children)
          if (hit) return hit
        }
        return null
      }
      return find(tree)?.children.map((n) => n.page) ?? []
    },
    [tree],
  )

  const isAncestorOrSelf = useCallback(
    (maybeAncestorId: string, pageId: string): boolean => {
      const byId = new Map(pages.map((p) => [p.id, p]))
      const seen = new Set<string>()
      let current: string | null = pageId
      while (current) {
        if (current === maybeAncestorId) return true
        if (seen.has(current)) return false
        seen.add(current)
        current = byId.get(current)?.parent_page_id ?? null
      }
      return false
    },
    [pages],
  )

  const clearDrag = useCallback(() => {
    setDrag({ draggedId: null, overId: null, zone: null })
    setRootDropActive(false)
  }, [])

  const commitDrop = useCallback(
    async (targetPage: Page, zone: DropZone) => {
      const draggedId = drag.draggedId
      clearDrag()
      if (!draggedId || draggedId === targetPage.id) return

      // Dropping a page into its own subtree would orphan the whole branch.
      if (isAncestorOrSelf(draggedId, targetPage.id)) {
        toast.error('Cannot move a page inside itself')
        return
      }

      try {
        if (zone === 'inside') {
          const kids = siblingsOf(targetPage.id).filter((p) => p.id !== draggedId)
          await movePage(draggedId, targetPage.id, kids.length)
        } else {
          const parentId = siblingsOf(targetPage.parent_page_id).some(
            (p) => p.id === targetPage.id,
          )
            ? targetPage.parent_page_id
            : null
          const sibs = siblingsOf(parentId).filter((p) => p.id !== draggedId)
          const index = sibs.findIndex((p) => p.id === targetPage.id)
          await movePage(draggedId, parentId, zone === 'before' ? index : index + 1)
        }
      } catch {
        toast.error('Could not move that page')
      }
    },
    [drag.draggedId, clearDrag, isAncestorOrSelf, siblingsOf, movePage],
  )

  const commitRootDrop = useCallback(async () => {
    const draggedId = drag.draggedId
    clearDrag()
    if (!draggedId) return
    try {
      const roots = siblingsOf(null).filter((p) => p.id !== draggedId)
      await movePage(draggedId, null, roots.length)
    } catch {
      toast.error('Could not move that page')
    }
  }, [drag.draggedId, clearDrag, siblingsOf, movePage])

  return (
    <div
      onDragOver={(e) => {
        if (!drag.draggedId) return
        e.preventDefault()
        setRootDropActive(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setRootDropActive(false)
      }}
      onDrop={(e) => {
        // Rows stop propagation, so reaching here means empty space.
        e.preventDefault()
        // Keep this off the sidebar's file-import drop handler.
        e.stopPropagation()
        commitRootDrop()
      }}
      className={`min-h-[40px] rounded-[var(--nx-radius-md)] ${
        rootDropActive && !drag.overId ? 'bg-[var(--nx-accent)]/[0.06]' : ''
      }`}
    >
      <TreeRows
        nodes={tree}
        depth={0}
        drag={drag}
        setDrag={setDrag}
        clearDrag={clearDrag}
        onDropRow={commitDrop}
        isAncestorOrSelf={isAncestorOrSelf}
        {...rename}
      />
    </div>
  )
}

interface RowsProps extends RenameProps {
  nodes: TreeNode[]
  depth: number
  drag: DragState
  setDrag: React.Dispatch<React.SetStateAction<DragState>>
  clearDrag(): void
  onDropRow(page: Page, zone: DropZone): void
  isAncestorOrSelf(maybeAncestorId: string, pageId: string): boolean
}

function TreeRows({ nodes, depth, ...props }: RowsProps) {
  const {
    drag, setDrag, clearDrag, onDropRow, isAncestorOrSelf,
    renamingId, renameValue, onRenameChange, onRenameCommit, onRenameCancel,
    onStartRename, onContextMenu,
  } = props

  const selectedPageId = useAppStore((s) => s.selectedPageId)
  const expandedPageIds = useAppStore((s) => s.expandedPageIds)
  const selectPage = useAppStore((s) => s.selectPage)
  const toggleExpanded = useAppStore((s) => s.toggleExpanded)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
  const createPage = useAppStore((s) => s.createPage)

  return (
    <>
      {nodes.map(({ page, children }) => {
        const hasChildren = children.length > 0
        const isExpanded = expandedPageIds.has(page.id)
        const isSelected = selectedPageId === page.id
        const isDragging = drag.draggedId === page.id
        const isOver = drag.overId === page.id
        const invalidTarget =
          drag.draggedId !== null && isAncestorOrSelf(drag.draggedId, page.id)

        return (
          <React.Fragment key={page.id}>
            <div className="relative">
              {/* Drop indicators */}
              {isOver && !invalidTarget && drag.zone === 'before' && (
                <div className="absolute -top-px left-0 right-0 h-[2px] bg-[var(--nx-accent)] rounded-full z-10" />
              )}
              {isOver && !invalidTarget && drag.zone === 'after' && (
                <div className="absolute -bottom-px left-0 right-0 h-[2px] bg-[var(--nx-accent)] rounded-full z-10" />
              )}

              <div
                draggable={renamingId !== page.id}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  // Firefox refuses to start a drag without payload.
                  e.dataTransfer.setData('text/plain', page.id)
                  setDrag({ draggedId: page.id, overId: null, zone: null })
                }}
                onDragEnd={clearDrag}
                onDragOver={(e) => {
                  if (!drag.draggedId || drag.draggedId === page.id) return
                  e.preventDefault()
                  e.stopPropagation()
                  const rect = e.currentTarget.getBoundingClientRect()
                  const offset = e.clientY - rect.top
                  const zone: DropZone =
                    offset < rect.height * 0.28
                      ? 'before'
                      : offset > rect.height * 0.72
                        ? 'after'
                        : 'inside'
                  if (drag.overId !== page.id || drag.zone !== zone) {
                    setDrag((d) => ({ ...d, overId: page.id, zone }))
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (invalidTarget) {
                    clearDrag()
                    return
                  }
                  onDropRow(page, drag.zone ?? 'after')
                }}
                onClick={() => {
                  if (renamingId !== page.id) selectPage(page.id)
                }}
                onContextMenu={(e) => onContextMenu(e, page.id)}
                onDoubleClick={() => onStartRename(page.id)}
                style={{ paddingLeft: 10 + depth * 14 }}
                className={`
                  relative group flex items-center gap-1.5 pr-2 py-[6px] rounded-[var(--nx-radius-md)]
                  text-[13px] cursor-pointer transition-all duration-100
                  ${isDragging ? 'opacity-40' : ''}
                  ${
                    isOver && !invalidTarget && drag.zone === 'inside'
                      ? 'ring-1 ring-inset ring-[var(--nx-accent)] bg-[var(--nx-accent)]/[0.08]'
                      : ''
                  }
                  ${
                    isSelected
                      ? 'nx-sidebar-page--selected bg-[var(--nx-bg-active)] text-[var(--nx-text-primary)]'
                      : 'text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-hover)] hover:text-[var(--nx-text-primary)]'
                  }
                `}
              >
                {/* Expand / collapse. Always occupies space so icons stay aligned. */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (hasChildren) toggleExpanded(page.id)
                  }}
                  tabIndex={hasChildren ? 0 : -1}
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  aria-expanded={hasChildren ? isExpanded : undefined}
                  className={`w-4 h-4 shrink-0 flex items-center justify-center rounded-[3px] text-[var(--nx-text-tertiary)] ${
                    hasChildren
                      ? 'hover:bg-[var(--nx-bg-active)] hover:text-[var(--nx-text-secondary)]'
                      : 'invisible pointer-events-none'
                  }`}
                >
                  <svg
                    width="10" height="10" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                    className={`transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                <span className="text-[var(--nx-text-tertiary)] shrink-0">
                  <PageIcon iconKey={page.icon} size={14} />
                </span>

                {renamingId === page.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => onRenameChange(e.target.value)}
                    onBlur={onRenameCommit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        onRenameCommit()
                      }
                      if (e.key === 'Escape') onRenameCancel()
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 bg-[var(--nx-bg-tertiary)] border border-[var(--nx-accent)]/30 rounded-[var(--nx-radius-sm)] px-2 py-0.5 text-[13px] text-[var(--nx-text)] outline-none min-w-0"
                  />
                ) : (
                  <>
                    <span className="flex-1 truncate">{page.title || 'Untitled'}</span>

                    <span className="flex items-center gap-0.5 shrink-0">
                      {/* Timestamp yields to the action buttons on hover. */}
                      <span className="text-[10px] text-[var(--nx-text-tertiary)] opacity-100 group-hover:opacity-0 group-hover:hidden transition-opacity">
                        {relativeTime(page.updated_at)}
                      </span>

                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleFavorite(page.id)
                        }}
                        title={page.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                        className={`w-5 h-5 flex items-center justify-center rounded-[3px] hover:bg-[var(--nx-bg-active)] transition-opacity ${
                          page.is_favorite
                            ? 'text-[var(--nx-accent)] opacity-100'
                            : 'text-[var(--nx-text-tertiary)] opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <svg
                          width="12" height="12" viewBox="0 0 24 24"
                          fill={page.is_favorite ? 'currentColor' : 'none'}
                          stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"
                        >
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          createPage(page.id)
                        }}
                        title="Add a page inside"
                        className="w-5 h-5 flex items-center justify-center rounded-[3px] text-[var(--nx-text-tertiary)] opacity-0 group-hover:opacity-100 hover:bg-[var(--nx-bg-active)] hover:text-[var(--nx-text-secondary)] transition-opacity"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>
                    </span>
                  </>
                )}
              </div>
            </div>

            {hasChildren && isExpanded && (
              <TreeRows nodes={children} depth={depth + 1} {...props} />
            )}
          </React.Fragment>
        )
      })}
    </>
  )
}
