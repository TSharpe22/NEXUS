import { useEffect, useState } from 'react'
import { useActiveStyles, useBlockNoteEditor } from '@blocknote/react'
import { COLORS, COLOR_KEYS, type ColorKey } from '../blocks/callout-colors'

// Custom floating formatting toolbar shown when text is selected. Built on
// BlockNote's <FormattingToolbarController> which positions this component
// above the selection — we only have to render the content.
//
// Styles (bold / italic / underline / strike / inline code / textColor /
// backgroundColor) are all BlockNote style marks. We read them via
// `useActiveStyles` and toggle them via `editor.addStyles` / `removeStyles`.

type StyleKey = 'bold' | 'italic' | 'underline' | 'strike' | 'code'

const basicStyles: { key: StyleKey; label: string; icon: JSX.Element; shortcut?: string }[] = [
  {
    key: 'bold',
    label: 'Bold',
    shortcut: '⌘B',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 4h7a4 4 0 014 4 4 4 0 01-4 4H7z" />
        <path d="M7 12h8a4 4 0 014 4 4 4 0 01-4 4H7z" />
      </svg>
    ),
  },
  {
    key: 'italic',
    label: 'Italic',
    shortcut: '⌘I',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="4" x2="10" y2="4" />
        <line x1="14" y1="20" x2="5" y2="20" />
        <line x1="15" y1="4" x2="9" y2="20" />
      </svg>
    ),
  },
  {
    key: 'underline',
    label: 'Underline',
    shortcut: '⌘U',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3v7a6 6 0 0012 0V3" />
        <line x1="4" y1="21" x2="20" y2="21" />
      </svg>
    ),
  },
  {
    key: 'strike',
    label: 'Strikethrough',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 4H9a3 3 0 00-2.83 4" />
        <path d="M14 12a4 4 0 010 8H6" />
        <line x1="4" y1="12" x2="20" y2="12" />
      </svg>
    ),
  },
  {
    key: 'code',
    label: 'Inline code',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
  },
]

export function CustomFormattingToolbar() {
  const editor = useBlockNoteEditor()
  const active = useActiveStyles(editor)

  const [colorPopover, setColorPopover] = useState<'text' | 'bg' | null>(null)

  // Close popover on outside click (clicks inside .nx-fmt-popover or
  // .nx-fmt-btn-wrap are treated as "inside").
  useEffect(() => {
    if (!colorPopover) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('.nx-fmt-popover') || target.closest('.nx-fmt-btn-wrap')) {
        return
      }
      setColorPopover(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [colorPopover])

  const toggle = (key: StyleKey) => {
    const isOn = Boolean((active as Record<string, unknown>)[key])
    if (isOn) {
      editor.removeStyles({ [key]: true } as never)
    } else {
      editor.addStyles({ [key]: true } as never)
    }
    editor.focus()
  }

  const setTextColor = (color: ColorKey | null) => {
    if (color === null) {
      editor.removeStyles({ textColor: '' } as never)
    } else {
      editor.addStyles({ textColor: color } as never)
    }
    setColorPopover(null)
    editor.focus()
  }

  const setHighlight = (color: ColorKey | null) => {
    if (color === null) {
      editor.removeStyles({ backgroundColor: '' } as never)
    } else {
      editor.addStyles({ backgroundColor: color } as never)
    }
    setColorPopover(null)
    editor.focus()
  }

  const createLink = () => {
    const url = window.prompt('Link URL')
    if (!url) return
    editor.createLink(url)
    editor.focus()
  }

  const activeText = (active as { textColor?: string }).textColor
  const activeBg = (active as { backgroundColor?: string }).backgroundColor

  return (
    <div className="nx-fmt-toolbar" onMouseDown={(e) => e.preventDefault()}>
      {basicStyles.map(({ key, label, icon, shortcut }) => {
        const isOn = Boolean((active as Record<string, unknown>)[key])
        return (
          <button
            key={key}
            type="button"
            className={`nx-fmt-btn ${isOn ? 'is-on' : ''}`}
            title={shortcut ? `${label} (${shortcut})` : label}
            onClick={() => toggle(key)}
          >
            {icon}
          </button>
        )
      })}

      <div className="nx-fmt-sep" />

      <div className="nx-fmt-btn-wrap">
        <button
          type="button"
          className={`nx-fmt-btn ${activeBg ? 'is-on' : ''}`}
          title="Highlight (⌘⇧H)"
          onClick={() => setColorPopover((p) => (p === 'bg' ? null : 'bg'))}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19l4 1 10-10-5-5L3 15z" />
            <path d="M14 5l5 5" />
            <line x1="3" y1="22" x2="21" y2="22" />
          </svg>
        </button>
        {colorPopover === 'bg' ? (
          <ColorPopover
            label="Highlight"
            active={activeBg}
            onPick={setHighlight}
            onClear={() => setHighlight(null)}
          />
        ) : null}
      </div>

      <div className="nx-fmt-btn-wrap">
        <button
          type="button"
          className={`nx-fmt-btn ${activeText ? 'is-on' : ''}`}
          title="Text color"
          onClick={() => setColorPopover((p) => (p === 'text' ? null : 'text'))}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 20h16" />
            <path d="M6 16L12 4l6 12" />
            <path d="M8 12h8" />
          </svg>
        </button>
        {colorPopover === 'text' ? (
          <ColorPopover
            label="Text color"
            active={activeText}
            onPick={setTextColor}
            onClear={() => setTextColor(null)}
          />
        ) : null}
      </div>

      <div className="nx-fmt-sep" />

      <button type="button" className="nx-fmt-btn" title="Link (⌘K)" onClick={createLink}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
        </svg>
      </button>
    </div>
  )
}

function ColorPopover({
  label,
  active,
  onPick,
  onClear,
}: {
  label: string
  active: string | undefined
  onPick: (color: ColorKey) => void
  onClear: () => void
}) {
  return (
    <div className="nx-fmt-popover">
      <div className="nx-fmt-popover__label">{label}</div>
      <div className="nx-fmt-popover__grid">
        {COLOR_KEYS.map((key) => {
          const token = COLORS[key]
          const isActive = active === key
          return (
            <button
              key={key}
              type="button"
              className={`nx-fmt-swatch ${isActive ? 'is-active' : ''}`}
              title={token.label}
              style={{ background: token.bg, borderColor: token.border, color: token.text }}
              onClick={() => onPick(key)}
            >
              <span>A</span>
            </button>
          )
        })}
      </div>
      {active ? (
        <button type="button" className="nx-fmt-popover__clear" onClick={onClear}>
          Clear
        </button>
      ) : null}
    </div>
  )
}
