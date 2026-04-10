import React, { useEffect, useCallback, useRef, useState } from 'react'
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
import type { Block as NexusBlock } from '../../shared/types'
import { v4 as uuidv4 } from 'uuid'
import { nexusSchema, type NexusEditor } from '../blocks/schema'
import { getNexusSlashMenuItems } from '../blocks/slash-items'
import { SlashMenu } from './SlashMenu'
import { CustomFormattingToolbar } from './FormattingToolbar'
import { BlockContextMenu } from './BlockContextMenu'

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
  const { setSaveStatus, updatePage, currentPage } = useAppStore()
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const initialContentLoaded = useRef(false)
  const currentPageId = useRef(pageId)
  const lastSavedBlocksSnapshot = useRef<string>('')
  const isMountedRef = useRef(true)

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)

  const editor = useCreateBlockNote({
    schema: nexusSchema,
    dropCursor: multiColumnDropCursor,
    domAttributes: { editor: { class: 'nx-editor-root' } },
  }) as unknown as NexusEditor

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

  // Persist blocks to DB — skips if snapshot unchanged
  const persistBlocks = useCallback(
    async (nexusBlocks: NexusBlock[]) => {
      const nextSnapshot = JSON.stringify(nexusBlocks.map((b) => b.content))
      if (nextSnapshot === lastSavedBlocksSnapshot.current) return

      await window.api.blocks.save(currentPageId.current, nexusBlocks)
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
          await persistBlocks(nexusBlocks)
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
    <div className="h-full overflow-y-auto editor-scroll">
      <div className="mx-auto px-8 pt-6 pb-32" style={{ maxWidth: '720px' }}>
        {/* Page title */}
        <textarea
          ref={titleRef}
          defaultValue={currentPage?.title || ''}
          onChange={onTitleChange}
          placeholder="Untitled"
          rows={1}
          className="nx-page-title w-full bg-transparent text-[2rem] font-bold leading-[1.15] tracking-[-0.02em] text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-tertiary)] resize-none outline-none border-none mb-3 overflow-hidden"
        />

        {/* Block editor */}
        <div onContextMenu={onContextMenu}>
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
          </BlockNoteView>
        </div>
      </div>

      {contextMenu ? (
        <BlockContextMenu
          editor={editor}
          block={contextMenu.block}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  )
}
