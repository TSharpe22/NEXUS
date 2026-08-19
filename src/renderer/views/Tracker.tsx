import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TrackerTask, DatedPage } from '@shared/types'
import { rangeFor, eachDay, dayLabel, monthLabel, isToday, type RangeKind } from '@shared/date-range'
import { localDateISO } from '@shared/journal-date'
import { useAppStore } from '../store/app-store'
import { Panel } from '../design/Panel'
import { EmptyState } from '../design/EmptyState'
import { Icon } from '../design/Icon'
import { HabitGrid } from './HabitGrid'
import './Tracker.css'

/**
 * The tracker: what is due, in a window of time.
 *
 * Deliberately thin. Everything it shows is a query over `tasks` (the
 * projection of every checkbox block) and over pages carrying a `date`
 * property — there is no tracker-specific storage, and nothing here is the
 * only home for anything the user typed.
 */

type Mode = RangeKind | 'habits'

const MODE_LABELS: Record<Mode, string> = {
  week: 'Week',
  quarter: 'Quarter',
  habits: 'Habits'
}

interface DayBucket {
  date: string
  tasks: TrackerTask[]
  pages: DatedPage[]
}

function bucketByDay(dates: string[], tasks: TrackerTask[], pages: DatedPage[]): DayBucket[] {
  const buckets = new Map<string, DayBucket>()
  for (const date of dates) buckets.set(date, { date, tasks: [], pages: [] })

  for (const task of tasks) {
    if (task.dueDate) buckets.get(task.dueDate)?.tasks.push(task)
  }
  for (const page of pages) {
    buckets.get(page.date)?.pages.push(page)
  }
  return [...buckets.values()]
}

function TaskRow({
  task,
  onToggle,
  onOpen
}: {
  task: TrackerTask
  onToggle: (task: TrackerTask) => void
  onOpen: (pageId: string) => void
}) {
  return (
    <div className={`nx-tracker__task ${task.isDone ? 'nx-tracker__task--done' : ''}`}>
      <button
        className="nx-tracker__check"
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
      <span className="nx-tracker__task-text">{task.text || 'Untitled task'}</span>
      <button className="nx-tracker__source nx-type-data" onClick={() => onOpen(task.pageId)}>
        {task.pageTitle || 'Untitled'}
      </button>
    </div>
  )
}

function PageRow({ page, onOpen }: { page: DatedPage; onOpen: (pageId: string) => void }) {
  return (
    <button className="nx-tracker__page" onClick={() => onOpen(page.pageId)}>
      <Icon shape="diamond" size={11} color="var(--nx-text-dim)" />
      <span className="nx-tracker__page-title">{page.pageTitle || 'Untitled'}</span>
      <span className="nx-tracker__page-meta nx-type-data">
        {page.typeName ? `${page.typeName} · ` : ''}
        {page.propertyKey}
      </span>
    </button>
  )
}

