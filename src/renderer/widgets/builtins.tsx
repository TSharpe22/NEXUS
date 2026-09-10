import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import type { GraphData, PageListItem, StorageStats, TrackerTask, ViewRow } from '@shared/types'
import type { ViewDef } from '@shared/views'
import { STALE_DAYS, isOlderThan } from '@shared/date-range'
import { documentPreview } from '@shared/document'
import { formatBytes } from '@shared/format'
import { Button } from '../design/Button'
import { CaptureBar } from '../design/CaptureBar'
import { Icon } from '../design/Icon'
import { DueDate } from '../design/DueDate'
import { GraphView } from '../views/GraphView'
import { HabitStrips, STRIP_DAYS } from '../views/HabitStrips'
import { relativeTime } from '../hooks/use-relative-time'
import type { WidgetProps } from './context'

/**
 * The widgets Nexus ships with.
 *
 * Every one of these is a panel lifted out of the old hand-written Home,
 * unchanged in what it shows. What changed is that each now fetches through
 * `ctx` rather than `window.api`, and each is reachable by name from the
 * registry rather than by position in a grid.
 */

/** How many rows each of the short side panels shows before it stops. */
const SIDE_ROWS = 7

/**
 * How many loose ends are counted before the count gives up and says "50+".
 * The number is not the point past that — that it is large is the point.
 */
const LOOSE_END_LIMIT = 50

/** `GraphView` takes a pixel height rather than filling its box. */
const GRAPH_HEIGHT = 210

// ------------------------------------------------------------------
// Shared pieces
// ------------------------------------------------------------------

function TaskRow({ task, onToggle, onReschedule, onOpen }: {
  task: TrackerTask
  onToggle: (task: TrackerTask) => void
  onReschedule: (task: TrackerTask, due: string | null) => Promise<void>
  onOpen: (pageId: string) => void
}) {
  return (
    <div className={`nx-home__task ${task.isDone ? 'nx-home__task--done' : ''}`}>
      <button
        className="nx-home__check"
        onClick={() => onToggle(task)}
        aria-pressed={task.isDone}
        title={task.isDone ? 'Mark as not done' : 'Mark as done'}
      >
        <Icon
          shape="square"
          filled={task.isDone}
          size={13}
          color={task.isDone ? 'var(--nx-accent)' : 'var(--nx-text-dim)'}
        />
      </button>
      <span className="nx-home__task-text">{task.text || 'Untitled task'}</span>
      <DueDate task={task} onChange={(due) => onReschedule(task, due)} />
      <button className="nx-home__task-src nx-type-data" onClick={() => onOpen(task.pageId)}>
        {task.pageTitle || 'Untitled'}
      </button>
    </div>
  )
}

function PageRow({ page, meta, shape, onOpen, onRemove, removeTitle }: {
  page: PageListItem
  meta: string
  shape: 'diamond' | 'circle'
  onOpen: (id: string) => void
  onRemove?: (id: string) => void
  removeTitle?: string
}) {
  return (
    <div className="nx-home__row">
      <button className="nx-home__row-open" onClick={() => onOpen(page.id)}>
        <Icon shape={shape} size={11} color="var(--nx-text-dim)" />
        <span className="nx-home__row-title">{page.title || 'Untitled'}</span>
        <span className="nx-home__row-meta nx-type-data">{meta}</span>
      </button>
      {onRemove && (
        <button className="nx-home__row-x" title={removeTitle} onClick={() => onRemove(page.id)}>
          ×
        </button>
      )}
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="nx-home__stat">
      <span className="nx-home__stat-value">{value}</span>
      <span className="nx-type-data">{label}</span>
    </div>
  )
}

// ------------------------------------------------------------------
// Widgets
// ------------------------------------------------------------------

export function CaptureWidget({ ctx }: WidgetProps) {
  return <CaptureBar onCapture={ctx.write.capture} onCaptured={ctx.reload} openPage={ctx.openPage} />
}

/**
 * The journal entry, what is due today, and what is late.
 *
 * Still one widget rather than three, because that is what it was before this
 * refactor and this pass deliberately changed nothing on screen. Splitting it
 * is now a registry entry rather than a rewrite, which is the whole point.
 */
