import { useEffect, useRef, useState } from 'react'
import { useActiveStyles, useBlockNoteEditor } from '@blocknote/react'
import { COLORS, COLOR_KEYS, type ColorKey } from '../blocks/callout-colors'
import { useAppStore } from '../stores/app-store'
import type { Page } from '../../shared/types'

// Custom floating formatting toolbar shown when text is selected. Built on
// BlockNote's <FormattingToolbarController> which positions this component
// above the selection — we only have to render the content.

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
  const pages = useAppStore((s) => s.pages)

  const [colorPopover, setColorPopover] = useState<'text' | 'bg' | null>(null)
  const [pageLinkOpen, setPageLinkOpen] = useState(false)
  const [pageSearch, setPageSearch] = useState('')
  const [urlLinkOpen, setUrlLinkOpen] = useState(false)
  const [urlLinkValue, setUrlLinkValue] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  // Selection range captured at the moment a link popover opens. When the
  // popover input takes focus the editor's text selection collapses, so we
  // need to restore from this snapshot before calling editor.createLink.
  const savedSelection = useRef<{ from: number; to: number; text: string } | null>(null)

  // Close popovers on outside click
  useEffect(() => {
    if (!colorPopover && !pageLinkOpen && !urlLinkOpen) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (
        target.closest('.nx-fmt-popover') ||
        target.closest('.nx-fmt-btn-wrap') ||
        target.closest('.nx-page-link-popover') ||
        target.closest('.nx-url-link-popover')
      ) {
        return
      }
      setColorPopover(null)
      setPageLinkOpen(false)
      setUrlLinkOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [colorPopover, pageLinkOpen, urlLinkOpen])

  // Focus search input when page-link popover opens
  useEffect(() => {
    if (pageLinkOpen) {
      setPageSearch('')
      setTimeout(() => searchRef.current?.focus(), 30)
    }
  }, [pageLinkOpen])

  // Focus URL input when external-link popover opens
  useEffect(() => {
    if (urlLinkOpen) {
      setUrlLinkValue('')
      setTimeout(() => urlInputRef.current?.focus(), 30)
    }
  }, [urlLinkOpen])

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

  // Capture the editor's current selection so we can restore it after the
  // popover input steals focus. Called from the link button onMouseDown
  // (mousedown on toolbar buttons doesn't move focus thanks to the parent
  // preventDefault, but clicking the popover input WILL collapse selection).
  const captureSelection = () => {
    const tiptap = (editor as unknown as { _tiptapEditor?: { state: { selection: { from: number; to: number }; doc: { textBetween: (a: number, b: number) => string } } } })._tiptapEditor
    if (!tiptap) return
    const { from, to } = tiptap.state.selection
    savedSelection.current = {
      from,
      to,
      text: tiptap.state.doc.textBetween(from, to),
    }
  }

  // BlockNote 0.24's createLink wraps the active text selection. The popover
  // input takes focus and collapses the editor's selection, so we restore it
  // from the captured range before applying. If the original range was empty
  // we pass the fallback text so the URL itself is inserted.
  const applyLink = (url: string, fallbackText: string) => {
    const tiptap = (editor as unknown as {
      _tiptapEditor?: {
        commands: { focus: () => boolean; setTextSelection: (r: { from: number; to: number }) => boolean }
      }
    })._tiptapEditor
    const saved = savedSelection.current
    savedSelection.current = null

    if (tiptap && saved) {
      tiptap.commands.focus()
      tiptap.commands.setTextSelection({ from: saved.from, to: saved.to })
    }

    if (saved && saved.text.length > 0) {
      editor.createLink(url)
    } else {
      editor.createLink(url, fallbackText)
    }
    editor.focus()
  }

  const submitExternalLink = () => {
    const raw = urlLinkValue.trim()
    if (!raw) return
    // If the user types a bare domain, normalize to https://.
    const url = /^[a-z]+:\/\//i.test(raw) || raw.startsWith('mailto:') ? raw : `https://${raw}`
    setUrlLinkOpen(false)
    applyLink(url, raw)
  }

  const createPageLink = (page: Page) => {
    setPageLinkOpen(false)
    applyLink(`nexus://${page.id}`, page.title || 'Untitled')
  }

  const filteredPages = pages
    .filter((p) => !p.is_deleted)
    .filter((p) =>
      pageSearch.trim()
        ? (p.title || 'Untitled').toLowerCase().includes(pageSearch.toLowerCase())
        : true,
    )
    .slice(0, 12)

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

      {/* External URL link */}
      <div className="nx-fmt-btn-wrap">
        <button
          type="button"
          className={`nx-fmt-btn ${urlLinkOpen ? 'is-on' : ''}`}
          title="External link"
          onClick={() => {
            setColorPopover(null)
            setPageLinkOpen(false)
            setUrlLinkOpen((v) => {
              const next = !v
              if (next) captureSelection()
              return next
            })
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
          </svg>
        </button>
        {urlLinkOpen && (
          <div className="nx-url-link-popover nx-fmt-popover" style={{ width: 240, left: '50%', transform: 'translateX(-50%)' }}>
            <input
              ref={urlInputRef}
              type="text"
              placeholder="https://example.com"
              value={urlLinkValue}
              onChange={(e) => setUrlLinkValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setUrlLinkOpen(false)
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitExternalLink()
                }
              }}
              className="w-full bg-[var(--nx-bg-base)] border border-[var(--nx-border-subtle)] rounded-[var(--nx-radius-sm)] px-2 py-1.5 text-[12px] text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-tertiary)] outline-none focus:border-[var(--nx-accent)]/40"
            />
            <button
              type="button"
              className="w-full mt-1.5 px-2 py-1.5 rounded-[var(--nx-radius-sm)] text-[12px] text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-hover)] hover:text-[var(--nx-text-primary)] transition-colors duration-75"
              onMouseDown={(e) => {
                e.preventDefault()
                submitExternalLink()
              }}
            >
              Add link
            </button>
          </div>
        )}
      </div>

      {/* Page link — wraps selected text as nexus://pageId link */}
      <div className="nx-fmt-btn-wrap">
        <button
          type="button"
          className={`nx-fmt-btn ${pageLinkOpen ? 'is-on' : ''}`}
          title="Link to page"
          onClick={() => {
            setColorPopover(null)
            setUrlLinkOpen(false)
            setPageLinkOpen((v) => {
              const next = !v
              if (next) captureSelection()
              return next
            })
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        </button>
        {pageLinkOpen && (
          <div className="nx-page-link-popover nx-fmt-popover" style={{ width: 220, left: '50%', transform: 'translateX(-50%)' }}>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search pages…"
              value={pageSearch}
              onChange={(e) => setPageSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setPageLinkOpen(false)
                if (e.key === 'Enter' && filteredPages.length > 0) {
                  createPageLink(filteredPages[0])
                }
              }}
              className="w-full bg-[var(--nx-bg-base)] border border-[var(--nx-border-subtle)] rounded-[var(--nx-radius-sm)] px-2 py-1.5 text-[12px] text-[var(--nx-text-primary)] placeholder:text-[var(--nx-text-tertiary)] outline-none focus:border-[var(--nx-accent)]/40 mb-1.5"
            />
            <div className="max-h-[160px] overflow-y-auto">
              {filteredPages.length === 0 ? (
                <p className="text-[11px] text-[var(--nx-text-tertiary)] px-1 py-1.5">No pages found</p>
              ) : (
                filteredPages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[var(--nx-radius-sm)] text-left text-[12px] text-[var(--nx-text-secondary)] hover:bg-[var(--nx-bg-hover)] hover:text-[var(--nx-text-primary)] transition-colors duration-75 active:bg-[var(--nx-bg-active)]"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      createPageLink(page)
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--nx-text-tertiary)]">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="truncate">{page.title || 'Untitled'}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
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
