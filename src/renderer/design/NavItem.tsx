import { Icon } from './Icon'
import './NavItem.css'

interface NavItemProps {
  label: string
  selected: boolean
  onClick: () => void
}

export function NavItem({ label, selected, onClick }: NavItemProps) {
  const classes = ['nx-nav-item', selected && 'nx-nav-item--selected'].filter(Boolean).join(' ')
  return (
    <button className={classes} onClick={onClick}>
      <Icon shape="diamond" filled={selected} color={selected ? 'var(--nx-accent)' : 'var(--nx-text-dim)'} />
      {label}
    </button>
  )
}
