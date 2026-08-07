import { createReactBlockSpec } from '@blocknote/react'
import { Icon } from '../design/Icon'

/**
 * Toggle: collapsible container. `open` is ephemeral UI state (not meant to
 * persist meaningfully across sessions) but lives in block.props because
 * BlockNote has nowhere else to put per-block state.
 */
export const toggleBlock = createReactBlockSpec(
  {
    type: 'toggle',
    content: 'inline',
    propSchema: {
      open: { default: true }
    }
  },
  {
    render: ({ block, editor, contentRef }) => (
      <ToggleBlock block={block} editor={editor} contentRef={contentRef} />
    )
  }
)

function ToggleBlock({
  block,
  editor,
  contentRef
}: {
  block: { props: { open?: boolean }; type?: string }
  // Loosely typed on purpose: BlockNote's editor generic is bound to a schema
  // containing only this block, which doesn't match the app-wide schema.
  editor: { updateBlock: (block: never, update: never) => unknown }
  contentRef: (element: HTMLElement | null) => void
}) {
  const open = block.props.open !== false
  const toggle = () => editor.updateBlock(block as never, { type: 'toggle', props: { open: !open } } as never)

  return (
    <div className="nx-toggle" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        className="nx-toggle__chevron"
        aria-label={open ? 'Collapse' : 'Expand'}
        aria-expanded={open}
        contentEditable={false}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M4 3l4 3-4 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="nx-toggle__summary" ref={contentRef} />
    </div>
  )
}

const CALLOUT_COLORS = {
  amber: ['var(--nx-accent)', 'var(--nx-accent-tint)'],
  success: ['var(--nx-success)', 'rgba(127, 174, 122, 0.12)'],
  info: ['var(--nx-info)', 'rgba(126, 163, 201, 0.12)'],
  critical: ['var(--nx-critical)', 'var(--nx-critical-tint)']
} as const

export type CalloutColor = keyof typeof CALLOUT_COLORS

/** Callout: tinted panel with a coloured left rule + geometric marker, no icon picker. */
export const calloutBlock = createReactBlockSpec(
  {
    type: 'callout',
    content: 'inline',
    propSchema: {
      color: { default: 'amber' }
    }
  },
  {
    render: ({ block, contentRef }) => <CalloutBlock block={block} contentRef={contentRef} />
  }
)

function CalloutBlock({
  block,
  contentRef
}: {
  block: { props: { color?: string } }
  contentRef: (element: HTMLElement | null) => void
}) {
  const colorKey = (
    block.props.color && block.props.color in CALLOUT_COLORS ? block.props.color : 'amber'
  ) as CalloutColor
  const [color, tint] = CALLOUT_COLORS[colorKey]

  return (
    <div className="nx-callout" style={{ borderColor: color, background: tint }}>
      {/* contentEditable={false} keeps the marker out of the editable flow, so
          the caret can't be placed on it and Backspace can't delete it. */}
      <span className="nx-callout__marker" contentEditable={false}>
        <Icon shape="diamond" filled size={12} color={color} />
      </span>
      <div ref={contentRef} className="nx-callout__content" />
    </div>
  )
}
