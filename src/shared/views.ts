/**
 * A saved question about the vault.
 *
 * `PHASES.md` phase 4 in the shape it specifies, pulled forward: the filter
 * tree here is the one contract that must not change, because every view a
 * vault holds is a serialised copy of it. Adding a `kind`, a `cmp` or a layout
 * is additive and safe; renaming or re-nesting anything already written is not.
 *
 * The tree is *edited* in the renderer and *compiled* in exactly one place —
 * `repo.compileFilter` — so no filter behaviour can exist that the saved shape
 * cannot express. That is the whole point of writing it down before there is a
 * second layout to disagree about it.
 */

/**
 * What a view draws. Grouping, not the layout, is what makes a board a board:
 * a board is a view grouped by a select, a gallery is the same rows as cards.
 * Registering them here is what makes `calendar` and `chart` later the same
 * shape of addition rather than a new feature each time.
 */
export type ViewLayout = 'table' | 'list' | 'board' | 'gallery'

export const VIEW_LAYOUTS: { layout: ViewLayout; label: string; hint: string }[] = [
  { layout: 'table', label: 'Table', hint: 'A row per object, a column per property' },
  { layout: 'list', label: 'List', hint: 'Titles and a line of meta' },
  { layout: 'board', label: 'Board', hint: 'Columns by the property it is grouped on' },
  { layout: 'gallery', label: 'Gallery', hint: 'Cards, with the first properties on each' }
]

/**
 * What a condition asks about.
 *
 * `tag` is the one addition to the list in `PHASES.md`, and it is here because
 * tags are their own tables in this build rather than a property. Phase 2b
 * turns them into one, and when it does, every saved `{ kind: 'tag' }` has to
 * be rewritten to `{ kind: 'property', key: 'tags' }` by that migration. It is
 * written down here so that migration cannot forget.
 */
export type FilterFieldKind =
  | 'type'
  | 'property'
  | 'tag'
  | 'folder'
  | 'title'
  | 'created'
  | 'updated'
  | 'pinned'
  | 'backlink'

export type FilterCmp =
  | 'is'
  | 'not'
  | 'has'
  | 'lacks'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'empty'
  | 'notEmpty'
  | 'before'
  | 'after'
  | 'within'

export interface FilterField {
  kind: FilterFieldKind
  /** The property key, when `kind` is `property`. Ignored otherwise. */
  key?: string
}

export interface FilterLeaf {
  field: FilterField
  cmp: FilterCmp
  value?: string | number | boolean | null
}

export interface FilterGroup {
  op: 'and' | 'or'
  of: FilterNode[]
}

export type FilterNode = FilterGroup | FilterLeaf

export const isFilterGroup = (node: FilterNode): node is FilterGroup =>
  typeof node === 'object' && node !== null && 'op' in node

/** An empty group matches everything, which is what a new view should show. */
export const EMPTY_FILTER: FilterGroup = { op: 'and', of: [] }

/**
 * What a footer cell under a column says about the whole result.
 *
 * `count` is deliberately "how many rows have a value here" rather than "how
 * many rows there are" — the row count is already printed above the table, and
 * the useful question about a column is how much of it is filled in. It is
 * also the one function that means something under a column of text, which is
 * why it is not restricted to numbers.
 *
 * Additive, like every other list in this file: a build that meets an `fn` it
 * does not know shows nothing in that cell and leaves the stored value alone.
 */
export type AggregateFn = 'sum' | 'mean' | 'count' | 'min' | 'max'

export const AGGREGATE_FUNCTIONS: { fn: AggregateFn; label: string; numeric: boolean }[] = [
  { fn: 'sum', label: 'Sum', numeric: true },
  { fn: 'mean', label: 'Mean', numeric: true },
  { fn: 'count', label: 'Filled', numeric: false },
  { fn: 'min', label: 'Min', numeric: true },
  { fn: 'max', label: 'Max', numeric: true }
]

