import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react'
import {
  useCreateBlockNote,
  FormattingToolbarController,
  SuggestionMenuController,
} from '@blocknote/react'
import { filterSuggestionItems } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { multiColumnDropCursor } from '@blocknote/xl-multi-column'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { useAppStore } from '../stores/app-store'
import { useDebounce } from '../hooks/use-debounce'
import type { Block as NexusBlock, Page } from '../../shared/types'
import { v4 as uuidv4 } from 'uuid'
import { nexusSchema, type NexusEditor } from '../blocks/schema'
import { getNexusSlashMenuItems } from '../blocks/slash-items'
import { SlashMenu } from './SlashMenu'
import { CustomFormattingToolbar } from './FormattingToolbar'
import { BlockContextMenu } from './BlockContextMenu'
import { LinkMenu, getLinkMenuItems, type LinkMenuItem } from './LinkMenu'
import { LassoSelect } from './LassoSelect'
import type { LinkTarget } from '../../shared/types'

const WIDTH_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <line x1="2" y1="4" x2="14" y2="4" />
    <line x1="4" y1="8" x2="12" y2="8" />
    <line x1="3" y1="12" x2="13" y2="12" />
  </svg>
)

const WIDTH_MIN = 400
const WIDTH_MAX = 1400
const WIDTH_DEFAULT = 720

// Walk BlockNote document tree and extract all pageMention inline content nodes
// as well as nexus:// text links.
function extractLinkTargets(blocks: unknown[]): LinkTarget[] {
  const targets = new Map<string, string | null>()

  function walkInlineContent(content: unknown, blockText: string) {
    if (!Array.isArray(content)) return
    for (const item of content) {
      if (!item || typeof item !== 'object') continue
      const node = item as {
        type?: string
        props?: Record<string, string>
        href?: string
        styles?: Record<string, string>
        content?: unknown
        text?: string
      }
      // pageMention chip
      if (node.type === 'pageMention' && node.props?.pageId) {
        if (!targets.has(node.props.pageId)) {
          targets.set(node.props.pageId, blockText.slice(0, 200) || null)
        }
      }
      // nexus:// text link (BlockNote "link" inline type)
      const href = node.href || node.styles?.link || node.props?.url
      if (href && typeof href === 'string' && href.startsWith('nexus://')) {
        const pageId = href.replace('nexus://', '').split('/')[0]
        if (pageId && !targets.has(pageId)) {
          targets.set(pageId, blockText.slice(0, 200) || null)
        }
      }
      // Recurse into link content
      if (node.type === 'link' && Array.isArray(node.content)) {
        walkInlineContent(node.content, blockText)
      }
    }
  }

  function walkBlocks(items: unknown[]) {
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue
      const block = raw as { content?: unknown; children?: unknown[] }
      let blockText = ''
      if (Array.isArray(block.content)) {
        for (const c of block.content) {
          if (typeof c === 'string') blockText += c
          else if (c && typeof c === 'object' && 'text' in c) blockText += String((c as { text: string }).text)
          else if (c && typeof c === 'object' && 'type' in c && (c as { type: string }).type === 'pageMention') {
            blockText += `[[${((c as { props?: { pageTitle?: string } }).props?.pageTitle) || ''}]]`
          }
        }
      }
      walkInlineContent(block.content, blockText)
      if (Array.isArray(block.children)) walkBlocks(block.children)
    }
  }

  walkBlocks(blocks)
  return Array.from(targets, ([targetPageId, context]) => ({ targetPageId, context }))
}

interface Props {
  pageId: string
}

type ContextMenuState = {
  x: number
  y: number
  block: { id: string; type: string; props: Record<string, unknown>; content?: unknown }
} | null

