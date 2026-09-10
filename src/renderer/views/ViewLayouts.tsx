import { useMemo } from 'react'
import type { PropertyDefinition, Property, ViewAggregateResult, ViewRow } from '@shared/types'
import type { FilterField, ViewLayout, ViewSort } from '@shared/views'
import { relativeTime } from '../hooks/use-relative-time'
import { EmptyState } from '../design/EmptyState'
import { Table, TableBody, TableFoot, TableHead, TableRow, Td, Th } from '../design/Table'
import { AGGREGATE_FUNCTIONS, type AggregateFn, type ViewAggregate } from '@shared/views'

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
  /**
   * A page id to its current title. A relation property stores an id, and
   * every layout here draws one — so without this a board grouped by a
   * relation prints uuids as its column headings and a card shows one as a
   * value. Resolved live rather than snapshotted, for the same reason
   * `usePageTitles` exists: a renamed target has to read as its new name.
   */
  pageTitle: (id: string | null | undefined) => string | null
  onOpen: (pageId: string) => void
  /**
   * Sorting a table writes the view's own sort, so the order you put it in is
   * the order it is in tomorrow. A column header that only sorted the rows on
   * screen would be a control that forgets.
   */
  onSort: (field: FilterField) => void
  /** What the footer has been asked to total, and what came back for it. */
  aggregates: ViewAggregate[]
  aggregateResults: ViewAggregateResult[]
  /** Cycle one column's footer cell. Persisted on the view, like the sort. */
  onAggregate: (key: string, fn: AggregateFn | null) => void
}

/**
 * What one property reads as, whatever column it landed in.
 *
 * `pageTitle` is optional only so the fallback is explicit: a relation whose
 * target has been deleted for good has no title to show, and a caller with no
 * resolver at all should still get something rather than nothing. Both cases
 * end at the same place — the id, which is at least a thing you can search
 * for. Every layout in this file passes a resolver.
 */
export function propertyText(
  prop: Property | undefined,
  pageTitle?: (id: string | null | undefined) => string | null
): string {
  if (!prop) return ''
  if (prop.value_number !== null && prop.value_number !== undefined) return String(prop.value_number)
  if (prop.value_date) return prop.value_date
  if (prop.value_relation) return pageTitle?.(prop.value_relation) ?? prop.value_relation
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
  typeName: (id: string) => string,
  pageTitle?: (id: string | null | undefined) => string | null
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
      // Bucketed by the stored value and labelled by the readable one: two
      // pages pointing at the same target must land in one column even if
      // that target is later renamed, and the column must still be named
      // after it rather than after its id.
      const prop = propOf(row, grouping.key ?? '')
      const key = prop?.value_relation ?? propertyText(prop)
      const label = propertyText(prop, pageTitle)
      put(key, label || 'Empty', row)
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

/**
 * One footer cell.
 *
 * Clicking cycles none → sum → mean → filled → min → max → none, which is the
 * same three-state idea the sort headers already use and for the same reason:
 * turning a total back off has to be as reachable as turning it on, and a menu
 * for five options is a menu for a thing you do by feel.
 */
function AggregateCell({
  def,
  result,
  onAggregate
}: {
  def: PropertyDefinition
  result: ViewAggregateResult | undefined
  onAggregate: (key: string, fn: AggregateFn | null) => void
}) {
  const order = AGGREGATE_FUNCTIONS.map((a) => a.fn)
  const next = (): AggregateFn | null => {
    if (!result) return order[0]
    const i = order.indexOf(result.fn)
    return i === order.length - 1 ? null : order[i + 1]
  }

  const label = result ? AGGREGATE_FUNCTIONS.find((a) => a.fn === result.fn)?.label : null

  return (
    <Td>
      <button
        className={`nx-table__agg ${result ? '' : 'nx-table__agg--empty'}`}
        title={`Total ${def.name}`}
        onClick={(e) => {
          // The header row above navigates on click; this one must not, and
          // the footer sits inside the same table.
          e.stopPropagation()
          onAggregate(def.key, next())
        }}
      >
        {result ? (
          <>
            <span className="nx-table__agg-fn">{label}</span>
            <span className="nx-table__agg-value">{formatAggregate(result)}</span>
          </>
        ) : (
          <span className="nx-table__agg-fn">total</span>
        )}
      </button>
    </Td>
  )
}

/**
 * A number the width of a column, and honest about what it covers.
 *
 * Long decimals are the norm for a mean — `avg` over three trades gives
 * 158.33333333333334 — and a footer cell is not the place to print seventeen
 * digits. Trailing zeroes are dropped so a sum of whole numbers still reads as
 * a whole number.
 */
function formatAggregate(result: ViewAggregateResult): string {
  if (result.fn === 'count') return String(result.value ?? 0)
  if (result.value === null) return '—'
  const rounded = Math.round(result.value * 100) / 100
  return String(rounded)
}

function TableLayout({
  rows,
  columns,
  sort,
  typeName,
  pageTitle,
  onOpen,
  onSort,
  aggregateResults,
  onAggregate
}: LayoutProps) {
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
                  {propertyText(propOf(row, def.key), pageTitle)}
                </Td>
              ))}
              <Td>
                <TagChips row={row} />
              </Td>
              <Td className="nx-type-data">{relativeTime(row.updated_at)}</Td>
            </TableRow>
          ))}
        </TableBody>
        {/*
          Always drawn, never conditional on something already being totalled.
          A footer that appears only once you have found the feature is a
          footer nobody finds — the empty cells fade in on hover instead.
        */}
        {columns.length > 0 && (
          <TableFoot>
            <tr>
              <Td />
              {columns.map((def) => (
                <AggregateCell
                  key={def.key}
                  def={def}
                  result={aggregateResults.find((r) => r.key === def.key)}
                  onAggregate={onAggregate}
                />
              ))}
              <Td />
              <Td />
            </tr>
          </TableFoot>
        )}
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
  pageTitle,
  onOpen
}: {
  row: ViewRow
  columns: PropertyDefinition[]
  typeName: (id: string) => string
  pageTitle: (id: string | null | undefined) => string | null
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
        const text = propertyText(propOf(row, def.key), pageTitle)
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

function GalleryLayout({ rows, columns, grouping, typeName, pageTitle, onOpen }: LayoutProps) {
  const groups = useMemo(
    () => groupRows(rows, grouping, typeName, pageTitle),
    [rows, grouping, typeName, pageTitle]
  )
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
              <Card
                key={row.id}
                row={row}
                columns={columns}
                typeName={typeName}
                pageTitle={pageTitle}
                onOpen={onOpen}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function BoardLayout({ rows, columns, grouping, typeName, pageTitle, onOpen }: LayoutProps) {
  const groups = useMemo(
    () => groupRows(rows, grouping, typeName, pageTitle),
    [rows, grouping, typeName, pageTitle]
  )

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
              <Card
                key={row.id}
                row={row}
                columns={columns}
                typeName={typeName}
                pageTitle={pageTitle}
                onOpen={onOpen}
              />
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
