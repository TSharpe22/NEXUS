import React from 'react'
import type { Page } from '../../shared/types'
import { PageIcon } from '../blocks/icons'

// LinkMenu items returned by getItems. Each either references an existing page
// or is the "create new" sentinel.
export interface LinkMenuItem {
  id: string
  title: string
  icon: string | null
  isCreate?: boolean
  page?: Page
  onItemClick: (editor: any) => void
}

/**
 * Build the getItems function for the [[ suggestion menu.
 * triggerCharacter is "[", so the query starts with "[" when "[[" was typed.
 * If the first char is not "[", we return empty (normal bracket usage).
 */
export function getLinkMenuItems(
  pages: Page[],
  onSelect: (page: Page | null, title: string) => void,
): (query: string) => Promise<LinkMenuItem[]> {
  return async (query: string) => {
    // Only activate for [[ (query starts with "[")
    if (!query.startsWith('[')) {
      return []
    }

    // Strip the leading "[" to get the actual search query
    const search = query.slice(1).trim()

    let filtered: Page[]
    if (!search) {
      filtered = pages.filter((p) => !p.is_deleted).slice(0, 15)
    } else {
      const lower = search.toLowerCase()
      filtered = pages
        .filter((p) => !p.is_deleted && (p.title || 'Untitled').toLowerCase().includes(lower))
        .slice(0, 15)
    }

    const items: LinkMenuItem[] = filtered.map((page) => ({
      id: page.id,
      title: page.title || 'Untitled',
      icon: page.icon,
      page,
      onItemClick: () => onSelect(page, page.title || 'Untitled'),
    }))

    // Add "Create new page" option when there's search text
    if (search) {
      const exactMatch = filtered.some(
        (p) => (p.title || '').toLowerCase() === search.toLowerCase(),
      )
      if (!exactMatch) {
        items.push({
          id: '__create__',
          title: search,
          icon: null,
          isCreate: true,
          onItemClick: () => onSelect(null, search),
        })
      }
    }

    return items
  }
}

/**
 * Custom suggestion menu component for the [[ page link picker.
 * Props match BlockNote's SuggestionMenuProps<LinkMenuItem>.
 */
export interface LinkMenuProps {
  items: LinkMenuItem[]
  onItemClick?: (item: LinkMenuItem) => void
  selectedIndex: number | undefined
  loadingState: 'loading-initial' | 'loading' | 'loaded'
}

export function LinkMenu({ items, onItemClick, selectedIndex }: LinkMenuProps) {
  // Don't render anything if no items (normal bracket usage, not [[)
  if (items.length === 0) {
    return null
  }

  return (
    <div className="nx-link-menu">
      <div className="nx-link-menu__header">Link to page</div>
      {items.map((item, index) => (
        <button
          key={item.id}
          className={`nx-link-menu__item ${index === selectedIndex ? 'is-selected' : ''}`}
          onClick={() => onItemClick?.(item)}
        >
          {item.isCreate ? (
            <>
              <span className="nx-link-menu__icon nx-link-menu__icon--create">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </span>
              <span className="nx-link-menu__label">
                Create new page: <strong>{item.title}</strong>
              </span>
            </>
          ) : (
            <>
              <span className="nx-link-menu__icon">
                <PageIcon iconKey={item.icon} size={14} />
              </span>
              <span className="nx-link-menu__label">{item.title}</span>
            </>
          )}
        </button>
      ))}
    </div>
  )
}
