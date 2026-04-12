import React, { useState, useRef, useEffect } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { COLORS, COLOR_KEYS, type ColorKey } from './callout-colors'
import { PageIcon, CALLOUT_ICON_KEYS, type PageIconKey } from './icons'

// Callout block: a tinted rounded box with an SVG icon + editable inline header.
// Nested child blocks render below the header automatically (sibling blockGroup).
//
// props.icon — icon key from PageIconKey. Default 'bulb'.
//              Legacy emoji values fall back to 'bulb' via PageIcon component.
// props.color — one of the keys in callout-colors.ts. Default 'blue'.

export const calloutBlock = createReactBlockSpec(
  {
    type: 'callout',
    content: 'inline',
    propSchema: {
      icon: { default: 'bulb' },
      color: { default: 'blue' },
    },
  },
  {
    render: ({ block, editor, contentRef }) => {
      const colorKey = (COLOR_KEYS.includes(block.props.color as ColorKey)
        ? block.props.color
        : 'blue') as ColorKey
      const token = COLORS[colorKey]
      const icon = block.props.icon || 'bulb'

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

      const pickIcon = (next: PageIconKey) => {
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
              <PageIcon iconKey={icon} size={16} />
            </button>
            {pickerOpen ? (
              <div ref={pickerRef} className="nx-callout__picker">
                {CALLOUT_ICON_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`nx-callout__picker-item ${icon === key ? 'is-active' : ''}`}
                    title={key}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickIcon(key)}
                  >
                    <PageIcon iconKey={key} size={15} />
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
