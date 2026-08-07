import './NavItem.css'

interface NavItemProps {
  label: string
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
