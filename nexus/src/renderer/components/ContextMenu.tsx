import { Menu, type MenuSection } from './Menu'

// Thin compatibility wrapper used by the sidebar. New code should build
// MenuSection[] directly and render <Menu/>; this converts the Phase 01
// flat-list shape ({ label, action, danger, separator }) into the new
// section-based shape so the sidebar keeps working without a rewrite.

export interface ContextMenuItem {
  type?: 'separator'
  label?: string
  icon?: string
  danger?: boolean
  action?: () => void
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  // Split the flat item list on separators into sections.
  const sections: MenuSection[] = []
  let current: MenuSection = { id: 'sec-0', items: [] }
  let secIdx = 0
  items.forEach((item, i) => {
    if (item.type === 'separator') {
      if (current.items.length) sections.push(current)
      secIdx += 1
      current = { id: `sec-${secIdx}`, items: [] }
      return
    }
    current.items.push({
      id: `item-${i}`,
      label: item.label || '',
      icon: item.icon,
      danger: item.danger,
      onSelect: item.action,
    })
  })
  if (current.items.length) sections.push(current)

  return <Menu x={x} y={y} sections={sections} onClose={onClose} minWidth={180} />
}
