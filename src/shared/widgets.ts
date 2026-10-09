/**
 * What Home is made of.
 *
 * Home was 480 lines of fixed JSX: two CSS grids with six panels nailed into
 * them, each fetching its own data inline. Nothing about it was data, so
 * "move that panel" and "I don't want the graph" were both code changes.
 *
 * This is the same move `views.ts` already made for saved questions, and it is
 * made here for the same reason. A dashboard is a *list of widget instances*,
 * stored as JSON, edited in the renderer and rendered from one registry — so
 * adding a widget later is an entry in a table rather than a new feature, and
 * a dashboard someone else wrote is a file rather than a fork.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 * Everything in this file is serialised into the vault the moment a user
 * rearranges their Home. Treat it exactly as `views.ts` asks to be treated:
 *
 *   • Adding a `kind`, a config key, or a span is additive and safe.
 *   • Renaming or re-nesting anything already written is not.
 *   • `kind` is a plain `string`, never a union of the kinds this build knows.
 *
 * That last one is the load-bearing decision, and it is worth being explicit
 * about. A build that does not recognise a kind must still read the instance,
 * leave it alone, and write it back unchanged — otherwise opening your vault
 * in an older Nexus, or one without some add-on installed, silently deletes
 * the widgets it did not understand. Unknown kinds render as a placeholder.
 * They are never dropped.
 */

/**
 * How many columns of the twelve-column Home grid a widget occupies.
 *
 * Deliberately a span and a sort order rather than an (x, y, w, h) rectangle.
 * Free positioning means overlap, collision resolution and a drag surface, and
 * none of that is needed to answer "I want the graph smaller and further
 * down". A rectangle can be added later as extra keys on the instance; a
 * rectangle removed later cannot.
 */
export type WidgetSpan = number

/** Columns in the Home grid. Twelve, because it divides by 2, 3 and 4. */
export const GRID_COLUMNS = 12

/**
 * Every width a widget can take — all twelve, not a curated five.
 *
 * The first version of this offered {3, 4, 6, 8, 12} on the grounds that they
 * are the "nice" fractions. It took one screen to show why that is the same
 * stiffness this file exists to remove: three widgets across a row want 5 + 4
 * + 3, and a menu built out of nice numbers could not express it. The common
 * fractions keep their names; the rest are honest about what they are.
 */
const SPAN_NAMES: Record<number, string> = {
  3: 'Quarter',
  4: 'Third',
  6: 'Half',
  8: 'Two thirds',
  9: 'Three quarters',
  12: 'Full width'
}

export const WIDGET_SPANS: { span: WidgetSpan; label: string }[] = Array.from(
  { length: GRID_COLUMNS },
  (_, i) => {
    const span = i + 1
    return { span, label: SPAN_NAMES[span] ?? `${span} / ${GRID_COLUMNS}` }
  }
)

/** A stored span, clamped to something the grid can actually lay out. */
export function normaliseSpan(value: unknown): WidgetSpan {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return 6
  return Math.min(GRID_COLUMNS, Math.max(1, n))
}

/** One widget, as it is stored. */
export interface WidgetInstance {
  /** Stable across reorders, so React keys and config edits survive a move. */
  id: string
  /**
   * Which widget this is. A string rather than a union — see the note above.
   * Built-in kinds are namespaced by nothing; a future add-on's kinds should
   * carry a prefix (`myplugin.chart`) so the two can never collide.
   */
  kind: string
  /**
   * The widget's own settings, opaque to everything but the widget itself.
   * Same shape and same reasoning as `ViewDef.config`.
   */
  config: Record<string, unknown>
  span: WidgetSpan
  /**
   * Sits under the widget before it, in the same column, instead of starting
   * a column of its own. Panels in a row share a height, so a short widget
   * next to a tall one (the Calendar beside the graph) stretched into a box
   * of empty space; stacking two short ones fills that height with content.
   * The column's width is the first widget's `span`; a stacked widget's own
   * span is kept, unused, for when it is unstacked.
   *
   * Optional and written only when true. An older build ignores it and draws
   * the widget in a column of its own, which is the layout it had before.
   */
  stack?: boolean
}

