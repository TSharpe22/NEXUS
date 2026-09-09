import toast from 'react-hot-toast'
import type { FilterLeaf, FilterGroup } from '@shared/views'
import { useAppStore } from '../store/app-store'

/**
 * Keep the filter you just built.
 *
 * The chips above this are a question asked in passing — "Books tagged
 * kinetics" — and until now the answer evaporated the moment you clicked
 * something else. This turns that same question into a saved view, which is
 * the whole difference between a filter and a second brain: one is a gesture,
 * the other is a place you go back to.
 *
 * It writes the same tree the builder writes, so a view made here is not a
 * lesser kind of view — opening it in Views shows exactly these conditions,
 * editable like any other.
 */
export function SaveAsView() {
  const activeTypeFilter = useAppStore((s) => s.activeTypeFilter)
  const activeTagFilter = useAppStore((s) => s.activeTagFilter)
  const types = useAppStore((s) => s.types)
  const tags = useAppStore((s) => s.tags)
  const createView = useAppStore((s) => s.createView)
  const openView = useAppStore((s) => s.openView)

  const chosen = activeTypeFilter.length + activeTagFilter.length
  if (chosen === 0) return null

  const typeNames = activeTypeFilter.map((id) => types.find((t) => t.id === id)?.name ?? 'Note')
  const tagNames = activeTagFilter.map((id) => tags.find((t) => t.id === id)?.name ?? 'tag')

  // The list treats several chips on one rail as "any of these" and both rails
  // together as "and" — so a tree that said plain `and` over every chip would
  // answer a different question from the one on screen.
  const of: (FilterLeaf | FilterGroup)[] = []
  if (activeTypeFilter.length > 0)
    of.push({
      op: 'or',
      of: activeTypeFilter.map((id) => ({ field: { kind: 'type' }, cmp: 'is', value: id }) as FilterLeaf)
    })
  if (activeTagFilter.length > 0)
    of.push({
      op: 'or',
      of: activeTagFilter.map((id) => ({ field: { kind: 'tag' }, cmp: 'has', value: id }) as FilterLeaf)
    })

  const name =
    [typeNames.join(' or '), tagNames.length ? `tagged ${tagNames.join(' or ')}` : '']
      .filter(Boolean)
      .join(' ') || 'Filtered pages'

  const save = async () => {
    // Unwrap the single-chip case: one type and nothing else should read as
    // `type is Book`, not as an "any of" with one arm — and only a plain `and`
    // of conditions lets the table borrow that type's column order.
    const flattened = of.flatMap((node) => ('op' in node && node.of.length === 1 ? node.of : [node]))
    const view = await createView({
      name,
      filter: { op: 'and', of: flattened },
      layout: 'table'
    })
    openView(view.id)
    toast.success(`Saved "${view.name}"`)
  }

  return (
    <button className="nx-notes__save-view" onClick={save} title="Keep this filter as a view">
      Save as a view
    </button>
  )
}
