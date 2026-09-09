import { useMemo } from 'react'
import type { PropertyDefinition, Property, ViewRow } from '@shared/types'
import type { FilterField, ViewLayout, ViewSort } from '@shared/views'
import { relativeTime } from '../hooks/use-relative-time'
import { EmptyState } from '../design/EmptyState'
import { Table, TableBody, TableHead, TableRow, Td, Th } from '../design/Table'

/**
 * The four ways a view can be drawn.
 *
 * All of them take the same rows. That is the whole design: a board is these
 * rows bucketed by one field, a gallery is these rows as cards, and adding a
 * calendar later is a fifth function here rather than a fifth query. Nothing
 * in this file talks to the main process.
 */

export interface LayoutProps {
  rows: ViewRow[]
  columns: PropertyDefinition[]
  grouping: FilterField | null
  sort: ViewSort[]
  typeName: (id: string) => string
  onOpen: (pageId: string) => void
  /**
   * Sorting a table writes the view's own sort, so the order you put it in is
   * the order it is in tomorrow. A column header that only sorted the rows on
   * screen would be a control that forgets.
   */
  onSort: (field: FilterField) => void
}

/** What one property reads as, whatever column it landed in. */
export function propertyText(prop: Property | undefined): string {
  if (!prop) return ''
  if (prop.value_number !== null && prop.value_number !== undefined) return String(prop.value_number)
  if (prop.value_date) return prop.value_date
  if (prop.value_relation) return prop.value_relation
  const text = prop.value_text ?? ''
  // A multi_select is a JSON array; showing the brackets is showing the
  // storage rather than the value.
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed.join(', ')
    } catch {
      /* not a list after all — show the text */
    }
  }
  if (text === 'true') return 'yes'
  if (text === 'false') return 'no'
  return text
}

const propOf = (row: ViewRow, key: string): Property | undefined =>
  row.properties.find((p) => p.key === key)

/**
 * The buckets a grouped layout draws, in the order it draws them.
 *
 * A row with no value for the field lands in one bucket of its own rather than
 * being dropped — "no status yet" is the column most worth seeing on a board.
 * A tag grouping puts a row in every bucket it belongs to, which is correct:
 * tags are many-to-many and a board that showed only the first would be lying.
 */
export function groupRows(
  rows: ViewRow[],
  grouping: FilterField | null,
  typeName: (id: string) => string
): { key: string; label: string; rows: ViewRow[] }[] {
  if (!grouping) return [{ key: '', label: '', rows }]

  const buckets = new Map<string, { label: string; rows: ViewRow[] }>()
  const put = (key: string, label: string, row: ViewRow) => {
    const bucket = buckets.get(key) ?? { label, rows: [] }
    bucket.rows.push(row)
    buckets.set(key, bucket)
  }

  for (const row of rows) {
    if (grouping.kind === 'tag') {
      if (row.tags.length === 0) put('', 'No tag', row)
      else for (const tag of row.tags) put(tag.id, tag.name, row)
      continue
    }
    if (grouping.kind === 'type') {
      put(row.type_id, typeName(row.type_id), row)
      continue
    }
    if (grouping.kind === 'property') {
      const text = propertyText(propOf(row, grouping.key ?? ''))
      put(text, text || 'Empty', row)
      continue
    }
    if (grouping.kind === 'pinned') {
      put(row.is_pinned ? '1' : '0', row.is_pinned ? 'Pinned' : 'Not pinned', row)
      continue
    }
    put('', 'All', row)
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => ({ key, label: bucket.label, rows: bucket.rows }))
    .sort((a, b) => {
      // Empty last, so the column you have not filled in does not open the
      // board.
      if (!a.key && b.key) return 1
      if (a.key && !b.key) return -1
      return a.label.localeCompare(b.label)
    })
}

function TagChips({ row }: { row: ViewRow }) {
  if (row.tags.length === 0) return null
  return (
    <span className="nx-view__tags">
      {row.tags.map((tag) => (
        <span key={tag.id} className={`nx-tag-chip nx-tag-chip--${tag.color}`}>
          <span className="nx-tag-chip__label">{tag.name}</span>
        </span>
      ))}
    </span>
  )
}

