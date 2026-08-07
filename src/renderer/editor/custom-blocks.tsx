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
    render: ({ block, editor, contentRef }) => {
      const open = block.props.open !== false
      const toggle = () => editor.updateBlock(block, { type: 'toggle', props: { open: !open } })

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
              <path
                d="M4 3l4 3-4 3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div className="nx-toggle__summary" ref={contentRef} />
        </div>
      )
    }
  }
)

const CALLOUT_COLORS = {
  amber: 'var(--nx-accent)',
  success: 'var(--nx-success)',
  info: 'var(--nx-info)',
  critical: 'var(--nx-critical)'
} as const

export type CalloutColor = keyof typeof CALLOUT_COLORS

/** Callout: tinted panel with a colored left rule + geometric marker, no icon picker. */
export const calloutBlock = createReactBlockSpec(
  {
    type: 'callout',
    content: 'inline',
    propSchema: {
      color: { default: 'amber' }
    }
  },
  {
    render: ({ block, contentRef }) => {
      const colorKey = (block.props.color in CALLOUT_COLORS ? block.props.color : 'amber') as CalloutColor
      const color = CALLOUT_COLORS[colorKey]

      return (
        <div className="nx-callout" style={{ borderColor: color }}>
          <Icon shape="diamond" filled size={12} color={color} className="nx-callout__marker" />
          <div ref={contentRef} className="nx-callout__content" />
        </div>
      )
    }
  }
)
