import { useMemo } from 'react'
import type { PropertyDefinition } from '@shared/types'
import {
  CMP_LABELS,
  VALUELESS,
  comparatorsFor,
  isFilterGroup,
  type FilterCmp,
  type FilterField,
  type FilterGroup,
  type FilterLeaf,
  type FilterNode
} from '@shared/views'
import { useAppStore } from '../store/app-store'
import { Icon } from '../design/Icon'

/**
 * The conditions of a view, edited as rows.
 *
 * Flat on purpose. The tree it writes supports nesting — `PHASES.md` fixes
 * that shape and every later phase serialises it — but a builder that offers
 * nested groups before anyone has asked for one is a lot of UI standing
 * between you and "books I am reading". A nested tree written by hand, or by a
 * later build, still loads and still runs; this editor shows its top level and
 * leaves the rest alone rather than flattening what it cannot draw.
 */

/** The fields that are not somebody's property. */
const BUILTIN: { field: FilterField; label: string }[] = [
  { field: { kind: 'type' }, label: 'Type' },
  { field: { kind: 'tag' }, label: 'Tag' },
  { field: { kind: 'folder' }, label: 'Folder' },
  { field: { kind: 'title' }, label: 'Title' },
  { field: { kind: 'updated' }, label: 'Edited' },
  { field: { kind: 'created' }, label: 'Created' },
  { field: { kind: 'pinned' }, label: 'Pinned' },
  { field: { kind: 'backlink' }, label: 'Linked from' }
]

const fieldToken = (field: FilterField): string =>
  field.kind === 'property' ? `property:${field.key ?? ''}` : field.kind

const tokenToField = (token: string): FilterField =>
  token.startsWith('property:')
    ? { kind: 'property', key: token.slice('property:'.length) }
    : ({ kind: token } as FilterField)

