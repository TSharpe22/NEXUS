import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import type { PropertyDefinition, ViewAggregateResult, ViewRow } from '@shared/types'
import {
  EMPTY_FILTER,
  VIEW_LAYOUTS,
  aggregatesOf,
  isFilterGroup,
  withAggregate,
  type AggregateFn,
  type FilterField,
  type FilterGroup,
  type ViewDef,
  type ViewLayout
} from '@shared/views'
import { useAppStore } from '../store/app-store'
import { Button } from '../design/Button'
import { EmptyState } from '../design/EmptyState'
import { ErrorState } from '../design/ErrorState'
import { confirmDialog } from '../design/Confirm'
import { usePageTitles } from '../hooks/use-page-titles'
import { ViewFilterBuilder } from './ViewFilterBuilder'
import { LAYOUTS } from './ViewLayouts'
import './Views.css'

/**
 * Saved questions about the vault.
 *
 * The rows are never cached in the store: a view is a query, it goes stale the
 * moment anything is written, and a board showing a page it no longer matches
 * is worse than a board that takes 40ms to redraw. So this screen owns its own
 * result and re-runs it when the view, or the vault, changes.
 */
export function Views() {
  const views = useAppStore((s) => s.views)
  const activeViewId = useAppStore((s) => s.activeViewId)
  const setActiveViewId = useAppStore((s) => s.setActiveViewId)
  const createView = useAppStore((s) => s.createView)
  const saveView = useAppStore((s) => s.saveView)
  const deleteView = useAppStore((s) => s.deleteView)
  const refreshViews = useAppStore((s) => s.refreshViews)
  const openPage = useAppStore((s) => s.openPage)
  const types = useAppStore((s) => s.types)
  // Every page write bumps this list, which is exactly when a view's rows are
  // out of date — so it is what says when to run the query again.
  const pages = useAppStore((s) => s.pages)

  const [rows, setRows] = useState<ViewRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [properties, setProperties] = useState<PropertyDefinition[]>([])
  const [aggregateResults, setAggregateResults] = useState<ViewAggregateResult[]>([])

  const view = useMemo(() => views.find((v) => v.id === activeViewId) ?? null, [views, activeViewId])

  const typeName = useCallback(
    (id: string) => types.find((t) => t.id === id)?.name ?? 'Note',
    [types]
  )
  const pageTitle = usePageTitles()

  useEffect(() => {
    void refreshViews()
  }, [refreshViews])

  useEffect(() => {
    window.api.types.allProperties().then(setProperties).catch(() => setProperties([]))
  }, [types, pages])

  // Select the first view rather than showing a screen with nothing on it,
  // the same way Notes lands you on a page.
  useEffect(() => {
    if (!activeViewId && views.length > 0) setActiveViewId(views[0].id)
  }, [activeViewId, views, setActiveViewId])

  useEffect(() => {
    if (!view) {
      setRows([])
      return
    }
    let cancelled = false
    setLoading(true)
    window.api.views
      .run(view.id)
      .then((result) => {
        if (cancelled) return
        setRows(result)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        console.error('[nexus] could not run the view', e)
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [view, pages])

  /**
   * Totals, run separately from the rows and against the whole match.
   *
   * `runView` is limited, so totalling what came back would be the sum of the
   * first 500 rows presented as the sum. This asks the database instead, and
   * re-asks on the same trigger the rows use — any page write can change a
   * number the footer is showing.
   */
  const aggregates = useMemo(() => aggregatesOf(view?.config), [view])

  useEffect(() => {
    if (!view || aggregates.length === 0) {
      setAggregateResults([])
      return
    }
    let cancelled = false
    window.api.views
      .aggregate(view.id, aggregates)
      .then((result) => !cancelled && setAggregateResults(result))
      .catch((e) => {
        if (cancelled) return
        console.error('[nexus] could not total the view', e)
        setAggregateResults([])
      })
    return () => {
      cancelled = true
    }
  }, [view, aggregates, pages])

  const handleAggregate = (key: string, fn: AggregateFn | null) => {
    if (!view) return
    void patch({ config: { ...view.config, aggregates: withAggregate(aggregates, key, fn) } })
  }

  /**
   * The columns a table draws.
   *
   * A view that names exactly one type gets that type's schema in that type's
   * own order — the order whoever made it dragged the rows into, which is the
   * order the properties panel shows and the mirror writes. A view spanning
   * types has no such answer, so it falls back to the keys its rows actually
   * carry, alphabetically, which is the only order that is not arbitrary.
   */
  const [typeColumns, setTypeColumns] = useState<PropertyDefinition[] | null>(null)
  const soleType = useMemo(() => soleTypeOf(view), [view])

  useEffect(() => {
    if (!soleType) {
      setTypeColumns(null)
      return
    }
    let cancelled = false
    window.api.types
      .getPropertyDefinitions(soleType)
      .then((defs) => !cancelled && setTypeColumns(defs))
      .catch(() => !cancelled && setTypeColumns(null))
    return () => {
      cancelled = true
    }
  }, [soleType, properties])

  const columns = useMemo<PropertyDefinition[]>(() => {
    if (typeColumns) return typeColumns
    const present = new Set<string>()
    for (const row of rows) for (const prop of row.properties) present.add(prop.key)
    return properties.filter((def) => present.has(def.key))
  }, [typeColumns, rows, properties])

  const patch = async (next: Partial<ViewDef>) => {
    if (!view) return
    await saveView(view.id, { name: view.name, ...next })
  }

  /**
   * Cycle a column: ascending, descending, then back to the view's default
   * order. Three states rather than two, because "no sort" is a real answer —
   * newest-first is what a view of recent work wants and there is otherwise no
   * way back to it once a column has been clicked.
   */
  const handleSort = (field: FilterField) => {
    if (!view) return
    const current = view.sort[0]
    const same =
      current &&
      current.field.kind === field.kind &&
      (field.kind !== 'property' || current.field.key === field.key)

    if (!same) return void patch({ sort: [{ field, direction: 'asc' }] })
    if (current.direction === 'asc') return void patch({ sort: [{ field, direction: 'desc' }] })
    return void patch({ sort: [] })
  }

  const handleNew = async () => {
    const view = await createView({ name: 'New view', filter: EMPTY_FILTER, layout: 'table' })
    setEditing(true)
    toast.success(`Made "${view.name}"`)
  }

  const handleDelete = async () => {
    if (!view) return
    const accepted = await confirmDialog({
      title: `Delete the view "${view.name}"?`,
      message: 'The pages it lists are not touched — only the question is deleted.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!accepted) return
    await deleteView(view.id)
    toast.success('View deleted')
  }

  const Layout = view ? LAYOUTS[view.layout] ?? LAYOUTS.table : LAYOUTS.table

  return (
    <div className="nx-views">
      <aside className="nx-views__rail">
        <div className="nx-views__rail-top">
          <Button onClick={handleNew}>New view</Button>
        </div>
        <div className="nx-views__rail-list">
          {views.length === 0 && (
            <div className="nx-views__rail-empty nx-type-data">
              A view is a question you keep — “books I am reading”, “everything tagged kinetics”,
              “notes nothing links to”.
            </div>
          )}
          {views.map((entry) => (
            <button
              key={entry.id}
              className={`nx-views__rail-item ${entry.id === activeViewId ? 'is-active' : ''}`}
              onClick={() => {
                setActiveViewId(entry.id)
                setEditing(false)
              }}
            >
              <span className="nx-views__rail-name">{entry.name}</span>
              <span className="nx-views__rail-layout nx-type-data">{entry.layout}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="nx-views__main">
        {!view ? (
          <EmptyState
            text="No view yet"
            meta="A view is a saved filter over the vault, drawn as a table, a board or a gallery."
            action={<Button onClick={handleNew}>New view</Button>}
          />
        ) : (
          <>
            <header className="nx-views__head">
              <input
                className="nx-views__name"
                value={view.name}
                onChange={(e) => void patch({ name: e.target.value })}
                placeholder="Name this view"
              />

              <div className="nx-views__controls">
                <div className="nx-views__layouts">
                  {VIEW_LAYOUTS.map(({ layout, label, hint }) => (
                    <button
                      key={layout}
                      title={hint}
                      className={`nx-views__layout ${view.layout === layout ? 'is-active' : ''}`}
                      onClick={() => void patch({ layout: layout as ViewLayout })}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <select
                  className="nx-select"
                  title="What the board's columns are cut by"
                  value={groupToken(view.grouping)}
                  onChange={(e) => void patch({ grouping: tokenToGroup(e.target.value, properties) })}
                >
                  <option value="">No grouping</option>
                  <option value="type">Group by type</option>
                  <option value="tag">Group by tag</option>
                  <option value="pinned">Group by pinned</option>
                  {properties.map((def) => (
                    <option key={def.key} value={`property:${def.key}`}>
                      Group by {def.name}
                    </option>
                  ))}
                </select>

                <Button
                  variant={view.is_pinned ? 'selected' : 'quiet'}
                  title={
                    view.is_pinned
                      ? 'Remove this view from the sidebar'
                      : 'Keep this view in the sidebar'
                  }
                  onClick={() => void patch({ is_pinned: view.is_pinned ? 0 : 1 })}
                >
                  {view.is_pinned ? 'Pinned' : 'Pin'}
                </Button>
                <Button variant="quiet" onClick={() => setEditing((v) => !v)}>
                  {editing ? 'Done' : 'Filter'}
                </Button>
                <Button variant="quiet" onClick={handleDelete} title="Delete this view">
                  Delete
                </Button>
              </div>
            </header>

            {editing && (
              <ViewFilterBuilder
                filter={view.filter}
                properties={properties}
                onChange={(next: FilterGroup) => void patch({ filter: next })}
              />
            )}

            <div className="nx-views__count nx-type-data">
              {loading ? 'running…' : `${rows.length} ${rows.length === 1 ? 'page' : 'pages'}`}
              {conditionCount(view) > 0 &&
                ` · ${conditionCount(view)} condition${conditionCount(view) === 1 ? '' : 's'}`}
            </div>

            {error ? (
              <ErrorState
                label="This view could not be run"
                detail={error}
                onRetry={() => void refreshViews()}
              />
            ) : rows.length === 0 && !loading ? (
              <EmptyState
                text="Nothing matches"
                meta={
                  conditionCount(view) === 0
                    ? 'The vault is empty, or every page is in the trash.'
                    : 'Loosen a condition, or add the first page this view is for.'
                }
              />
            ) : (
              <Layout
                rows={rows}
                columns={columns}
                grouping={view.grouping}
                sort={view.sort}
                typeName={typeName}
                pageTitle={pageTitle}
                onOpen={openPage}
                onSort={handleSort}
                aggregates={aggregates}
                aggregateResults={aggregateResults}
                onAggregate={handleAggregate}
              />
            )}
          </>
        )}
      </section>
    </div>
  )
}

const groupToken = (field: FilterField | null): string =>
  !field ? '' : field.kind === 'property' ? `property:${field.key ?? ''}` : field.kind

function tokenToGroup(token: string, properties: PropertyDefinition[]): FilterField | null {
  if (!token) return null
  if (token.startsWith('property:')) {
    const key = token.slice('property:'.length)
    return properties.some((d) => d.key === key) ? { kind: 'property', key } : null
  }
  return { kind: token } as FilterField
}

/**
 * The one type a view is about, when it is about one.
 *
 * Only an `and` of conditions can name a type outright: under `or` a page may
 * match without being of it, so there is no schema to borrow.
 */
function soleTypeOf(view: ViewDef | null): string | null {
  if (!view || !isFilterGroup(view.filter) || view.filter.op !== 'and') return null
  const named = view.filter.of.filter(
    (node): node is Extract<typeof node, { field: FilterField }> =>
      !isFilterGroup(node) && node.field.kind === 'type' && node.cmp === 'is'
  )
  return named.length === 1 ? String(named[0].value ?? '') || null : null
}

/** How many conditions a view carries, counting only the ones it can show. */
function conditionCount(view: ViewDef): number {
  const filter = view.filter
  if (!filter) return 0
  return isFilterGroup(filter) ? filter.of.length : 1
}
