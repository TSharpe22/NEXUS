import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import type { Dashboard, WidgetInstance, WidgetSpan } from '@shared/widgets'
import { DEFAULT_DASHBOARD, WIDGET_SPANS, normaliseDashboard } from '@shared/widgets'
import { dayOfYear, fromISO, isoWeek } from '@shared/date-range'
import { dayStartLabel } from '@shared/day'
import { useAppStore, useToday, useWallToday } from '../store/app-store'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import { EmptyState } from '../design/EmptyState'
import { ErrorState } from '../design/ErrorState'
import type { WidgetContext } from '../widgets/context'
import { WIDGET_DEFINITIONS, widgetFor } from '../widgets/registry'
import './Home.css'

/**
 * Home — the day, assembled from widgets.
 *
 * This screen used to be two fixed grids holding six hand-placed panels, each
 * fetching inline. It is now a list of `WidgetInstance` read from the vault
 * and drawn through the registry, so "move that panel", "make it narrower"
 * and "I don't want the graph" are edits rather than commits.
 *
 * What has not changed: everything on Home is still a view over something
 * that already exists. There is no Home-specific projection — tasks come from
 * the `tasks` table, habits from two properties on a user-made type, pinned
 * and stale from `pages`. The only thing stored for Home itself is the
 * arrangement, and that is one JSON row in `settings`.
 */

// ------------------------------------------------------------------
// Day header
// ------------------------------------------------------------------

