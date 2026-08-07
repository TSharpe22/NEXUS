import type { Page, LinkTarget } from '@shared/types'
import { Icon } from '../design/Icon'

/** Walk a BlockNote document tree and collect every pageMention target. */
export function extractLinkTargets(blocks: unknown[]): LinkTarget[] {
  const targets = new Map<string, string | null>()

  function walkInlineContent(content: unknown, blockText: string) {
    if (!Array.isArray(content)) return
    for (const node of content) {
      if (!node || typeof node !== 'object') continue
      const n = node as { type?: string; props?: { pageId?: string } }
      if (n.type === 'pageMention' && n.props?.pageId && !targets.has(n.props.pageId)) {
        targets.set(n.props.pageId, blockText.slice(0, 200) || null)
      }
    }
  }

  function walkBlocks(items: unknown[]) {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const block = item as { content?: unknown; children?: unknown[] }
      let blockText = ''
      if (Array.isArray(block.content)) {
        for (const c of block.content) {
          if (c && typeof c === 'object' && 'text' in c) blockText += String((c as { text: unknown }).text)
        }
      }
      walkInlineContent(block.content, blockText)
      if (Array.isArray(block.children)) walkBlocks(block.children)
    }
  }

  walkBlocks(blocks)
  return Array.from(targets, ([targetPageId, context]) => ({ targetPageId, context }))
}

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
