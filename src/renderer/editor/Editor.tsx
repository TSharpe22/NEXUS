import { useMemo, useState } from 'react'
import { useCreateBlockNote, SuggestionMenuController } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/ariakit'
import type { Page } from '@shared/types'
import { nexusSchema } from './schema'
import { useDebounce } from '../hooks/use-debounce'
import { getLinkMenuItems, LinkMenu, extractLinkTargets } from './link-menu'
import './Editor.css'

interface EditorProps {
  page: Page
  onTitleChange: (title: string) => void
  onSaveStatusChange?: (status: 'idle' | 'saving' | 'saved') => void
}

function parseInitialContent(content: string) {
  try {
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Keyed by page.id in Vault.tsx so a fresh editor instance mounts per page —
 * simpler than trying to imperatively swap BlockNote's document in place.
 */
export function Editor({ page, onTitleChange, onSaveStatusChange }: EditorProps) {
  const [title, setTitle] = useState(page.title)

  const editor = useCreateBlockNote({
    schema: nexusSchema,
    initialContent: parseInitialContent(page.content)
  })

  const saveContent = useDebounce(async () => {
    onSaveStatusChange?.('saving')
    await window.api.pages.update(page.id, { content: JSON.stringify(editor.document) })
    await window.api.links.syncLinks(page.id, extractLinkTargets(editor.document))
    onSaveStatusChange?.('saved')
  }, 800)

  const saveTitle = useDebounce(async (next: string) => {
    onSaveStatusChange?.('saving')
    await window.api.pages.update(page.id, { title: next })
    onSaveStatusChange?.('saved')
    onTitleChange(next)
  }, 500)

  const placeholder = useMemo(() => 'Untitled', [])

  const handleLinkSelect = async (target: Page | null, title: string) => {
    let targetPage = target
    if (!targetPage) {
      targetPage = await window.api.pages.create()
      await window.api.pages.update(targetPage.id, { title })
    }
    editor.insertInlineContent([
      { type: 'pageMention', props: { pageId: targetPage.id, pageTitle: targetPage.title || title } } as never,
      ' '
    ])
  }

  return (
    <div>
      <textarea
        className="nx-editor-title"
        rows={1}
        value={title}
        placeholder={placeholder}
        onChange={(e) => {
          setTitle(e.target.value)
          saveTitle.call(e.target.value)
        }}
      />
      <BlockNoteView editor={editor} theme="dark" onChange={() => saveContent.call()}>
        <SuggestionMenuController
          triggerCharacter="["
          getItems={getLinkMenuItems(handleLinkSelect)}
          suggestionMenuComponent={LinkMenu}
          onItemClick={(item) => item.onItemClick()}
        />
      </BlockNoteView>
    </div>
  )
}