/** One footer cell: a property key and what to do with its column. */
export interface ViewAggregate {
  key: string
  fn: AggregateFn
}

/**
 * The aggregates a view carries, read out of its `config`.
 *
 * They live in `config` rather than as a column of their own because that is
 * what `config` is for and because it makes them free to add: an older build
 * opening this view reads a `config` key it does not recognise, writes it back
 * untouched, and draws no footer. A new column would have needed a migration
 * to say the same thing.
 */
export function aggregatesOf(config: Record<string, unknown> | null | undefined): ViewAggregate[] {
  const raw = config?.aggregates
  if (!Array.isArray(raw)) return []
  const known = new Set(AGGREGATE_FUNCTIONS.map((a) => a.fn))
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const { key, fn } = entry as { key?: unknown; fn?: unknown }
    if (typeof key !== 'string' || !key) return []
    if (typeof fn !== 'string' || !known.has(fn as AggregateFn)) return []
    return [{ key, fn: fn as AggregateFn }]
  })
}

/** The same list with one column's entry replaced, or removed when `fn` is null. */
export function withAggregate(
  current: ViewAggregate[],
  key: string,
  fn: AggregateFn | null
): ViewAggregate[] {
  const without = current.filter((a) => a.key !== key)
  return fn ? [...without, { key, fn }] : without
}

export interface ViewSort {
  field: FilterField
  direction: 'asc' | 'desc'
}

/** A view as it is stored, with its JSON columns already parsed. */
export interface ViewDef {
  id: string
  name: string
  icon: string | null
  filter: FilterNode
  sort: ViewSort[]
  /** What the board's columns (or a gallery's sections) are cut by. */
  grouping: FilterField | null
  layout: ViewLayout
  config: Record<string, unknown>
  is_pinned: number
  sort_order: number
  created_at: string
}

/** What a view is created as, before it has been edited. */
export type ViewDraft = Partial<Omit<ViewDef, 'id' | 'created_at'>> & { name: string }

/**
 * Which comparators make sense for a field, so the builder cannot offer
 * "before" on a checkbox. The compiler still refuses anything it does not
 * understand — this list is for the UI, not for safety.
 */
export function comparatorsFor(kind: FilterFieldKind, propertyType?: string): FilterCmp[] {
  switch (kind) {
    case 'type':
    case 'folder':
      return ['is', 'not', 'empty', 'notEmpty']
    case 'tag':
      return ['has', 'lacks', 'empty', 'notEmpty']
    case 'title':
      return ['contains', 'is', 'not', 'empty', 'notEmpty']
    case 'created':
    case 'updated':
      return ['within', 'before', 'after']
    case 'pinned':
      return ['is']
    case 'backlink':
      return ['is', 'empty', 'notEmpty']
    case 'property':
      switch (propertyType) {
        case 'number':
          return ['is', 'not', 'gt', 'gte', 'lt', 'lte', 'empty', 'notEmpty']
        case 'date':
          return ['is', 'before', 'after', 'within', 'empty', 'notEmpty']
        case 'boolean':
          return ['is', 'empty', 'notEmpty']
        case 'multi_select':
          return ['has', 'lacks', 'empty', 'notEmpty']
        case 'relation':
          return ['is', 'not', 'empty', 'notEmpty']
        default:
          return ['is', 'not', 'contains', 'empty', 'notEmpty']
      }
  }
}

export const CMP_LABELS: Record<FilterCmp, string> = {
  is: 'is',
  not: 'is not',
  has: 'has',
  lacks: 'does not have',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: 'contains',
  empty: 'is empty',
  notEmpty: 'is not empty',
  before: 'before',
  after: 'after',
  within: 'in the last'
}

/** Comparators that take no value, so the builder hides the field. */
export const VALUELESS: ReadonlySet<FilterCmp> = new Set<FilterCmp>(['empty', 'notEmpty'])
