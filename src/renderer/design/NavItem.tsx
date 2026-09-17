import type { ReactNode } from 'react'
import './NavItem.css'

interface NavItemProps {
  /**
   * ReactNode rather than string because a pinned view carries a glyph, and
   * the glyph is an element. It used to be interpolated into the label —
   * `${view.icon} ${view.name}` — which worked only for as long as an icon
   * was an emoji.
   */
  label: ReactNode
  selected: boolean
  onClick: () => void
  title?: string
}

export function NavItem({ label, selected, onClick, title }: NavItemProps) {
  const classes = ['nx-nav-item', selected && 'nx-nav-item--selected'].filter(Boolean).join(' ')
  return (
    <button className={classes} onClick={onClick} title={title} aria-current={selected ? 'page' : undefined}>
      {/* A 2px rule rather than an icon: the square/circle/diamond glyphs
          carried no meaning here and just added noise to the sidebar. */}
      <span className="nx-nav-item__rule" aria-hidden />
      {label}
    </button>
  )
}