function TableLayout({ rows, columns, sort, typeName, onOpen, onSort }: LayoutProps) {
  // Only the first sort clause is drawn. A stack of them is a real thing the
  // filter tree can hold, but an arrow on three headers reads as three sorts
  // at once rather than as one order.
  const primary = sort[0]
  const directionFor = (field: FilterField): 'asc' | 'desc' | null => {
    if (!primary) return null
    if (primary.field.kind !== field.kind) return null
    if (field.kind === 'property' && primary.field.key !== field.key) return null
    return primary.direction
  }

  const header = (label: string, field: FilterField) => (
    <Th key={label} sort={directionFor(field)} onClick={() => onSort(field)}>
      {label}
    </Th>
  )

  return (
    <div className="nx-view__scroll">
      <Table>
        <TableHead>
          <tr>
            {header('Title', { kind: 'title' })}
            {columns.map((def) => header(def.name, { kind: 'property', key: def.key }))}
            <Th>Tags</Th>
            {header('Edited', { kind: 'updated' })}
          </tr>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} onClick={() => onOpen(row.id)}>
              <Td>
                <span className="nx-view__title-cell">
                  {row.title || 'Untitled'}
                  <span className="nx-view__type nx-type-data">{typeName(row.type_id)}</span>
                </span>
              </Td>
              {columns.map((def) => (
                <Td key={def.key} className="nx-type-data">
                  {propertyText(propOf(row, def.key))}
                </Td>
              ))}
              <Td>
                <TagChips row={row} />
              </Td>
              <Td className="nx-type-data">{relativeTime(row.updated_at)}</Td>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ListLayout({ rows, typeName, onOpen }: LayoutProps) {
  return (
    <div className="nx-view__scroll">
      <ul className="nx-view__list">
        {rows.map((row) => (
          <li key={row.id}>
            <button className="nx-view__list-row" onClick={() => onOpen(row.id)}>
              <span className="nx-view__list-title">{row.title || 'Untitled'}</span>
              <span className="nx-view__list-meta nx-type-data">
                {typeName(row.type_id)} · {relativeTime(row.updated_at)}
              </span>
              <TagChips row={row} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Card({
  row,
  columns,
  typeName,
  onOpen
}: {
  row: ViewRow
  columns: PropertyDefinition[]
  typeName: (id: string) => string
  onOpen: (id: string) => void
}) {
  // Three properties, because a card that shows everything is a table row with
  // worse alignment.
  const shown = columns.slice(0, 3)
  return (
    <button className="nx-view__card" onClick={() => onOpen(row.id)}>
      <span className="nx-view__card-title">{row.title || 'Untitled'}</span>
      <span className="nx-view__card-type nx-type-data">{typeName(row.type_id)}</span>
      {shown.map((def) => {
        const text = propertyText(propOf(row, def.key))
        if (!text) return null
        return (
          <span key={def.key} className="nx-view__card-prop nx-type-data">
            <span className="nx-view__card-key">{def.name}</span>
            {text}
          </span>
        )
      })}
      <TagChips row={row} />
    </button>
  )
}

function GalleryLayout({ rows, columns, grouping, typeName, onOpen }: LayoutProps) {
  const groups = useMemo(() => groupRows(rows, grouping, typeName), [rows, grouping, typeName])
  return (
    <div className="nx-view__scroll">
      {groups.map((group) => (
        <section key={group.key || '__none__'} className="nx-view__gallery-group">
          {grouping && (
            <h3 className="nx-type-label nx-view__group-head">
              {group.label} <span className="nx-view__count">{group.rows.length}</span>
            </h3>
          )}
          <div className="nx-view__gallery">
            {group.rows.map((row) => (
              <Card key={row.id} row={row} columns={columns} typeName={typeName} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function BoardLayout({ rows, columns, grouping, typeName, onOpen }: LayoutProps) {
  const groups = useMemo(() => groupRows(rows, grouping, typeName), [rows, grouping, typeName])

  if (!grouping) {
    return (
      <EmptyState
        text="A board needs something to be a column"
        meta="Pick a field to group by — a select property, a type or a tag."
      />
    )
  }

  return (
    <div className="nx-view__board">
      {groups.map((group) => (
        <section key={group.key || '__none__'} className="nx-view__column">
          <header className="nx-view__group-head nx-type-label">
            {group.label} <span className="nx-view__count">{group.rows.length}</span>
          </header>
          <div className="nx-view__column-body">
            {group.rows.map((row) => (
              <Card key={row.id} row={row} columns={columns} typeName={typeName} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * The registry. Adding `calendar` is a line here and a function above —
 * deliberately, so a fifth layout is never a fifth code path through the
 * query.
 */
export const LAYOUTS: Record<ViewLayout, (props: LayoutProps) => JSX.Element> = {
  table: TableLayout,
  list: ListLayout,
  board: BoardLayout,
  gallery: GalleryLayout
}