/** A column on Home: one widget, and any stacked under it. */
export interface WidgetColumn {
  /** The column's width — its first widget's span. */
  span: WidgetSpan
  /** Indices into `Dashboard.widgets`, top to bottom. */
  indices: number[]
}

/**
 * The dashboard's widgets, grouped into columns. A `stack` on the first
 * widget has nothing to sit under and starts a column like any other.
 */
export function widgetColumns(widgets: WidgetInstance[]): WidgetColumn[] {
  const columns: WidgetColumn[] = []
  widgets.forEach((w, i) => {
    const last = columns[columns.length - 1]
    if (w.stack && last) last.indices.push(i)
    else columns.push({ span: w.span, indices: [i] })
  })
  return columns
}

/**
 * A whole Home screen.
 *
 * Stored as one JSON blob in `settings` under `home.dashboard`, not as a
 * table. There is exactly one dashboard, and a table for a single row is a
 * migration nobody needed — when a second dashboard exists, this shape is
 * what a row in that table will hold.
 */
export interface Dashboard {
  /** Bumped only if the shape below ever needs a reader to branch on it. */
  version: 1
  widgets: WidgetInstance[]
}

/**
 * Home as it has always looked, expressed in the new shape.
 *
 * This is what a vault with no saved dashboard gets, and it is deliberately
 * identical to the hand-written layout it replaces — the refactor that
 * introduced this file changed how Home is *assembled*, and nothing about
 * what it shows.
 */
export const DEFAULT_DASHBOARD: Dashboard = {
  version: 1,
  widgets: [
    { id: 'w-capture', kind: 'capture', config: {}, span: 12 },
    // Today and the week side by side, then three thirds: the habit strip
    // needs a third of the row to show three weeks without clipping.
    { id: 'w-today', kind: 'today', config: {}, span: 5 },
    { id: 'w-week', kind: 'week', config: {}, span: 7 },
    { id: 'w-calendar', kind: 'calendar', config: {}, span: 12 },
    { id: 'w-habits', kind: 'habits', config: {}, span: 4 },
    { id: 'w-pinned', kind: 'pinned', config: {}, span: 4 },
    { id: 'w-stale', kind: 'stale', config: {}, span: 4 },
    { id: 'w-graph', kind: 'graph', config: {}, span: 12 }
  ]
}

/**
 * Bring whatever was on disk up to something renderable.
 *
 * Runs on read, in the renderer, on a blob that a previous build — or a hand
 * edit, or an add-on — may have written. It repairs what it can and drops only
 * what it cannot identify at all. Note what it does *not* do: it never drops a
 * widget for having an unfamiliar `kind`, because that is exactly the case
 * this whole design exists to survive.
 */
/**
 * Kinds Nexus shipped and then took out. A saved layout still naming one has
 * it dropped on load rather than drawn as "not installed": that placeholder
 * is for a widget something else might provide, and nothing will provide
 * these again.
 *
 * `stats` — the Vault panel (pages, links, open tasks, size on disk).
 */
const RETIRED_KINDS = new Set(['stats'])

export function normaliseDashboard(raw: unknown): Dashboard {
  if (!raw || typeof raw !== 'object') return DEFAULT_DASHBOARD

  const candidate = raw as Partial<Dashboard>
  if (!Array.isArray(candidate.widgets)) return DEFAULT_DASHBOARD

  const seen = new Set<string>()
  const widgets: WidgetInstance[] = []

  for (const entry of candidate.widgets) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Partial<WidgetInstance>
    if (typeof item.kind !== 'string' || item.kind === '') continue
    if (RETIRED_KINDS.has(item.kind)) continue

    // A duplicated id is a broken React key and a config edit that hits two
    // widgets, so the second one is renamed rather than dropped.
    let id = typeof item.id === 'string' && item.id !== '' ? item.id : `w-${widgets.length}`
    while (seen.has(id)) id = `${id}-${widgets.length}`
    seen.add(id)

    widgets.push({
      id,
      kind: item.kind,
      config: item.config && typeof item.config === 'object' ? item.config : {},
      span: normaliseSpan(item.span),
      ...(item.stack === true && widgets.length > 0 ? { stack: true } : {})
    })
  }

  // An empty dashboard is a legitimate thing to want — it is what "remove
  // every widget" leaves behind, and replacing it with the default would make
  // that action impossible to perform.
  return { version: 1, widgets }
}
