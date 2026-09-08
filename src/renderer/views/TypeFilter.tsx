import { useMemo } from 'react'
import { useAppStore } from '../store/app-store'

/**
 * Type chips above the Notes list, on the same rail as the tag chips.
 *
 * Tables used to be where you asked "show me every Book", and it left with
 * Phase 4 scheduled to rebuild it. Type management went to Settings; this is
 * the other half of what it owned — browsing by type — put back where the
 * pages already are, rather than left as a hole until the view engine lands.
 *
 * A count comes off the page list the store already holds, so this adds no
 * query. It renders nothing until the vault has a type beyond the seeded Note,
 * because one chip that always matches everything is not a filter.
 */
export function TypeFilter() {
  const types = useAppStore((s) => s.types)
  const pages = useAppStore((s) => s.pages)
  const activeTypeFilter = useAppStore((s) => s.activeTypeFilter)
  const toggleTypeFilter = useAppStore((s) => s.toggleTypeFilter)
  const clearTypeFilter = useAppStore((s) => s.clearTypeFilter)

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of pages) if (p.type_id) map.set(p.type_id, (map.get(p.type_id) ?? 0) + 1)
    return map
  }, [pages])

  // Only types that something is actually of. A type defined and never used is
  // configuration, and Settings is where configuration is listed.
  const shown = useMemo(() => types.filter((t) => (counts.get(t.id) ?? 0) > 0), [types, counts])

  if (shown.length < 2) return null

  return (
    <div className="nx-tagfilter">
      <div className="nx-tagfilter__head">
        <span className="nx-type-label">Types</span>
        {activeTypeFilter.length > 0 && (
          <button className="nx-tagfilter__clear" onClick={clearTypeFilter}>
            clear
          </button>
        )}
      </div>

      <div className="nx-tagfilter__chips">
        {shown.map((type) => (
          <span
            key={type.id}
            className={`nx-tag-chip nx-tag-chip--type ${
              activeTypeFilter.includes(type.id) ? 'is-active' : ''
            }`}
          >
            <button
              className="nx-tag-chip__label"
              onClick={() => toggleTypeFilter(type.id)}
              title={`${counts.get(type.id)} page${counts.get(type.id) === 1 ? '' : 's'} of this type`}
            >
              {type.name}
              <span className="nx-tag-chip__count">{counts.get(type.id)}</span>
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}