function DayHeader() {
  // The wall clock, not the logical day. This used to render the logical day
  // "so the header agrees with everything under it", which meant moving the
  // day-start hour appeared to change the app's clock: set it to 6pm at 5pm
  // and the header read yesterday, with nothing on screen admitting why. The
  // day-start hour decides where a note is filed. It does not decide what day
  // it is, and the one line below is where the difference gets explained.
  const wall = useWallToday()
  const logical = useToday()
  const dayStartHour = useAppStore((s) => s.prefs.dayStartHour)
  const now = fromISO(wall)
  const { day, total } = dayOfYear(now)
  const quarter = Math.floor(now.getMonth() / 3) + 1

  return (
    <div className="nx-home__day">
      <div className="nx-home__day-name">
        {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>
      <div className="nx-type-data">
        week {isoWeek(now)} · Q{quarter} · {day} / {total}
      </div>
      {logical !== wall && (
        <div className="nx-type-data nx-home__logical">
          still filing under{' '}
          {fromISO(logical).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
          {' · '}the day starts at {dayStartLabel(dayStartHour)}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// One widget in its frame
// ------------------------------------------------------------------

function WidgetSlot({
  instance,
  ctx,
  editing,
  onRemove,
  onMove,
  onSpan
}: {
  instance: WidgetInstance
  ctx: WidgetContext
  editing: boolean
  onRemove: () => void
  onMove: (delta: -1 | 1) => void
  onSpan: (span: WidgetSpan) => void
}) {
  const definition = widgetFor(instance.kind)

  const controls = editing ? (
    <span className="nx-home__wctl">
      <button title="Move earlier" aria-label="Move earlier" onClick={() => onMove(-1)}>
        ←
      </button>
      <button title="Move later" aria-label="Move later" onClick={() => onMove(1)}>
        →
      </button>
      <select
        className="nx-select"
        value={instance.span}
        aria-label="Width"
        onChange={(e) => onSpan(Number(e.target.value) as WidgetSpan)}
      >
        {WIDGET_SPANS.map((s) => (
          <option key={s.span} value={s.span}>
            {s.label}
          </option>
        ))}
      </select>
      <button
        className="nx-home__wctl-x"
        title="Remove from Home"
        aria-label="Remove from Home"
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  ) : null

  /**
   * A widget whose kind nothing registered.
   *
   * Written by a newer Nexus, or by an add-on that is not installed. It is
   * shown rather than hidden, and — critically — it is still in the array, so
   * saving the dashboard writes it back untouched instead of quietly
   * discarding somebody's widget.
   */
  if (!definition) {
    return (
      <div className="nx-home__slot" style={{ gridColumn: `span ${instance.span}` }}>
        <Panel title={instance.kind} actions={controls}>
          <div className="nx-home__hint nx-type-data">
            No widget registered for “{instance.kind}”. It has been left in place.
          </div>
        </Panel>
      </div>
    )
  }

  const body = <definition.Component config={instance.config} ctx={ctx} />

  return (
    <div className="nx-home__slot" style={{ gridColumn: `span ${instance.span}` }}>
      {definition.frame === 'bare' ? (
        <>
          {editing && <div className="nx-home__bare-ctl">{controls}</div>}
          {body}
        </>
      ) : (
        <Panel
          title={definition.label}
          dense={definition.dense}
          actions={controls ?? definition.actions?.(ctx)}
        >
          {body}
        </Panel>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// Home
// ------------------------------------------------------------------

export function Home() {
  const openPage = useAppStore((s) => s.openPage)
  const createPage = useAppStore((s) => s.createPage)
  const openTodayEntry = useAppStore((s) => s.openTodayEntry)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setTrackerMode = useAppStore((s) => s.setTrackerMode)
  const setPagePinned = useAppStore((s) => s.setPagePinned)
  const capture = useAppStore((s) => s.capture)
  const patchPage = useAppStore((s) => s.patchPage)
  const pages = useAppStore((s) => s.pages)
  const types = useAppStore((s) => s.types)

  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Bumped by anything a widget changes — a capture, a task ticked off. The
  // page list cannot serve as that signal: capturing into today's entry edits
  // a page rather than adding one, so the list comes back the same length and
  // nothing would reload.
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((n) => n + 1), [])

  const today = useToday()

  const loadDashboard = useCallback(async () => {
    try {
      const raw = await window.api.dashboard.get()
      // Never trust the blob: it may have been written by another build, by an
      // add-on, or by hand. `normaliseDashboard` repairs what it can.
      setDashboard(raw ? normaliseDashboard(JSON.parse(raw)) : DEFAULT_DASHBOARD)
      setError(null)
    } catch (e) {
      // A dashboard that will not parse is not a reason to lose Home.
      console.error('[nexus] could not read the saved dashboard', e)
      setDashboard(DEFAULT_DASHBOARD)
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  /** Write the arrangement through, and keep what is on screen either way. */
  const persist = useCallback(async (next: Dashboard) => {
    setDashboard(next)
    try {
      await window.api.dashboard.set(JSON.stringify(next))
    } catch (e) {
      console.error('[nexus] could not save the dashboard', e)
      toast.error('Could not save the layout')
    }
  }, [])

  /**
   * The narrowed surface every widget is given. Built once and memoised on
   * what it closes over — a fresh object each render would refetch every
   * widget that lists `ctx` in a dependency array.
   */
  const ctx = useMemo<WidgetContext>(
    () => ({
      today,
      pages,
      types,
      openPage,
      goToTracker: (mode) => {
        setTrackerMode(mode)
        setActiveView('tracker')
      },
      openTodayEntry,
      reload,
      read: {
        journalPeek: () => window.api.journal.peek(),
        tasksInRange: (from, to) => window.api.tasks.inRange(from, to),
        tasksOverdue: (before) => window.api.tasks.overdue(before),
        storage: () => window.api.stats.getStorage(),
        graph: () => window.api.stats.getGraph(),
        habitCandidates: () => window.api.habits.candidates(),
        habitDays: (typeId, dateKey, booleanKey, from, to) =>
          window.api.habits.days(typeId, dateKey, booleanKey, from, to)
      },
      write: {
        // The write goes into the block, so the renderer's cached body for
        // that page is now behind. Handing a stale document back to the editor
        // is how a page saves over what was changed elsewhere.
        setTaskDone: async (pageId, blockId, done) => {
          const page = await window.api.tasks.setDone(pageId, blockId, done)
          patchPage(page.id, { content: page.content, updated_at: page.updated_at })
        },
        setTaskDue: async (pageId, blockId, due) => {
          const page = await window.api.tasks.setDue(pageId, blockId, due)
          patchPage(page.id, { content: page.content, updated_at: page.updated_at })
        },
        setPinned: (pageId, pinned) => setPagePinned(pageId, pinned),
        checkInHabit: (typeId, dateKey, booleanKey, date, done) =>
          window.api.habits.checkIn(typeId, dateKey, booleanKey, date, done),
        capture
      }
    }),
    [
      today,
      pages,
      types,
      openPage,
      openTodayEntry,
      reload,
      setActiveView,
      setTrackerMode,
      setPagePinned,
      patchPage,
      capture,
      // Not read directly — it is what makes a widget refetch after a write.
      reloadKey
    ]
  )

  const widgets = dashboard?.widgets ?? []

  const move = (index: number, delta: -1 | 1) => {
    const next = [...widgets]
    const to = index + delta
    if (to < 0 || to >= next.length) return
    ;[next[index], next[to]] = [next[to], next[index]]
    void persist({ version: 1, widgets: next })
  }

  const remove = (index: number) =>
    void persist({ version: 1, widgets: widgets.filter((_, i) => i !== index) })

  const setSpan = (index: number, span: WidgetSpan) =>
    void persist({
      version: 1,
      widgets: widgets.map((w, i) => (i === index ? { ...w, span } : w))
    })

  const add = (kind: string) => {
    const definition = widgetFor(kind)
    if (!definition) return
    setAdding(false)
    void persist({
      version: 1,
      widgets: [
        ...widgets,
        {
          // Unique per instance rather than per kind: the same widget twice —
          // two views, two habit strips — has to be a thing you can do.
          id: `w-${kind}-${Date.now().toString(36)}`,
          kind,
          config: {},
          span: definition.defaultSpan
        }
      ]
    })
  }

  const resetLayout = () => void persist(DEFAULT_DASHBOARD)

  if (error) {
    return <ErrorState label="Could not load Home" detail={error} onRetry={() => void loadDashboard()} />
  }

  if (dashboard === null) return <div className="nx-type-data">Loading…</div>

  if (pages.length === 0) {
    return (
      <EmptyState
        text="Nothing here yet"
        meta="Nexus is empty. Start today's entry, or make a page — everything on this screen fills in from what you write."
        action={
          <div className="nx-home__empty-actions">
            <Button onClick={() => void openTodayEntry()}>Start today&apos;s entry</Button>
            <Button variant="ghost" onClick={() => void createPage()}>
              New page
            </Button>
          </div>
        }
      />
    )
  }

  return (
    <div className="nx-home">
      <div className="nx-home__head">
        <DayHeader />
        <div className="nx-home__head-actions">
          {editing && (
            <>
              <Button variant="quiet" onClick={() => setAdding((v) => !v)}>
                {adding ? 'Cancel' : '+ Widget'}
              </Button>
              <Button variant="quiet" onClick={resetLayout}>
                Reset
              </Button>
            </>
          )}
          <Button
            variant={editing ? 'primary' : 'quiet'}
            onClick={() => {
              setEditing((v) => !v)
              setAdding(false)
            }}
          >
            {editing ? 'Done' : 'Edit Home'}
          </Button>
        </div>
      </div>

      {adding && (
        <div className="nx-home__adder">
          {WIDGET_DEFINITIONS.map((definition) => (
            <button key={definition.kind} className="nx-home__add-card" onClick={() => add(definition.kind)}>
              <span className="nx-home__add-name">{definition.label}</span>
              <span className="nx-type-data">{definition.hint}</span>
            </button>
          ))}
        </div>
      )}

      <div className={`nx-home__grid ${editing ? 'is-editing' : ''}`}>
        {widgets.map((instance, index) => (
          <WidgetSlot
            key={instance.id}
            instance={instance}
            ctx={ctx}
            editing={editing}
            onRemove={() => remove(index)}
            onMove={(delta) => move(index, delta)}
            onSpan={(span) => setSpan(index, span)}
          />
        ))}

        {widgets.length === 0 && (
          <div className="nx-home__hint nx-type-data" style={{ gridColumn: 'span 12' }}>
            Home is empty. Hit <strong>Edit Home</strong> and add a widget, or reset to the default
            layout.
          </div>
        )}
      </div>
    </div>
  )
}
