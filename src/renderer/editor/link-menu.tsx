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
 * The trigger is "[[" itself — BlockNote has taken multi-character triggers
 * since 0.4x — so a single "[" in ordinary text never opens this, and `query`
 * is everything typed after the second bracket.
 *
 * It used to be a "[" trigger that ignored any query not starting with a
 * second "[". Under 0.55 that cannot work: a trigger character typed while
 * its own menu is open opens the menu afresh, so the query never holds the
 * second bracket and the link menu never appeared at all.
 */
export function getLinkMenuItems(
  onSelect: (page: Page | null, title: string) => void,
  currentPageId?: string
): (query: string) => Promise<LinkMenuItem[]> {
  return async (query: string) => {
    const search = query.trim()
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
