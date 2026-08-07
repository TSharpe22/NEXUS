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

function PageMentionChip({ pageId, pageTitle }: { pageId: string; pageTitle: string }) {
  const setActivePageId = useAppStore((s) => s.setActivePageId)
  const setActiveView = useAppStore((s) => s.setActiveView)

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setActiveView('vault')
    setActivePageId(pageId)
  }

  return (
    <span
      className="nx-page-mention"
      onClick={handleClick}
      role="link"
      tabIndex={0}
      contentEditable={false}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleClick(e as unknown as React.MouseEvent)
      }}
    >
      <Icon shape="diamond" size={10} color="var(--nx-accent)" />
      {pageTitle || 'Untitled'}
    </span>
  )
}
