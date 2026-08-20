import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useCreateBlockNote, SuggestionMenuController } from '@blocknote/react'
import { filterSuggestionItems } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/ariakit'
import type { Page } from '@shared/types'
import { nexusSchema } from './schema'
import { getSlashMenuItems } from './slash-items'
import { useAppStore } from '../store/app-store'
import { useDebounce } from '../hooks/use-debounce'
import { registerPendingWrite } from '../pending-writes'
import { getLinkMenuItems, LinkMenu } from './link-menu'
import { TagBar } from './TagBar'
import './Editor.css'

interface EditorProps {
  page: Page
  /**
   * Rendered between the tag chips and the document body. A typed page's
   * properties belong above what you scroll through, not under it — but the
   * title and tags live in here, so the slot has to as well.
   */
  children?: ReactNode
}

function parseInitialContent(content: string) {
  try {
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined
  } catch {
    // A document that won't parse is better replaced by an empty one than
    // crashing the editor — the raw text is still in the database.
    console.error('[nexus] could not parse page content; starting from an empty document')
    return undefined
  }
}

/**
 * Keyed by page.id in Notes.tsx so a fresh editor instance mounts per page —
 * simpler than trying to imperatively swap BlockNote's document in place.
 */
export function Editor({ page, children }: EditorProps) {
  const [title, setTitle] = useState(page.title)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const editorRootRef = useRef<HTMLDivElement>(null)
  const setSaveStatus = useAppStore((s) => s.setSaveStatus)
  const patchPage = useAppStore((s) => s.patchPage)

  const editor = useCreateBlockNote({
    schema: nexusSchema,
    initialContent: parseInitialContent(page.content)
  })

  const saveContent = useDebounce(async () => {
    setSaveStatus('saving')
    try {
      const document = editor.document
      const serialised = JSON.stringify(document)
      await window.api.pages.update(page.id, { content: serialised })
      // The store's copy is what a remount reads back through `initialContent`.
      // Leaving it stale made an edit look like it reverted on reopening the
      // page — and the next keystroke then saved that stale document over the
      // good one. `saveTitle` below has always patched; this has to as well.
      patchPage(page.id, { content: serialised })
      setSaveStatus('saved')
    } catch (e) {
      // Surfacing this matters: silently swallowing it is what made the
      // schema mismatch look like "typing just doesn't save".
      console.error('[nexus] failed to save page content', e)
      setSaveStatus('error')
    }
  }, 600)

  const saveTitle = useDebounce(async (next: string) => {
    setSaveStatus('saving')
    try {
      await window.api.pages.update(page.id, { title: next })
      patchPage(page.id, { title: next })
      setSaveStatus('saved')
    } catch (e) {
      console.error('[nexus] failed to save page title', e)
      setSaveStatus('error')
    }
  }, 400)

  // The title is a textarea so long titles wrap instead of scrolling
  // sideways; it has to be resized by hand to match its content.
  const autoGrowTitle = useCallback(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useLayoutEffect(autoGrowTitle, [autoGrowTitle, title])

  /**
   * Quitting mid-debounce would otherwise drop the last edit.
   *
   * Registered rather than hung off `beforeunload`, because by the time that
   * fires the window is already going: the flush was issued, but nothing on
   * the main side was still waiting for it, and the database had been closed
   * out from under it. Main now holds the window open until this resolves.
   * Unmount is already covered by useDebounce's own cleanup.
   */
  useEffect(
    () => registerPendingWrite(() => Promise.all([saveContent.flush(), saveTitle.flush()])),
    [saveContent, saveTitle]
  )

  /**
   * Enter inside an open toggle puts the new block INSIDE it.
   *
   * Without this a toggle can only ever be an empty header: Enter produced a
   * sibling paragraph below it, so there was no way to put anything under the
   * chevron except by pressing Tab afterwards, which nothing tells you about.
   *
   * BlockNote's `insertBlocks` placement argument only accepts "before" and
   * "after" — there is no "nested". Getting a child means either inserting
   * relative to an existing child, or inserting a sibling and then calling
   * `nestBlock()`, which acts on whichever block holds the text cursor.
   */
  useEffect(() => {
    const root = editorRootRef.current
    if (!root) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return

      const block = editor.getTextCursorPosition()?.block as
        | { id?: string; type?: string; props?: { open?: boolean }; children?: unknown[] }
        | undefined
      if (!block?.id || block.type !== 'toggle') return
      // A closed toggle keeps the ordinary behaviour: Enter makes a sibling.
      if (block.props?.open === false) return

      e.preventDefault()
      e.stopPropagation()

      const firstChild = (Array.isArray(block.children) ? block.children[0] : undefined) as
        | { id?: string }
        | undefined

      if (firstChild?.id) {
        // Already has children — the new line goes to the top of the group,
        // which is where Notion puts it too.
        const inserted = editor.insertBlocks([{ type: 'paragraph' } as never], firstChild.id, 'before')
        const created = Array.isArray(inserted) ? inserted[0] : inserted
        if (created) editor.setTextCursorPosition(created as never, 'start')
        return
      }

      const inserted = editor.insertBlocks([{ type: 'paragraph' } as never], block.id, 'after')
      const created = Array.isArray(inserted) ? inserted[0] : inserted
      if (!created) return
      editor.setTextCursorPosition(created as never, 'start')
      if (editor.canNestBlock()) editor.nestBlock()
    }

    // Capture, so this runs before BlockNote's own Enter handling.
    root.addEventListener('keydown', onKeyDown, true)
    return () => root.removeEventListener('keydown', onKeyDown, true)
  }, [editor])

  const handleLinkSelect = async (target: Page | null, linkTitle: string) => {
    let targetPage = target
    if (!targetPage) {
      targetPage = await window.api.pages.create()
      await window.api.pages.update(targetPage.id, { title: linkTitle })
      // Pull the new page into the store so its chip resolves and it shows up
      // in the sidebar without needing a view switch.
      await useAppStore.getState().refresh()
    }
    editor.insertInlineContent([
      { type: 'pageMention', props: { pageId: targetPage.id, pageTitle: targetPage.title || linkTitle } } as never,
      ' '
    ])
  }

  return (
    <div className="nx-editor" ref={editorRootRef}>
      <textarea
        ref={titleRef}
        className="nx-editor__title"
        rows={1}
        value={title}
        placeholder="Untitled"
        spellCheck={false}
        onChange={(e) => {
          setTitle(e.target.value)
          saveTitle.call(e.target.value)
        }}
        onKeyDown={(e) => {
          // Enter in the title should move into the body, not add a newline.
          if (e.key === 'Enter') {
            e.preventDefault()
            editor.focus()
          }
        }}
      />

      <TagBar pageId={page.id} />

      {children}

      <BlockNoteView
        editor={editor}
        theme="dark"
        slashMenu={false}
        onChange={() => saveContent.call()}
      >
        {/* Replaces the default "/" menu so toggle and callout are reachable. */}
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query) => filterSuggestionItems(getSlashMenuItems(editor), query)}
        />
        <SuggestionMenuController
          triggerCharacter="["
          getItems={getLinkMenuItems(handleLinkSelect, page.id)}
          suggestionMenuComponent={LinkMenu}
          onItemClick={(item) => item.onItemClick()}
        />
      </BlockNoteView>
    </div>
  )
}
