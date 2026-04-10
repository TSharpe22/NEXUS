import { useState, useRef, useEffect } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { COLORS, COLOR_KEYS, type ColorKey } from './callout-colors'

// Callout block: a tinted rounded box with an emoji + editable inline header.
// Nested child blocks render below the header automatically (sibling blockGroup).
//
// props.icon — the emoji shown on the left. Default 💡.
// props.color — one of the keys in callout-colors.ts. Default 'blue'.
//
// The color token drives three CSS custom properties (set inline) so the
// surrounding globals.css rules can reference them without hard-coding
// per-color selectors.

const PRESET_ICONS = ['💡', '📝', '⚠️', '✅', '❌', '🔥', '⭐', '📌']

export const calloutBlock = createReactBlockSpec(
  {
    type: 'callout',
    content: 'inline',
    propSchema: {
      icon: { default: '💡' },
      color: { default: 'blue' },
    },
  },
  {
    render: ({ block, editor, contentRef }) => {
      const colorKey = (COLOR_KEYS.includes(block.props.color as ColorKey)
        ? block.props.color
        : 'blue') as ColorKey
      const token = COLORS[colorKey]
      const icon = block.props.icon || '💡'

      const [pickerOpen, setPickerOpen] = useState(false)
      const pickerRef = useRef<HTMLDivElement | null>(null)

      useEffect(() => {
        if (!pickerOpen) return
        const onDown = (e: MouseEvent) => {
          if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
            setPickerOpen(false)
          }
        }
        window.addEventListener('mousedown', onDown)
        return () => window.removeEventListener('mousedown', onDown)
      }, [pickerOpen])

      const pickIcon = (next: string) => {
        editor.updateBlock(block, {
          type: 'callout',
          props: { ...block.props, icon: next },
        })
        setPickerOpen(false)
      }

      return (
        <div
          className="nx-callout"
          data-color={colorKey}
          style={
            {
              ['--nx-callout-bg' as string]: token.bg,
              ['--nx-callout-border' as string]: token.border,
              ['--nx-callout-text' as string]: token.text,
            } as React.CSSProperties
          }
        >
          <div className="nx-callout__icon-wrap" contentEditable={false}>
            <button
              type="button"
              className="nx-callout__icon"
              aria-label="Change icon"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setPickerOpen((v) => !v)}
            >
              <span role="img" aria-label="callout icon">
                {icon}
              </span>
            </button>
            {pickerOpen ? (
              <div ref={pickerRef} className="nx-callout__picker">
                {PRESET_ICONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="nx-callout__picker-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickIcon(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="nx-callout__body" ref={contentRef} />
        </div>
      )
    },
  },
)