export function ViewFilterBuilder({
  filter,
  properties,
  onChange
}: {
  filter: FilterNode
  properties: PropertyDefinition[]
  onChange: (next: FilterGroup) => void
}) {
  const types = useAppStore((s) => s.types)
  const tags = useAppStore((s) => s.tags)
  const folders = useAppStore((s) => s.folders)
  const pages = useAppStore((s) => s.pages)

  const group: FilterGroup = isFilterGroup(filter) ? filter : { op: 'and', of: [filter] }
  const leaves = group.of.filter((n): n is FilterLeaf => !isFilterGroup(n))
  const nested = group.of.length - leaves.length

  const propertyType = useMemo(() => {
    const map = new Map<string, string>()
    for (const def of properties) map.set(def.key, def.property_type)
    return map
  }, [properties])

  const replace = (index: number, leaf: FilterLeaf) => {
    const next = [...group.of]
    let seen = -1
    for (let i = 0; i < next.length; i++) {
      if (isFilterGroup(next[i])) continue
      seen++
      if (seen === index) {
        next[i] = leaf
        break
      }
    }
    onChange({ ...group, of: next })
  }

  const removeAt = (index: number) => {
    const next: FilterNode[] = []
    let seen = -1
    for (const node of group.of) {
      if (isFilterGroup(node)) {
        next.push(node)
        continue
      }
      seen++
      if (seen !== index) next.push(node)
    }
    onChange({ ...group, of: next })
  }

  const add = () =>
    onChange({ ...group, of: [...group.of, { field: { kind: 'type' }, cmp: 'is', value: 'note' }] })

  return (
    <div className="nx-filter">
      <div className="nx-filter__head">
        <span className="nx-type-label">Conditions</span>
        <div className="nx-filter__mode">
          {(['and', 'or'] as const).map((op) => (
            <button
              key={op}
              className={`nx-filter__mode-btn ${group.op === op ? 'is-active' : ''}`}
              onClick={() => onChange({ ...group, op })}
            >
              {op === 'and' ? 'Match all' : 'Match any'}
            </button>
          ))}
        </div>
      </div>

      {leaves.length === 0 && (
        <div className="nx-filter__empty nx-type-data">
          No conditions — this view shows every page.
        </div>
      )}

      {leaves.map((leaf, index) => {
        const kind = leaf.field.kind
        const type = kind === 'property' ? propertyType.get(leaf.field.key ?? '') : undefined
        const allowed = comparatorsFor(kind, type)
        const cmp = allowed.includes(leaf.cmp) ? leaf.cmp : allowed[0]

        return (
          <div className="nx-filter__row" key={index}>
            <select
              className="nx-select"
              value={fieldToken(leaf.field)}
              onChange={(e) => {
                const field = tokenToField(e.target.value)
                const next = comparatorsFor(
                  field.kind,
                  field.kind === 'property' ? propertyType.get(field.key ?? '') : undefined
                )
                // The comparator and the value belong to the old field; keeping
                // either would leave a row reading "Pinned contains 2026-01-01".
                replace(index, { field, cmp: next[0], value: null })
              }}
            >
              <optgroup label="Page">
                {BUILTIN.map(({ field, label }) => (
                  <option key={field.kind} value={fieldToken(field)}>
                    {label}
                  </option>
                ))}
              </optgroup>
              {properties.length > 0 && (
                <optgroup label="Properties">
                  {properties.map((def) => (
                    <option key={def.key} value={`property:${def.key}`}>
                      {def.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            <select
              className="nx-select nx-filter__cmp"
              value={cmp}
              onChange={(e) => replace(index, { ...leaf, cmp: e.target.value as FilterCmp })}
            >
              {allowed.map((option) => (
                <option key={option} value={option}>
                  {/* "in the last" reads backwards on a date somebody set: a
                      due date is scheduled, so the window there looks ahead. */}
                  {option === 'within' && kind === 'property' ? 'in the next' : CMP_LABELS[option]}
                </option>
              ))}
            </select>

            {!VALUELESS.has(cmp) && (
              <ValueField
                leaf={{ ...leaf, cmp }}
                propertyType={type}
                types={types}
                tags={tags}
                folders={folders}
                pages={pages}
                onChange={(value) => replace(index, { ...leaf, cmp, value })}
              />
            )}

            <button
              className="nx-filter__remove"
              title="Remove this condition"
              aria-label="Remove this condition"
              onClick={() => removeAt(index)}
            >
              ×
            </button>
          </div>
        )
      })}

      <button className="nx-filter__add" onClick={add}>
        <Icon shape="square" size={10} color="var(--nx-accent)" /> Add a condition
      </button>

      {nested > 0 && (
        <div className="nx-filter__note nx-type-data">
          {nested} nested group{nested === 1 ? '' : 's'} in this filter are kept as they are — this
          editor shows the top level.
        </div>
      )}
    </div>
  )
}

function ValueField({
  leaf,
  propertyType,
  types,
  tags,
  folders,
  pages,
  onChange
}: {
  leaf: FilterLeaf
  propertyType?: string
  types: { id: string; name: string }[]
  tags: { id: string; name: string }[]
  folders: { id: string; name: string }[]
  pages: { id: string; title: string }[]
  onChange: (value: string | number | boolean | null) => void
}) {
  const value = leaf.value ?? ''
  const asText = String(value)

  const options = (list: { id: string; name: string }[], blank?: string) => (
    <select className="nx-select nx-filter__value" value={asText} onChange={(e) => onChange(e.target.value)}>
      {blank !== undefined && <option value="">{blank}</option>}
      {list.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  )

  switch (leaf.field.kind) {
    case 'type':
      return options(types)
    case 'tag':
      return options(tags)
    case 'folder':
      return options(folders, 'the root')
    case 'pinned':
      return (
        <select
          className="nx-select nx-filter__value"
          value={value === true || asText === 'true' ? 'true' : 'false'}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <option value="true">yes</option>
          <option value="false">no</option>
        </select>
      )
    case 'backlink':
      return options(
        pages.map((p) => ({ id: p.id, name: p.title || 'Untitled' })),
        'any page'
      )
    case 'created':
    case 'updated':
      return leaf.cmp === 'within' ? (
        <span className="nx-filter__days">
          <input
            className="nx-input nx-filter__value"
            type="number"
            min={1}
            value={asText || 7}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className="nx-type-data">days</span>
        </span>
      ) : (
        <input
          className="nx-input nx-filter__value"
          type="date"
          value={asText}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    default:
      break
  }

  if (leaf.field.kind === 'property') {
    if (leaf.cmp === 'within')
      return (
        <span className="nx-filter__days">
          <input
            className="nx-input nx-filter__value"
            type="number"
            min={1}
            value={asText || 7}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className="nx-type-data">days</span>
        </span>
      )
    if (propertyType === 'date' || leaf.cmp === 'before' || leaf.cmp === 'after')
      return (
        <input
          className="nx-input nx-filter__value"
          type="date"
          value={asText}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    if (propertyType === 'number')
      return (
        <input
          className="nx-input nx-filter__value"
          type="number"
          value={asText}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )
    if (propertyType === 'boolean')
      return (
        <select
          className="nx-select nx-filter__value"
          value={asText || 'true'}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="true">yes</option>
          <option value="false">no</option>
        </select>
      )
    if (propertyType === 'relation')
      return options(
        pages.map((p) => ({ id: p.id, name: p.title || 'Untitled' })),
        'any page'
      )
  }

  return (
    <input
      className="nx-input nx-filter__value"
      value={asText}
      placeholder="value"
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