// Reset every toggle block's `open` prop to true. The spec says toggle state
// is ephemeral and should not survive page reloads.
function resetToggles(blocks: unknown[]): void {
  for (const raw of blocks) {
    if (!raw || typeof raw !== 'object') continue
    const block = raw as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
    if (block.type === 'toggle') {
      block.props = { ...(block.props || {}), open: true }
    }
    if (Array.isArray(block.children) && block.children.length) {
      resetToggles(block.children)
    }
  }
}

export function Editor({ pageId }: Props) {
  const { setSaveStatus, updatePage, currentPage, pages, createPage, loadPages, selectPage } = useAppStore()
  const { selectedBlockIds, isLassoActive, deselectAllBlocks, selectBlocks, toggleBlockSelection } = useAppStore()
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const initialContentLoaded = useRef(false)
  const currentPageId = useRef(pageId)
  const lastSavedBlocksSnapshot = useRef<string>('')
  const isMountedRef = useRef(true)

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [widthSliderOpen, setWidthSliderOpen] = useState(false)
  // Local optimistic width — updated instantly on slider drag, cleared on page change.
  // Prevents stutter from async IPC round-trip in updatePage.
  const [localWidthPx, setLocalWidthPx] = useState<number | null>(null)

  // Numeric pixel width. 0 = full/unconstrained.
  const storedWidth = currentPage?.page_width
  const widthPx: number = (typeof storedWidth === 'number' && storedWidth > 0)
    ? storedWidth
    : (typeof storedWidth === 'number' && storedWidth === 0 ? 0 : WIDTH_DEFAULT)
  // Display value: prefer local state (instant) over store value (async)
  const displayWidthPx = localWidthPx ?? widthPx
  // Full (0) gets 24px breathing room on each side beyond the existing px-8 padding
  const maxWidthStyle = displayWidthPx === 0 ? 'calc(100% - 48px)' : `${displayWidthPx}px`

  // Clear local state when navigating to a different page
  useEffect(() => {
    setLocalWidthPx(null)
  }, [pageId])

  const handleWidthChange = useCallback(
    (val: number) => {
      updatePage(pageId, { page_width: val })
    },
    [pageId, updatePage],
  )

  // [[ link menu: insert a pageMention inline content when user selects a page
  const handleLinkSelect = useCallback(
    async (page: Page | null, title: string, editorRef: NexusEditor) => {
      let targetPage = page
      if (!targetPage) {
        // Create new page with the given title
        const newPage = await window.api.pages.create()
        await window.api.pages.update(newPage.id, { title })
        await loadPages()
        targetPage = { ...newPage, title }
      }
      editorRef.insertInlineContent([
        {
          type: 'pageMention',
          props: {
            pageId: targetPage.id,
            pageTitle: targetPage.title || title,
            pageIcon: targetPage.icon || 'doc',
          },
        } as never,
        ' ',
      ])
    },
    [loadPages],
  )

  const editor = useCreateBlockNote({
    schema: nexusSchema,
    dropCursor: multiColumnDropCursor,
    domAttributes: { editor: { class: 'nx-editor-root' } },
  }) as unknown as NexusEditor

  // Build link menu getItems with current pages list
  const linkMenuGetItems = useMemo(
    () =>
      getLinkMenuItems(pages, (page, title) => {
        handleLinkSelect(page, title, editor)
      }),
    [pages, editor, handleLinkSelect],
  )

  // Intercept nexus:// link clicks and navigate within the app
  useEffect(() => {
    const container = editorContainerRef.current
    if (!container) return
    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a')
      if (!target) return
      const href = target.getAttribute('href') || ''
      if (!href.startsWith('nexus://')) return
      e.preventDefault()
      e.stopPropagation()
      const targetPageId = href.replace('nexus://', '').split('/')[0]
      if (targetPageId) selectPage(targetPageId)
    }
    container.addEventListener('click', onClick)
    return () => container.removeEventListener('click', onClick)
  }, [selectPage])

  // Load blocks from DB when pageId changes
  useEffect(() => {
    isMountedRef.current = true
    currentPageId.current = pageId
    initialContentLoaded.current = false

    async function load() {
      const blocks = await window.api.blocks.getByPageId(pageId)

      // Guard against stale loads if page switched during await
      if (currentPageId.current !== pageId) return

      if (blocks.length === 0) {
        const fallback = [{ type: 'paragraph', content: '' } as never]
        editor.replaceBlocks(editor.document, fallback)
        lastSavedBlocksSnapshot.current = ''
        initialContentLoaded.current = true
        return
      }

      const sorted = [...blocks].sort((a, b) => a.sort_order - b.sort_order)
      const parsedBlocks = sorted
        .map((b) => {
          try {
            return b.content ? JSON.parse(b.content) : null
          } catch {
            return null
          }
        })
        .filter(Boolean)

      // Toggle state is ephemeral — always start expanded on load.
      resetToggles(parsedBlocks)

      editor.replaceBlocks(
        editor.document,
        (parsedBlocks.length ? parsedBlocks : [{ type: 'paragraph', content: '' }]) as never,
      )

      lastSavedBlocksSnapshot.current = JSON.stringify(sorted.map((b) => b.content ?? ''))
      initialContentLoaded.current = true
    }

    load()

    return () => {
      isMountedRef.current = false
    }
  }, [pageId, editor])

  // Persist blocks to DB — skips if snapshot unchanged. Also syncs links.
  const persistBlocks = useCallback(
    async (nexusBlocks: NexusBlock[], editorBlocks: unknown[]) => {
      const nextSnapshot = JSON.stringify(nexusBlocks.map((b) => b.content))
      if (nextSnapshot === lastSavedBlocksSnapshot.current) return

      await window.api.blocks.save(currentPageId.current, nexusBlocks)

      // Sync bidirectional links from pageMention inline content
      const linkTargets = extractLinkTargets(editorBlocks)
      await window.api.links.syncLinks(currentPageId.current, linkTargets)

      lastSavedBlocksSnapshot.current = nextSnapshot
      setSaveStatus('saved')
      setTimeout(() => {
        if (isMountedRef.current) setSaveStatus('idle')
      }, 1200)
    },
    [setSaveStatus],
  )

  // Debounced block save
  const debouncedSave = useDebounce(
    useCallback(
      async (editorBlocks: unknown[]) => {
        if (!initialContentLoaded.current) return
        setSaveStatus('saving')

        const nexusBlocks: NexusBlock[] = (editorBlocks as Array<{ id?: string; type?: string }>).map(
          (block, index) => ({
            id: block.id || uuidv4(),
            page_id: currentPageId.current,
            parent_block_id: null,
            block_type: (block.type as NexusBlock['block_type']) || 'paragraph',
            content: JSON.stringify(block),
            sort_order: index,
            created_at: '',
            updated_at: '',
          }),
        )

        try {
          await persistBlocks(nexusBlocks, editorBlocks)
        } catch {
          setSaveStatus('idle')
        }
      },
      [persistBlocks, setSaveStatus],
    ),
    500,
  )

  // Debounced title save
  const debouncedTitleSave = useDebounce(
    useCallback(
      async (title: string) => {
        setSaveStatus('saving')
        try {
          await updatePage(currentPageId.current, { title })
          setSaveStatus('saved')
          setTimeout(() => {
            if (isMountedRef.current) setSaveStatus('idle')
          }, 1200)
        } catch {
          setSaveStatus('idle')
        }
      },
      [setSaveStatus, updatePage],
    ),
    500,
  )

  // Title change handler with auto-resize
  const onTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const el = e.target
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
      debouncedTitleSave.call(el.value)
    },
    [debouncedTitleSave],
  )

  // Sync title textarea when page loads or changes
  useEffect(() => {
    if (!titleRef.current) return
    titleRef.current.value = currentPage?.title || ''
    titleRef.current.style.height = 'auto'
    titleRef.current.style.height = titleRef.current.scrollHeight + 'px'
  }, [pageId, currentPage?.title])

  // Flush all pending saves on unload / page switch
  useEffect(() => {
    const onBeforeUnload = () => {
      debouncedSave.flush()
      debouncedTitleSave.flush()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [debouncedSave, debouncedTitleSave])

  // Deselect blocks when page changes
  useEffect(() => {
    deselectAllBlocks()
  }, [pageId, deselectAllBlocks])

  // Apply highlight CSS to selected blocks
  useEffect(() => {
    if (!editorContainerRef.current) return
    const blocks = editorContainerRef.current.querySelectorAll('[data-node-type="blockContainer"]')
    const selectedSet = new Set(selectedBlockIds)
    blocks.forEach((el) => {
      const id = el.getAttribute('data-id')
      if (id && selectedSet.has(id)) {
        el.classList.add('nx-block-selected')
      } else {
        el.classList.remove('nx-block-selected')
      }
    })
  }, [selectedBlockIds])

  // Multi-select keyboard shortcuts
  useEffect(() => {
    if (selectedBlockIds.length === 0) return

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey

      // Backspace / Delete → delete selected blocks
      if ((e.key === 'Backspace' || e.key === 'Delete') && !mod) {
        e.preventDefault()
        editor.removeBlocks(selectedBlockIds)
        deselectAllBlocks()
        return
      }

      // Cmd+C → copy selected blocks
      if (mod && (e.key === 'c' || e.key === 'C') && !e.shiftKey) {
        e.preventDefault()
        const texts: string[] = []
        for (const bid of selectedBlockIds) {
          const block = editor.getBlock(bid) as { content?: unknown } | undefined
          if (block?.content && Array.isArray(block.content)) {
            const text = block.content
              .map((c: unknown) => {
                if (typeof c === 'string') return c
                if (c && typeof c === 'object' && 'text' in c) return String((c as { text: string }).text)
                return ''
              })
              .join('')
            texts.push(text)
          }
        }
        void navigator.clipboard.writeText(texts.join('\n'))
        return
      }

      // Cmd+X → cut selected blocks
      if (mod && (e.key === 'x' || e.key === 'X') && !e.shiftKey) {
        e.preventDefault()
        const texts: string[] = []
        for (const bid of selectedBlockIds) {
          const block = editor.getBlock(bid) as { content?: unknown } | undefined
          if (block?.content && Array.isArray(block.content)) {
            const text = block.content
              .map((c: unknown) => {
                if (typeof c === 'string') return c
                if (c && typeof c === 'object' && 'text' in c) return String((c as { text: string }).text)
                return ''
              })
              .join('')
            texts.push(text)
          }
        }
        void navigator.clipboard.writeText(texts.join('\n'))
        editor.removeBlocks(selectedBlockIds)
        deselectAllBlocks()
        return
      }

      // Cmd+D → duplicate selected blocks
      if (mod && (e.key === 'd' || e.key === 'D') && !e.shiftKey) {
        e.preventDefault()
        const lastId = selectedBlockIds[selectedBlockIds.length - 1]
        const clones = selectedBlockIds
          .map((bid) => {
            const block = editor.getBlock(bid) as { type: string; props: Record<string, unknown>; content?: unknown } | undefined
            if (!block) return null
            return { type: block.type, props: { ...block.props }, content: block.content }
          })
          .filter(Boolean) as Parameters<typeof editor.insertBlocks>[0]
        if (clones.length > 0) {
          editor.insertBlocks(clones as never, lastId, 'after')
        }
        return
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedBlockIds, editor, deselectAllBlocks])

  // Cmd+A to select all blocks (when no text cursor is active)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.key !== 'a' || e.shiftKey) return

      // Only select all if focus is not in editable content
      const active = document.activeElement
      const inEditable =
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA')
      if (inEditable) return

      e.preventDefault()
      if (!editorContainerRef.current) return
      const blockEls = editorContainerRef.current.querySelectorAll('[data-node-type="blockContainer"]')
      const ids: string[] = []
      blockEls.forEach((el) => {
        const id = el.getAttribute('data-id')
        if (id) ids.push(id)
      })
      selectBlocks(ids)
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectBlocks])

  // Clicking inside editable content should deselect blocks
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (selectedBlockIds.length === 0) return
      const target = e.target as HTMLElement
      if (
        target.isContentEditable ||
        target.closest('[contenteditable]') ||
        target.closest('.bn-inline-content')
      ) {
        deselectAllBlocks()
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [selectedBlockIds, deselectAllBlocks])

  // Editor-scoped keyboard shortcuts:
  //   Cmd+D              → duplicate current block
  //   Cmd+Shift+Backspace → delete current block
  //   Cmd+Shift+H         → highlight selected text (default: yellow)
  //   Cmd+Shift+T         → toggle expand/collapse on focused toggle block
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return

      const getFocusedBlock = () => {
        const pos = editor.getTextCursorPosition()
        return pos?.block as
          | { id: string; type: string; props: Record<string, unknown>; content?: unknown }
          | undefined
      }

      // Cmd+D — duplicate
      if (!e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        const block = getFocusedBlock()
        if (!block) return
        e.preventDefault()
        editor.insertBlocks(
          [
            {
              type: block.type,
              props: { ...block.props },
              content: block.content,
            } as never,
          ],
          block.id,
          'after',
        )
        return
      }

      // Cmd+Shift+Backspace — delete current block
      if (e.shiftKey && (e.key === 'Backspace' || e.key === 'Delete')) {
        const block = getFocusedBlock()
        if (!block) return
        e.preventDefault()
        editor.removeBlocks([block.id])
        return
      }

      // Cmd+Shift+H — highlight (default: yellow)
      if (e.shiftKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault()
        const current = (editor.getActiveStyles() as { backgroundColor?: string })
          .backgroundColor
        if (current === 'yellow') {
          editor.removeStyles({ backgroundColor: '' } as never)
        } else {
          editor.addStyles({ backgroundColor: 'yellow' } as never)
        }
        return
      }

      // Cmd+Shift+T — toggle expand/collapse the focused toggle block
      if (e.shiftKey && (e.key === 't' || e.key === 'T')) {
        const block = getFocusedBlock()
        if (!block || block.type !== 'toggle') return
        e.preventDefault()
        const open = (block.props as { open?: boolean }).open !== false
        editor.updateBlock(block.id, {
          type: 'toggle',
          props: { open: !open },
        } as never)
        return
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editor])

  // Right-click → block context menu
  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const container = target.closest('[data-node-type="blockContainer"]') as HTMLElement | null
      if (!container) return
      const blockId = container.getAttribute('data-id')
      if (!blockId) return
      const block = editor.getBlock(blockId)
      if (!block) return
      e.preventDefault()
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        block: block as unknown as ContextMenuState extends { block: infer B } ? B : never,
      })
    },
    [editor],
  )

  return (
    <div ref={scrollContainerRef} className="h-full overflow-y-auto relative editor-scroll" style={isLassoActive ? { userSelect: 'none' } : undefined}>
      <div
        className="mx-auto px-8 pt-6 pb-32"
        style={{ maxWidth: maxWidthStyle, transition: 'max-width 200ms ease-out' }}
      >
        {/* Page title row with width toggle */}
        <div className="flex items-start gap-2">
          <textarea
            ref={titleRef}
            defaultValue={currentPage?.title || ''}
            onChange={onTitleChange}
            placeholder="Untitled"
            rows={1}
            className="nx-page-title flex-1 bg-transparent text-[2rem] font-bold leading-[1.15] tracking-[-0.02em] text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-tertiary)] resize-none outline-none border-none mb-3 overflow-hidden"
          />

          {/* Width slider toggle */}
          <div className="relative shrink-0 mt-2">
            <button
              onClick={() => setWidthSliderOpen((v) => !v)}
              title={displayWidthPx === 0 ? 'Page width: Full' : `Page width: ${displayWidthPx}px`}
              className={`flex items-center justify-center w-7 h-7 rounded-[var(--nx-radius-sm)] transition-all duration-100 active:scale-95 ${widthSliderOpen ? 'text-[var(--nx-accent)] bg-[var(--nx-accent-dim)]' : 'text-[var(--nx-text-tertiary)] hover:text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-hover)]'}`}
            >
              {WIDTH_ICON}
            </button>
            {widthSliderOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setWidthSliderOpen(false)} />
                <div className="absolute right-0 top-8 z-50 w-[220px] bg-[var(--nx-bg-elevated)] border border-[var(--nx-border-subtle)] rounded-[var(--nx-radius-md)] p-3 animate-fade-in" style={{ boxShadow: 'var(--nx-shadow-md)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] text-[var(--nx-text-tertiary)] uppercase tracking-wide">Page width</span>
                    <span className="text-[12px] font-medium text-[var(--nx-accent)] tabular-nums">
                      {displayWidthPx === 0 ? 'Full' : `${displayWidthPx}px`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={WIDTH_MIN}
                    max={WIDTH_MAX}
                    step={10}
                    value={displayWidthPx === 0 ? WIDTH_MAX : displayWidthPx}
                    onChange={(e) => {
                      setLocalWidthPx(parseInt(e.target.value, 10))
                    }}
                    onMouseUp={(e) => {
                      const v = parseInt((e.target as HTMLInputElement).value, 10)
                      setLocalWidthPx(v)
                      handleWidthChange(v)
                    }}
                    className="nx-width-slider w-full"
                  />
                  <div className="flex justify-between mt-1.5">
                    <span className="text-[10px] text-[var(--nx-text-tertiary)]">{WIDTH_MIN}px</span>
                    <button
                      onClick={() => { setLocalWidthPx(0); handleWidthChange(0) }}
                      className={`text-[10px] px-1.5 py-0.5 rounded transition-colors duration-75 ${displayWidthPx === 0 ? 'text-[var(--nx-accent)] bg-[var(--nx-accent-dim)]' : 'text-[var(--nx-text-tertiary)] hover:text-[var(--nx-text-secondary)]'}`}
                    >
                      Full
                    </button>
                    <span className="text-[10px] text-[var(--nx-text-tertiary)]">{WIDTH_MAX}px</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Block editor */}
        <div ref={editorContainerRef} onContextMenu={onContextMenu} className="relative">
          <BlockNoteView
            editor={editor as never}
            theme="dark"
            formattingToolbar={false}
            slashMenu={false}
            onChange={() => {
              if (initialContentLoaded.current) {
                debouncedSave.call(editor.document as unknown as unknown[])
              }
            }}
          >
            <FormattingToolbarController
              formattingToolbar={() => <CustomFormattingToolbar />}
            />
            <SuggestionMenuController
              triggerCharacter="/"
              suggestionMenuComponent={SlashMenu}
              getItems={async (query) =>
                filterSuggestionItems(getNexusSlashMenuItems(editor), query)
              }
            />

            {/* [[ page link suggestion menu */}
            <SuggestionMenuController
              triggerCharacter="["
              minQueryLength={1}
              suggestionMenuComponent={LinkMenu}
              getItems={linkMenuGetItems}
              onItemClick={(item: LinkMenuItem) => {
                item.onItemClick(editor)
              }}
            />
          </BlockNoteView>
        </div>

      </div>

      <LassoSelect scrollContainerRef={scrollContainerRef} editorContainerRef={editorContainerRef} />

      {contextMenu ? (
        <BlockContextMenu
          editor={editor}
          block={contextMenu.block}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          selectedBlockIds={selectedBlockIds}
        />
      ) : null}
    </div>
  )
}