export function TodayWidget({ ctx }: WidgetProps) {
  const [entry, setEntry] = useState<Awaited<ReturnType<typeof ctx.read.journalPeek>>>(null)
  const [todayTasks, setTodayTasks] = useState<TrackerTask[]>([])
  const [overdue, setOverdue] = useState<TrackerTask[]>([])
  const [looseEnds, setLooseEnds] = useState<TrackerTask[]>([])

  const load = useCallback(async () => {
    const [todayEntry, dueToday, late, loose] = await Promise.all([
      ctx.read.journalPeek(),
      ctx.read.tasksInRange(ctx.today, ctx.today),
      ctx.read.tasksOverdue(ctx.today),
      ctx.read.tasksLooseEnds(ctx.today, LOOSE_END_LIMIT)
    ])
    setEntry(todayEntry)
    setTodayTasks(dueToday)
    setOverdue(late)
    setLooseEnds(loose)
  }, [ctx])

  useEffect(() => {
    void load()
  }, [load])

  const toggleTask = async (task: TrackerTask) => {
    try {
      await ctx.write.setTaskDone(task.pageId, task.blockId, !task.isDone)
      ctx.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const reschedule = async (task: TrackerTask, due: string | null) => {
    try {
      await ctx.write.setTaskDue(task.pageId, task.blockId, due)
      ctx.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const doneToday = todayTasks.filter((t) => t.isDone).length

  return (
    <>
      {entry ? (
        <button className="nx-home__entry" onClick={() => ctx.openPage(entry.id)}>
          <span className="nx-home__entry-head">
            <span className="nx-home__entry-title">{entry.title || 'Untitled'}</span>
            <span className="nx-type-data">
              {ctx.types.find((t) => t.id === entry.type_id)?.name ?? 'Note'} ·{' '}
              {relativeTime(entry.updated_at)}
            </span>
            <span className="nx-home__entry-open nx-type-data">open →</span>
          </span>
          <span className="nx-home__entry-preview">
            {documentPreview(entry.content, 180) || 'Empty so far.'}
          </span>
        </button>
      ) : (
        <div className="nx-home__entry nx-home__entry--absent">
          <span className="nx-home__entry-absent-text">No entry for today yet</span>
          <Button onClick={() => void ctx.openTodayEntry()}>Start today&apos;s entry</Button>
        </div>
      )}

      <div className="nx-home__section">
        <span className="nx-type-label">Tasks · today</span>
        <span className="nx-type-data">
          {todayTasks.length === 0 ? 'nothing due' : `${doneToday} of ${todayTasks.length} done`}
        </span>
      </div>

      <div className="nx-home__list nx-home__list--grow">
        {todayTasks.length === 0 ? (
          <div className="nx-home__hint nx-type-data">
            Nothing dated today. A checkbox on any page counts — write
            <span className="nx-home__code"> @{ctx.today}</span> in it to date it by hand.
          </div>
        ) : (
          todayTasks.map((task) => (
            <TaskRow
              key={`${task.pageId}:${task.blockId}`}
              task={task}
              onToggle={toggleTask}
              onReschedule={reschedule}
              onOpen={ctx.openPage}
            />
          ))
        )}
      </div>

      {overdue.length > 0 && (
        <button className="nx-home__overdue" onClick={() => ctx.goToTracker('week')}>
          <Icon shape="circle" size={12} color="var(--nx-critical)" />
          <span className="nx-home__overdue-count">{overdue.length} overdue</span>
          <span className="nx-type-data nx-home__overdue-list">
            {overdue.slice(0, 3).map((t) => t.text || 'Untitled task').join(' · ')}
          </span>
        </button>
      )}

      {/*
        Deliberately not red, and deliberately below the overdue bar. These
        were never scheduled, so nothing about them is late — they are the
        unticked lines on days that are over. Shown as a count you can go and
        look at rather than as an alarm you learn to ignore.
      */}
      {looseEnds.length > 0 && (
        <button className="nx-home__loose" onClick={() => ctx.goToTracker('week')}>
          <Icon shape="circle" size={10} color="var(--nx-text-dim)" />
          <span className="nx-type-data">
            {looseEnds.length === LOOSE_END_LIMIT ? `${LOOSE_END_LIMIT}+` : looseEnds.length} left
            open on days that have passed
          </span>
        </button>
      )}
    </>
  )
}

export function HabitsWidget({ ctx }: WidgetProps) {
  return <HabitStrips ctx={ctx} />
}

export function PinnedWidget({ ctx }: WidgetProps) {
  const pinned = useMemo(
    () =>
      ctx.pages
        .filter((p) => p.is_pinned)
        // By when the pin was made, not when the page was last touched.
        .sort((a, b) => (a.pinned_at ?? '').localeCompare(b.pinned_at ?? '')),
    [ctx.pages]
  )

  if (pinned.length === 0) {
    return (
      <div className="nx-home__hint nx-type-data">
        Nothing pinned. Hover a page in Notes and hit Pin to keep it here.
      </div>
    )
  }

  return (
    <div className="nx-home__list">
      {pinned.slice(0, SIDE_ROWS).map((page) => (
        <PageRow
          key={page.id}
          page={page}
          shape="diamond"
          meta={ctx.types.find((t) => t.id === page.type_id)?.name ?? 'Note'}
          onOpen={ctx.openPage}
          onRemove={(id) => void ctx.write.setPinned(id, false).then(ctx.reload)}
          removeTitle="Unpin"
        />
      ))}
    </div>
  )
}

/**
 * A saved view, on Home.
 *
 * The gap this closes is the whole reason Home could not replace a
 * hand-written dashboard page. Every other widget answers a question the app
 * chose — today, habits, the graph. This one answers a question *you* wrote
 * down, which is the only kind that can be about your top three goals, your
 * open positions or this week's sessions.
 *
 * It draws rows rather than borrowing `ViewLayouts`: a board inside a
 * quarter-width panel is a board nobody can read, and a list of titles is what
 * a panel this size can actually say. Clicking through goes to the view
 * itself, where the layout the view was built for lives.
 */
export function ViewWidget({ config, setConfig, ctx }: WidgetProps) {
  const viewId = typeof config.viewId === 'string' ? config.viewId : null
  const limit = typeof config.limit === 'number' ? config.limit : SIDE_ROWS
  const views = ctx.views
  const [rows, setRows] = useState<ViewRow[]>([])
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!viewId) return
    let cancelled = false
    ctx.read
      .runView(viewId, limit)
      .then((result) => {
        if (cancelled) return
        setRows(result)
        setMissing(false)
      })
      // A view deleted after it was put on Home is the ordinary case, not an
      // error worth a toast: the widget says so and offers the picker again.
      .catch(() => !cancelled && setMissing(true))
    return () => {
      cancelled = true
    }
  }, [ctx, viewId, limit, ctx.pages])

  if (!viewId || missing) {
    return (
      <div className="nx-home__pick">
        <div className="nx-home__hint nx-type-data">
          {missing ? 'That view is gone. Pick another.' : 'Which view?'}
        </div>
        {views.length === 0 ? (
          <div className="nx-home__hint nx-type-data">
            No saved views yet. Make one in Views and it will appear here.
          </div>
        ) : (
          <select
            className="nx-select"
            value=""
            onChange={(e) => e.target.value && setConfig({ ...config, viewId: e.target.value })}
          >
            <option value="">Choose a view…</option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
      </div>
    )
  }

  if (rows.length === 0) {
    return <div className="nx-home__hint nx-type-data">Nothing matches right now.</div>
  }

  return (
    <div className="nx-home__list">
      {rows.map((row) => (
        <PageRow
          key={row.id}
          page={row as unknown as PageListItem}
          shape="circle"
          meta={ctx.types.find((t) => t.id === row.type_id)?.name ?? 'Note'}
          onOpen={ctx.openPage}
        />
      ))}
    </div>
  )
}

/** The name of the view an instance is showing, for its panel header. */
export function viewWidgetTitle(config: Record<string, unknown>, views: ViewDef[]): string | null {
  const viewId = typeof config.viewId === 'string' ? config.viewId : null
  return views.find((v) => v.id === viewId)?.name ?? null
}

export function GraphWidget({ ctx }: WidgetProps) {
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] })

  // On the page *count*, not on `pages` — that is a fresh array after every
  // mutation, and GraphView restarts its simulation whenever the node list
  // changes identity, so refetching per keystroke never lets it settle.
  const pageCount = ctx.pages.length
  useEffect(() => {
    let cancelled = false
    void ctx.read.graph().then((data) => {
      if (!cancelled) setGraph(data)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount])

  return <GraphView graph={graph} height={GRAPH_HEIGHT} />
}

export function StaleWidget({ ctx }: WidgetProps) {
  const stale = useMemo(
    () =>
      ctx.pages
        // A pin says the page matters; calling it neglected in the same breath
        // is noise, so a pinned page is never stale.
        .filter((p) => !p.is_pinned && isOlderThan(p.updated_at, STALE_DAYS))
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at)),
    [ctx.pages]
  )

  if (stale.length === 0) {
    return (
      <div className="nx-home__hint nx-type-data">
        Nothing has gone quiet for {STALE_DAYS} days.
      </div>
    )
  }

  return (
    <div className="nx-home__list">
      {stale.slice(0, 5).map((page) => (
        <PageRow
          key={page.id}
          page={page}
          shape="circle"
          meta={relativeTime(page.updated_at)}
          onOpen={ctx.openPage}
        />
      ))}
    </div>
  )
}

export function StatsWidget({ ctx }: WidgetProps) {
  const [storage, setStorage] = useState<StorageStats | null>(null)
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] })

  const pageCount = ctx.pages.length
  useEffect(() => {
    let cancelled = false
    void Promise.all([ctx.read.storage(), ctx.read.graph()]).then(([s, g]) => {
      if (cancelled) return
      setStorage(s)
      setGraph(g)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount])

  if (!storage) return null

  return (
    <div className="nx-home__stats">
      <Stat value={String(storage.pageCount)} label="pages" />
      <Stat value={String(graph.edges.length)} label="links" />
      <Stat value={String(storage.openTaskCount)} label="tasks open" />
      <Stat value={formatBytes(storage.dbSizeBytes)} label="on disk" />
    </div>
  )
}

export { STRIP_DAYS }
