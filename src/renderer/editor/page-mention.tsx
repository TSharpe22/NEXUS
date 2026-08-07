import { createReactInlineContentSpec } from '@blocknote/react'
import { useAppStore } from '../store/app-store'
import { Icon } from '../design/Icon'

export const pageMention = createReactInlineContentSpec(
  {
    type: 'pageMention' as const,
    propSchema: {
      pageId: { default: '' },
      pageTitle: { default: '' }
    },
    content: 'none'
  },
  {
    render: (props) => {
      const { pageId, pageTitle } = props.inlineContent.props
      return <PageMentionChip pageId={pageId} pageTitle={pageTitle} />
    }
  }
)

/**
 * `pageTitle` in the block props is a snapshot from the moment the mention was
 * inserted — renaming the target used to leave every chip pointing at it
 * showing the old name. The store is the source of truth; the stored prop is
 * only a fallback for a page that no longer exists at all.
 */
function PageMentionChip({ pageId, pageTitle }: { pageId: string; pageTitle: string }) {
  const openPage = useAppStore((s) => s.openPage)
  const live = useAppStore((s) => s.pages.find((p) => p.id === pageId))
  const trashed = useAppStore((s) => s.trashed.find((p) => p.id === pageId))

  const target = live ?? trashed ?? null
  const label = target ? target.title || 'Untitled' : pageTitle || 'Untitled'

  // Three states: a live page (clickable), a page sitting in the trash
  // (clickable, struck through), and a page deleted for good (inert).
  const state = live ? 'live' : trashed ? 'trashed' : 'missing'

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (state === 'missing') return
    openPage(pageId)
  }

  const className = [
    'nx-page-mention',
    state === 'trashed' && 'nx-page-mention--trashed',
    state === 'missing' && 'nx-page-mention--deleted'
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      className={className}
      onClick={handleClick}
      role={state === 'missing' ? undefined : 'link'}
      tabIndex={state === 'missing' ? undefined : 0}
      contentEditable={false}
      title={
        state === 'trashed'
          ? `${label} — in trash`
          : state === 'missing'
            ? `${label} — page no longer exists`
            : label
      }
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleClick(e as unknown as React.MouseEvent)
      }}
    >
      <Icon
        shape="diamond"
        size={10}
        color={state === 'live' ? 'var(--nx-accent)' : 'var(--nx-text-dim)'}
      />
      {label}
    </span>
  )
}
