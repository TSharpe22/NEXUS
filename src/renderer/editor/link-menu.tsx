import type { Page } from '@shared/types'
import { Icon } from '../design/Icon'

export interface LinkMenuItem {
  id: string
  title: string
  isCreate?: boolean
  page?: Page
  onItemClick: () => void
}

/**
 * BlockNote's SuggestionMenuController strips the trigger char ("[") before
 * calling getItems, so `query` is what the user typed AFTER the first "[".
 * Require a second "[" to activate — otherwise single-bracket markdown
 * text would trigger this menu.
 */
export function getLinkMenuItems(
  onSelect: (page: Page | null, title: string) => void,
  currentPageId?: string
): (query: string) => Promise<LinkMenuItem[]> {
  return async (query: string) => {
    if (query.length === 0 || query[0] !== '[') return []

    const search = query.slice(1).trim()
    const filtered = await window.api.links.searchPages(search, currentPageId)

    const items: LinkMenuItem[] = filtered.map((page) => ({
      id: page.id,
      title: page.title || 'Untitled',
      page,
      onItemClick: () => onSelect(page, page.title || 'Untitled')
    }))

    if (search && !filtered.some((p) => (p.title || '').toLowerCase() === search.toLowerCase())) {
      items.push({
        id: '__create__',
        title: search,
        isCreate: true,
        onItemClick: () => onSelect(null, search)
      })
    }

    return items
  }
}

export interface LinkMenuProps {
  items: LinkMenuItem[]
  onItemClick?: (item: LinkMenuItem) => void
  selectedIndex: number | undefined
}

export function LinkMenu({ items, onItemClick, selectedIndex }: LinkMenuProps) {
  if (items.length === 0) return null

  return (
    <div className="nx-link-menu">
      <div className="nx-link-menu__header nx-type-label">Link to page</div>
      {items.map((item, index) => (
        <button
          key={item.id}
          className={`nx-link-menu__item ${index === selectedIndex ? 'nx-link-menu__item--selected' : ''}`}
          onClick={() => onItemClick?.(item)}
        >
          <Icon shape={item.isCreate ? 'square' : 'diamond'} size={11} color="var(--nx-accent)" />
          {item.isCreate ? (
            <span>
              Create page: <strong>{item.title}</strong>
            </span>
          ) : (
            <span>{item.title}</span>
          )}
        </button>
      ))}
    </div>
  )
}
