import { useEffect, useMemo } from 'react'
import type { SuggestionMenuProps } from '@blocknote/react'
import type { SlashItem } from '../blocks/slash-items'

// Custom slash menu body. Unlike <Menu>, the selectedIndex, keyboard nav,
// and filtering are all owned by BlockNote's <SuggestionMenuController>, so
// this component is purely a visual reflow into our Nexus menu shell.

const GROUP_ORDER = ['Headings', 'Basic blocks', 'Lists', 'Basic', 'Advanced']

function groupItems(items: SlashItem[]): { group: string; items: SlashItem[] }[] {
  const buckets = new Map<string, SlashItem[]>()
  items.forEach((item) => {
    const key = item.group || 'Basic'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(item)
  })
  const sorted = Array.from(buckets.entries()).sort(([a], [b]) => {
    const ai = GROUP_ORDER.indexOf(a)
    const bi = GROUP_ORDER.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
  return sorted.map(([group, items]) => ({ group, items }))
}

export function SlashMenu(props: SuggestionMenuProps<SlashItem>) {
  const { items, onItemClick, selectedIndex } = props

  const grouped = useMemo(() => groupItems(items), [items])

  // Auto-scroll the highlighted item into view.
  useEffect(() => {
    if (selectedIndex === undefined) return
    const el = document.querySelector<HTMLDivElement>(
      `[data-slash-index="${selectedIndex}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  let flatIndex = -1

  return (
    <div className="nx-menu nx-slash-menu" role="listbox">
      {grouped.length === 0 ? (
        <div className="nx-menu__empty">No results</div>
      ) : (
        grouped.map(({ group, items: groupItems }, sectionIdx) => (
          <div key={group} className="nx-menu__section">
            {sectionIdx > 0 ? <div className="nx-menu__sep" /> : null}
            <div className="nx-menu__heading">{group}</div>
            {groupItems.map((item) => {
              flatIndex += 1
              const isHighlighted = flatIndex === selectedIndex
              return (
                <div
                  key={`${group}-${item.title}`}
                  data-slash-index={flatIndex}
                  className={[
                    'nx-menu__item',
                    isHighlighted ? 'is-highlighted' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onItemClick?.(item)
                  }}
                >
                  <span className="nx-menu__icon">
                    {item.icon ?? <span className="nx-menu__icon-text">·</span>}
                  </span>
                  <span className="nx-menu__label">
                    <span className="nx-menu__label-title">{item.title}</span>
                    {item.subtext ? (
                      <span className="nx-menu__label-sub">{item.subtext}</span>
                    ) : null}
                  </span>
                  {item.badge ? <span className="nx-menu__shortcut">{item.badge}</span> : null}
                </div>
              )
            })}
          </div>
        ))
      )}
    </div>
  )
}