export function Tracker() {
  const openPage = useAppStore((s) => s.openPage)
  const patchPage = useAppStore((s) => s.patchPage)

  // The two date windows plus the year grid. Habits are not a range — they
  // are a whole year at a glance — so they sit alongside `RangeKind` rather
  // than inside it.
  const [mode, setMode] = useState<Mode>('week')
  const kind: RangeKind = mode === 'quarter' ? 'quarter' : 'week'
  const [offset, setOffset] = useState(0)
  const [tasks, setTasks] = useState<TrackerTask[]>([])
  const [pages, setPages] = useState<DatedPage[]>([])
  const [overdue, setOverdue] = useState<TrackerTask[]>([])
  const [undated, setUndated] = useState<TrackerTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Recomputed per render rather than held in state: the window is derived
  // from today, and a cached one would go stale over midnight.
  const range = useMemo(() => rangeFor(kind, offset), [kind, offset])
  const today = localDateISO()

  const load = useCallback(async () => {
    if (mode === 'habits') {
      setLoading(false)
      return
    }
    try {
      const [rangeTasks, rangePages, before, none] = await Promise.all([
        window.api.tasks.inRange(range.from, range.to),
        window.api.tasks.datedPages(range.from, range.to),
        window.api.tasks.overdue(today),
        window.api.tasks.undated()
      ])
      setTasks(rangeTasks)
      setPages(rangePages)
      setOverdue(before)
      setUndated(none)
      setError(null)
    } catch (e) {
      console.error('[nexus] could not load the tracker', e)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [mode, range.from, range.to, today])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Ticking a task off here writes back into its block, and the page it
   * returns replaces the store's copy.
   *
   * That last part is not optional: the editor reads its initial document
   * from the store, so a stale copy would be handed back to BlockNote the
   * next time the page is opened and then saved over this change on the
   * first keystroke.
   */
  const toggle = async (task: TrackerTask) => {
    try {
      const page = await window.api.tasks.setDone(task.pageId, task.blockId, !task.isDone)
      patchPage(page.id, { content: page.content, updated_at: page.updated_at })
      await load()
    } catch (e) {
      console.error('[nexus] could not update the task', e)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const days = useMemo(() => eachDay(range.from, range.to), [range.from, range.to])
  const buckets = useMemo(() => bucketByDay(days, tasks, pages), [days, tasks, pages])

  // A week shows every day, empty ones included — the shape of the week is
  // part of what you are reading. A quarter is ninety days, so there only the
  // days carrying something are worth a row.
  const visible = kind === 'week' ? buckets : buckets.filter((b) => b.tasks.length + b.pages.length > 0)

  const openCount = tasks.filter((t) => !t.isDone).length
  const doneCount = tasks.length - openCount
  const isCurrent = offset === 0

  const stepper = (
    <div className="nx-tracker__stepper">
      <button className="nx-tracker__step" onClick={() => setOffset(offset - 1)} title="Previous">
        ‹
      </button>
      <button
        className="nx-tracker__step"
        onClick={() => setOffset(0)}
        disabled={isCurrent}
        title={kind === 'week' ? 'This week' : 'This quarter'}
      >
        {kind === 'week' ? 'This week' : 'This quarter'}
      </button>
      <button className="nx-tracker__step" onClick={() => setOffset(offset + 1)} title="Next">
        ›
      </button>
    </div>
  )

  return (
    <div className="nx-tracker">
      <div className="nx-tracker__bar">
        <div className="nx-tracker__modes">
          {(['week', 'quarter', 'habits'] as Mode[]).map((option) => (
            <button
              key={option}
              className={`nx-tracker__mode ${mode === option ? 'nx-tracker__mode--active' : ''}`}
              onClick={() => {
                setMode(option)
                setOffset(0)
              }}
            >
              {MODE_LABELS[option]}
            </button>
          ))}
        </div>
        {/* The grid carries its own year stepper — one set of arrows meaning
            two different things would be worse than none. */}
        {mode !== 'habits' && stepper}
      </div>

      {mode !== 'habits' && (
        <div className="nx-tracker__head">
          <div className="nx-type-heading">{range.label}</div>
          <div className="nx-tracker__counts nx-type-data">
            {loading ? 'loading…' : `${openCount} open · ${doneCount} done`}
          </div>
        </div>
      )}

      {error && (
        <Panel error title="Tracker">
          <div className="nx-tracker__error nx-type-data">{error}</div>
        </Panel>
      )}

      {mode === 'habits' ? (
        <HabitGrid onOpen={openPage} />
      ) : (
        <>
        {isCurrent && overdue.length > 0 && (
          <Panel title={`Overdue · ${overdue.length}`} className="nx-tracker__overdue">
            {overdue.map((task) => (
              <TaskRow key={`${task.pageId}:${task.blockId}`} task={task} onToggle={toggle} onOpen={openPage} />
            ))}
          </Panel>
        )}

        <Panel dense flush>
          {!loading && visible.length === 0 ? (
            <EmptyState
              text={kind === 'week' ? 'Nothing due this week' : 'Nothing due this quarter'}
              meta={`${range.from} → ${range.to}`}
            />
          ) : (
            visible.map((bucket, index) => {
              const showMonth =
                kind === 'quarter' &&
                (index === 0 || monthLabel(visible[index - 1].date) !== monthLabel(bucket.date))
              return (
                <div key={bucket.date}>
                  {showMonth && <div className="nx-tracker__month nx-type-label">{monthLabel(bucket.date)}</div>}
                  <div className={`nx-tracker__day ${isToday(bucket.date) ? 'nx-tracker__day--today' : ''}`}>
                    <div className="nx-tracker__day-label nx-type-data">
                      {dayLabel(bucket.date)}
                      {isToday(bucket.date) && <span className="nx-tracker__today">today</span>}
                    </div>
                    <div className="nx-tracker__day-body">
                      {bucket.tasks.length + bucket.pages.length === 0 ? (
                        <div className="nx-tracker__blank nx-type-data">—</div>
                      ) : (
                        <>
                          {bucket.tasks.map((task) => (
                            <TaskRow
                              key={`${task.pageId}:${task.blockId}`}
                              task={task}
                              onToggle={toggle}
                              onOpen={openPage}
                            />
                          ))}
                          {bucket.pages.map((page) => (
                            <PageRow key={`${page.pageId}:${page.propertyKey}`} page={page} onOpen={openPage} />
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </Panel>

        {/* A todo typed into an ordinary note has no date anywhere, and a
            date-scoped view would otherwise swallow it without a trace. */}
        {isCurrent && undated.length > 0 && (
          <Panel title={`No date · ${undated.length}`}>
            {undated.map((task) => (
              <TaskRow key={`${task.pageId}:${task.blockId}`} task={task} onToggle={toggle} onOpen={openPage} />
            ))}
          </Panel>
        )}
        </>
      )}
    </div>
  )
}
