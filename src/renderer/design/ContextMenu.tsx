import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Glyph } from './Glyph'
import './ContextMenu.css'

export interface MenuItem {
  label: string
  /** A glyph name from `Glyph.tsx`, or nothing. */
  icon?: string
  onSelect: () => void
  /** Colours the row and its glyph as destructive. */
  danger?: boolean
  disabled?: boolean
}

/** A rule between groups. Consecutive or trailing ones are dropped when drawn. */
export const MENU_SEPARATOR = 'separator' as const
export type MenuEntry = MenuItem | typeof MENU_SEPARATOR

export interface MenuState {
  x: number
  y: number
  entries: MenuEntry[]
}

/**
 * The right-click menu.
 *
 * Rows in this app have always carried their actions as hover buttons, which
 * works until there are more than three of them: the strip runs out of width,
 * every new action makes the others harder to hit, and none of it exists at
 * all for anyone driving by keyboard. A context menu is where the fourth
 * action goes, and it is where the ones that should not be one stray click
 * away — trashing, locking — belong even when there is room on the row.
 *
 * Positioned from the pointer and flipped back inside the window when it would
 * hang off an edge, which is measured after mount rather than guessed from a
 * fixed height: the menu is a different height on a page than on a folder.
 */
export function ContextMenu({ state, onClose }: { state: MenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!state || !ref.current) {
      setPlaced(null)
      return
    }
    const { width, height } = ref.current.getBoundingClientRect()
    const margin = 6
    setPlaced({
      left: Math.max(margin, Math.min(state.x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(state.y, window.innerHeight - height - margin))
    })
  }, [state])

  useEffect(() => {
    if (!state) return
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // `mousedown` rather than `click`, so the menu is gone before whatever is
    // underneath it decides the click was meant for a row.
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    // Capture: a scroll inside the sidebar does not bubble to the window.
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [state, onClose])

  if (!state) return null

  // A separator only earns its line when there is something on both sides of
  // it, so a menu that drops an item conditionally does not grow a stray rule.
  const entries: MenuEntry[] = []
  for (const entry of state.entries) {
    if (entry === MENU_SEPARATOR) {
      if (entries.length > 0 && entries[entries.length - 1] !== MENU_SEPARATOR) entries.push(entry)
      continue
    }
    entries.push(entry)
  }
  while (entries.length > 0 && entries[entries.length - 1] === MENU_SEPARATOR) entries.pop()
  if (entries.length === 0) return null

  return (
    <div
      className="nx-menu"
      ref={ref}
      role="menu"
      style={{
        left: placed?.left ?? state.x,
        top: placed?.top ?? state.y,
        // Drawn once off-screen to be measured. Without this the first frame
        // is the menu in the wrong place, which reads as a jump.
        visibility: placed ? 'visible' : 'hidden'
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) =>
        entry === MENU_SEPARATOR ? (
          <div className="nx-menu__rule" key={`rule-${i}`} role="separator" />
        ) : (
          <button
            key={entry.label}
            className={`nx-menu__item ${entry.danger ? 'is-danger' : ''}`}
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              onClose()
              entry.onSelect()
            }}
          >
            <span className="nx-menu__icon">{entry.icon && <Glyph name={entry.icon} size={13} />}</span>
            {entry.label}
          </button>
        )
      )}
    </div>
  )
}
