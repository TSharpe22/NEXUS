import { useEffect, useRef, useState } from 'react'
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

/**
 * The `amber` key is stored inside saved callout blocks, so it keeps its name
 * even though the accent is no longer amber — it resolves to the warning token,
 * which is where that amber went. Renaming the key would orphan existing notes.
 */
const CALLOUT_COLORS = {
  amber: ['var(--nx-warning)', 'var(--nx-warning-tint)'],
  success: ['var(--nx-success)', 'rgba(105, 147, 101, 0.12)'],
  info: ['var(--nx-info)', 'rgba(126, 163, 201, 0.12)'],
  critical: ['var(--nx-critical)', 'var(--nx-critical-tint)']
} as const

export type CalloutColor = keyof typeof CALLOUT_COLORS

const COLOR_KEYS = Object.keys(CALLOUT_COLORS) as CalloutColor[]
const SHAPE_KEYS = ['diamond', 'square', 'circle'] as const
type CalloutShape = (typeof SHAPE_KEYS)[number]

/**
 * Callout: tinted panel with a coloured left rule and a marker.
 *
 * The marker is a shape + colour pair rather than an illustrative icon —
 * DESIGN.md restricts iconography to square/circle/diamond outlines. Three
 * shapes across four colours still gives twelve visually distinct callouts,
 * which is what the icon set was doing. Outline by default because filled is
 * reserved for the selected/active state.
 */
export const calloutBlock = createReactBlockSpec(
  {
    type: 'callout',
    content: 'inline',
    propSchema: {
      color: { default: 'amber' },
      shape: { default: 'diamond' }
    }
  },
  {
    render: ({ block, editor, contentRef }) => (
      <CalloutBlock block={block} editor={editor} contentRef={contentRef} />
    )
  }
)

function CalloutBlock({
  block,
  editor,
  contentRef
}: {
  block: { props: { color?: string; shape?: string } }
  editor: { updateBlock: (block: never, update: never) => unknown }
  contentRef: (element: HTMLElement | null) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement | null>(null)

  const colorKey = (
    block.props.color && block.props.color in CALLOUT_COLORS ? block.props.color : 'amber'
  ) as CalloutColor
  const shapeKey = (
    SHAPE_KEYS.includes(block.props.shape as CalloutShape) ? block.props.shape : 'diamond'
  ) as CalloutShape
  const [color, tint] = CALLOUT_COLORS[colorKey]

  useEffect(() => {
    if (!pickerOpen) return
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  const apply = (next: { color?: CalloutColor; shape?: CalloutShape }) =>
    editor.updateBlock(block as never, {
      type: 'callout',
      props: { color: colorKey, shape: shapeKey, ...next }
    } as never)

  return (
    <div className="nx-callout" style={{ borderColor: color, background: tint }}>
      {/* contentEditable={false} keeps the marker out of the editable flow, so
          the caret can't be placed on it and Backspace can't delete it. */}
      <span className="nx-callout__marker" contentEditable={false}>
        <button
          type="button"
          className="nx-callout__marker-btn"
          aria-label="Change callout marker"
          title="Change callout marker"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPickerOpen((v) => !v)}
        >
          <Icon shape={shapeKey} size={12} color={color} />
        </button>

        {pickerOpen && (
          <div className="nx-callout__picker" ref={pickerRef}>
            <div className="nx-callout__picker-row">
              {SHAPE_KEYS.map((shape) => (
                <button
                  key={shape}
                  type="button"
                  className={`nx-callout__picker-cell ${shape === shapeKey ? 'is-active' : ''}`}
                  title={shape}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => apply({ shape })}
                >
                  <Icon shape={shape} size={12} color={color} filled={shape === shapeKey} />
                </button>
              ))}
            </div>
            <div className="nx-callout__picker-row">
              {COLOR_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`nx-callout__picker-cell ${key === colorKey ? 'is-active' : ''}`}
                  title={key}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => apply({ color: key })}
                >
                  <Icon shape={shapeKey} size={12} color={CALLOUT_COLORS[key][0]} filled={key === colorKey} />
                </button>
              ))}
            </div>
          </div>
        )}
      </span>
      <div ref={contentRef} className="nx-callout__content" />
    </div>
  )
}
