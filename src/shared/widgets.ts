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
    // 5 / 4 / 3 rather than 6 / 3 / 3: the habit strip needs a third of the
    // row to show three weeks without clipping, which is what it had before
    // Home became a grid.
    { id: 'w-today', kind: 'today', config: {}, span: 5 },
    { id: 'w-habits', kind: 'habits', config: {}, span: 4 },
    { id: 'w-pinned', kind: 'pinned', config: {}, span: 3 },
    { id: 'w-graph', kind: 'graph', config: {}, span: 6 },
    { id: 'w-stale', kind: 'stale', config: {}, span: 3 },
    { id: 'w-stats', kind: 'stats', config: {}, span: 3 }
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

    // A duplicated id is a broken React key and a config edit that hits two
    // widgets, so the second one is renamed rather than dropped.
    let id = typeof item.id === 'string' && item.id !== '' ? item.id : `w-${widgets.length}`
    while (seen.has(id)) id = `${id}-${widgets.length}`
    seen.add(id)

    widgets.push({
      id,
      kind: item.kind,
      config: item.config && typeof item.config === 'object' ? item.config : {},
      span: normaliseSpan(item.span)
    })
  }

  // An empty dashboard is a legitimate thing to want — it is what "remove
  // every widget" leaves behind, and replacing it with the default would make
  // that action impossible to perform.
  return { version: 1, widgets }
}
