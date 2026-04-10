import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

// Shared floating menu primitive used by the right-click block context menu,
// the slash menu, and a couple of smaller popovers. Responsibilities:
//   - lay out sections (optional headings) with items + separators
//   - optional per-item submenu (used for the callout color picker)
//   - keyboard navigation across flattened selectable items
//   - auto-reposition within the viewport
//   - entrance fade + slide handled in globals.css via the `.nx-menu` class

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  shortcut?: string
  isActive?: boolean
  danger?: boolean
  disabled?: boolean
  onSelect?: () => void
  submenu?: MenuSection[]
}

export interface MenuSection {
  id: string
  heading?: string
  items: MenuItem[]
}

export interface MenuProps {
  x: number
  y: number
  sections: MenuSection[]
  onClose: () => void
  // Max width hint (px). Content can still grow if items demand it.
  minWidth?: number
}

const DEFAULT_MIN_WIDTH = 220

export function Menu({ x, y, sections, onClose, minWidth = DEFAULT_MIN_WIDTH }: MenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null)

  // Flattened list of focusable items for keyboard nav
  const flatItems = useMemo(() => {
    const out: { sectionIdx: number; itemIdx: number; item: MenuItem }[] = []
    sections.forEach((section, sectionIdx) => {
      section.items.forEach((item, itemIdx) => {
        if (!item.disabled) out.push({ sectionIdx, itemIdx, item })
      })
    })
    return out
  }, [sections])

  const [activeIndex, setActiveIndex] = useState<number>(0)

  // Auto-reposition on viewport overflow
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pad = 8
    let left = x
    let top = y
    if (left + rect.width + pad > vw) left = Math.max(pad, vw - rect.width - pad)
    if (top + rect.height + pad > vh) top = Math.max(pad, vh - rect.height - pad)
    setPos({ left, top })
  }, [x, y, sections])

  // Close on outside click / escape
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % Math.max(flatItems.length, 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => (i - 1 + flatItems.length) % Math.max(flatItems.length, 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const entry = flatItems[activeIndex]
        if (entry) {
          entry.item.onSelect?.()
          if (!entry.item.submenu) onClose()
        }
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, flatItems, activeIndex])

  const handleItemClick = (item: MenuItem) => {
    if (item.disabled) return
    if (item.submenu) {
      setOpenSubmenuId((prev) => (prev === item.id ? null : item.id))
      return
    }
    item.onSelect?.()
    onClose()
  }

  let flatIdx = -1

  return (
    <div
      ref={rootRef}
      className="nx-menu"
      style={{ left: pos.left, top: pos.top, minWidth }}
      role="menu"
    >
      {sections.map((section, sectionIdx) => (
        <div key={section.id} className="nx-menu__section">
          {sectionIdx > 0 ? <div className="nx-menu__sep" /> : null}
          {section.heading ? (
            <div className="nx-menu__heading">{section.heading}</div>
          ) : null}
          {section.items.map((item) => {
            if (!item.disabled) flatIdx += 1
            const isHighlighted = flatIdx === activeIndex && !item.disabled
            return (
              <MenuRow
                key={item.id}
                item={item}
                highlighted={isHighlighted}
                submenuOpen={openSubmenuId === item.id}
                onHover={() => {
                  if (!item.disabled) {
                    const idx = flatItems.findIndex(
                      (f) => f.sectionIdx === sectionIdx && f.item.id === item.id,
                    )
                    if (idx >= 0) setActiveIndex(idx)
                  }
                }}
                onClick={() => handleItemClick(item)}
                onCloseAll={onClose}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

function MenuRow({
  item,
  highlighted,
  submenuOpen,
  onHover,
  onClick,
  onCloseAll,
}: {
  item: MenuItem
  highlighted: boolean
  submenuOpen: boolean
  onHover: () => void
  onClick: () => void
  onCloseAll: () => void
}) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!submenuOpen || !rowRef.current) return
    const rect = rowRef.current.getBoundingClientRect()
    setSubPos({ left: rect.right + 4, top: rect.top })
  }, [submenuOpen])

  return (
    <div
      ref={rowRef}
      role="menuitem"
      className={[
        'nx-menu__item',
        highlighted ? 'is-highlighted' : '',
        item.isActive ? 'is-active' : '',
        item.danger ? 'is-danger' : '',
        item.disabled ? 'is-disabled' : '',
        item.submenu ? 'has-submenu' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseEnter={onHover}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {item.icon ? <span className="nx-menu__icon">{item.icon}</span> : <span className="nx-menu__icon" />}
      <span className="nx-menu__label">{item.label}</span>
      {item.shortcut ? <span className="nx-menu__shortcut">{item.shortcut}</span> : null}
      {item.submenu ? (
        <span className="nx-menu__chevron" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M4 3l4 3-4 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ) : null}

      {item.submenu && submenuOpen && subPos ? (
        <Menu
          x={subPos.left}
          y={subPos.top}
          sections={item.submenu}
          onClose={onCloseAll}
          minWidth={180}
        />
      ) : null}
    </div>
  )
}
