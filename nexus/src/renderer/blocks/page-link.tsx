import { createReactInlineContentSpec } from '@blocknote/react'
import { useAppStore } from '../stores/app-store'

export const pageMention = createReactInlineContentSpec(
  {
    type: 'pageMention' as const,
    propSchema: {
      pageId: { default: '' },
      pageTitle: { default: '' },
      pageIcon: { default: '' },
    },
    content: 'none',
  },
  {
    render: (props) => {
      const { pageId, pageTitle, pageIcon } = props.inlineContent.props
      return (
        <PageMentionChip
          pageId={pageId}
          pageTitle={pageTitle}
          pageIcon={pageIcon}
        />
      )
    },
  },
)

function PageMentionChip({
  pageId,
  pageTitle,
  pageIcon,
}: {
  pageId: string
  pageTitle: string
  pageIcon: string
}) {
  const selectPage = useAppStore((s) => s.selectPage)
  const pages = useAppStore((s) => s.pages)
  const deletedPages = useAppStore((s) => s.deletedPages)

  // Check if target page still exists
  const activePage = pages.find((p) => p.id === pageId)
  const trashedPage = deletedPages.find((p) => p.id === pageId)

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (activePage) {
      selectPage(pageId)
    }
  }

  // Trashed page — strikethrough
  if (!activePage && trashedPage) {
    return (
      <span
        className="nx-page-mention nx-page-mention--trashed"
        title="This page is in trash"
      >
        <span className="nx-page-mention__icon">{pageIcon || '\u{1F4DD}'}</span>
        <span className="nx-page-mention__title">{pageTitle || 'Untitled'}</span>
      </span>
    )
  }

  // Permanently deleted page — plain text
  if (!activePage && !trashedPage) {
    return (
      <span
        className="nx-page-mention nx-page-mention--deleted"
        title="This page no longer exists"
      >
        {pageTitle || 'Untitled'}
      </span>
    )
  }

  // Active page — clickable chip
  const displayTitle = activePage?.title || pageTitle || 'Untitled'
  const displayIcon = activePage?.icon || pageIcon || '\u{1F4DD}'

  return (
    <span
      className="nx-page-mention"
      onClick={handleClick}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleClick(e as unknown as React.MouseEvent)
      }}
    >
      <span className="nx-page-mention__icon">{displayIcon}</span>
      <span className="nx-page-mention__title">{displayTitle}</span>
    </span>
  )
}
