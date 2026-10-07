import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TrackerTask, DatedPage, Page } from '@shared/types'
import { sectionLines } from '@shared/document'
import type { CalendarEvent } from '@shared/calendar'
import { eventTime, eventTooltip, openEventLink } from './calendar-format'
import { rangeFor, eachDay, dayLabel, monthLabel, fromISO, type RangeKind } from '@shared/date-range'
import { useAppStore, useToday, type TrackerMode } from '../store/app-store'
import { Panel } from '../design/Panel'
import { EmptyState } from '../design/EmptyState'
import { Icon } from '../design/Icon'
import { DueDate } from '../design/DueDate'
import { Button } from '../design/Button'
import { HabitGrid } from './HabitGrid'
import { isWeekItem as belongsToWeek, loggedByType } from './week'
import './Tracker.css'

/**
 * The tracker: what is due, in a window of time.
 *
 * Deliberately thin. Everything it shows is a query over `tasks` (the
 * projection of every checkbox block) and over pages carrying a `date`
 * property — there is no tracker-specific storage, and nothing here is the
 * only home for anything the user typed.
 */

type Mode = TrackerMode

const MODE_LABELS: Record<Mode, string> = {
  week: 'Week',
  quarter: 'Quarter',
  habits: 'Habits'
}

interface DayBucket {
  date: string
  events: CalendarEvent[]
  tasks: TrackerTask[]
  pages: DatedPage[]
}

function bucketByDay(
  dates: string[],
  tasks: TrackerTask[],
  pages: DatedPage[],
  events: CalendarEvent[]
): DayBucket[] {
  const buckets = new Map<string, DayBucket>()
  for (const date of dates) buckets.set(date, { date, events: [], tasks: [], pages: [] })
  for (const event of events) {
    for (const day of event.days) buckets.get(day)?.events.push(event)
  }

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
  onReschedule,
  onOpen,
  inPlan = false
}: {
  task: TrackerTask
  onToggle: (task: TrackerTask) => void
  onReschedule: (task: TrackerTask, due: string | null) => Promise<void>
  onOpen: (pageId: string) => void
  /**
   * Drawn inside the week's plan: the Monday it inherits from the week page
   * is not a date anyone gave it, and the page it comes from is the plan it
   * is already sitting in — so neither is shown. Giving it a date moves it
   * onto that day.
   */
  inPlan?: boolean
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
      <DueDate
        task={inPlan ? { ...task, dueDate: null, dueDateSource: null } : task}
        onChange={(due) => onReschedule(task, due)}
      />
      {!inPlan && (
        <button className="nx-tracker__source nx-type-data" onClick={() => onOpen(task.pageId)}>
          {task.pageTitle || 'Untitled'}
        </button>
      )}
    </div>
  )
}

/** A calendar event on its day: time, title, and which calendar it came from. */
function EventRow({ event, day }: { event: CalendarEvent; day: string }) {
  return (
    <button
      className={`nx-tracker__event ${event.link ? 'nx-tracker__event--link' : ''}`}
      title={eventTooltip(event)}
      onClick={() => openEventLink(event)}
    >
      <Icon shape="circle" size={9} color={event.allDay ? 'var(--nx-accent)' : 'var(--nx-text-dim)'} />
      <span className="nx-tracker__event-time nx-type-data">{event.allDay ? 'all day' : eventTime(event, day)}</span>
      <span className="nx-tracker__event-title">{event.title}</span>
      <span className="nx-tracker__page-meta nx-type-data">{event.feedName}</span>
    </button>
  )
}

function PageRow({ page, onOpen }: { page: DatedPage; onOpen: (pageId: string) => void }) {
  // A log with a `done` box says whether it happened: filled when it did,
  // the same mark a ticked task carries.
  return (
    <button
      className={`nx-tracker__page ${page.done === false ? 'nx-tracker__page--undone' : ''}`}
      onClick={() => onOpen(page.pageId)}
      title={page.done === null ? undefined : page.done ? 'Done' : 'Not done'}
    >
      <Icon
        shape="diamond"
        size={11}
        filled={page.done === true}
        color={page.done === true ? 'var(--nx-accent)' : 'var(--nx-text-dim)'}
      />
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
  const openWeek = useAppStore((s) => s.openWeek)

  // The two date windows plus the year grid. Habits are not a range — they
  // are a whole year at a glance — so they sit alongside `RangeKind` rather
  // than inside it.
  // Held in the store so Home can link straight to Habits.
  const mode = useAppStore((s) => s.trackerMode)
  const setMode = useAppStore((s) => s.setTrackerMode)
  const kind: RangeKind = mode === 'quarter' ? 'quarter' : 'week'
  const [offset, setOffset] = useState(0)
  const [tasks, setTasks] = useState<TrackerTask[]>([])
  const [pages, setPages] = useState<DatedPage[]>([])
  const [overdue, setOverdue] = useState<TrackerTask[]>([])
  const [undated, setUndated] = useState<TrackerTask[]>([])
  const [looseEnds, setLooseEnds] = useState<TrackerTask[]>([])
  /** The page written for the week on screen, when there is one. */
  const [weekPage, setWeekPage] = useState<Page | null>(null)
  /** Calendar events, week view only — a quarter of them would bury the tasks. */
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Recomputed per render rather than held in state: the window is derived
  // from today, and a cached one would go stale over midnight.
  const today = useToday()
  // The window is anchored to the logical day too, so the week does not turn
  // over at midnight while you are still working in it.
  const range = useMemo(() => rangeFor(kind, offset, fromISO(today)), [kind, offset, today])

  const load = useCallback(async () => {
    if (mode === 'habits') {
      setLoading(false)
      return
    }
    try {
      const [rangeTasks, rangePages, before, none, loose, week, calendar] = await Promise.all([
        window.api.tasks.inRange(range.from, range.to),
        window.api.tasks.datedPages(range.from, range.to),
        window.api.tasks.overdue(today),
        window.api.tasks.undated(),
        window.api.tasks.looseEnds(today),
        kind === 'week' ? window.api.week.peek(range.from) : Promise.resolve(null),
        // A calendar that cannot be read must not take the tracker down with it.
        kind === 'week'
          ? window.api.calendar.events(range.from, range.to).catch(() => ({ events: [], errors: [] }))
          : Promise.resolve({ events: [], errors: [] })
      ])
      setWeekPage(week)
      setEvents(calendar.events)
      setTasks(rangeTasks)
      setPages(rangePages)
      setOverdue(before)
      setUndated(none)
      setLooseEnds(loose)
      setError(null)
    } catch (e) {
      console.error('[nexus] could not load the tracker', e)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [mode, kind, range.from, range.to, today])

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

  /**
   * Move a task to another day from wherever it is showing.
   *
   * Same contract as `toggle`: the write goes into the block, and the page it
   * hands back replaces the store's copy so the editor cannot later save a
   * pre-reschedule document over it.
   */
  const reschedule = async (task: TrackerTask, due: string | null) => {
    try {
      const page = await window.api.tasks.setDue(task.pageId, task.blockId, due)
      patchPage(page.id, { content: page.content, updated_at: page.updated_at })
      await load()
    } catch (e) {
      console.error('[nexus] could not reschedule the task', e)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // Plan items are drawn in the plan, not on Monday — see `week.ts`.
  const weekId = weekPage?.id ?? null
  const isWeekItem = useCallback((t: TrackerTask) => belongsToWeek(t, weekId), [weekId])
  const planTasks = useMemo(() => tasks.filter(isWeekItem), [tasks, isWeekItem])
  const dayTasks = useMemo(() => tasks.filter((t) => !isWeekItem(t)), [tasks, isWeekItem])
  const dayPages = useMemo(() => pages.filter((p) => p.pageId !== weekId), [pages, weekId])
  const planLines = useMemo(() => sectionLines(weekPage?.content ?? null, 'Plan'), [weekPage])
  const logged = useMemo(() => loggedByType(dayPages), [dayPages])
  // Only this week's page can be "left open" too early; a past week's
  // unfinished plan items are left open for real.
  const shownLooseEnds = useMemo(() => looseEnds.filter((t) => !isWeekItem(t)), [looseEnds, isWeekItem])

  const days = useMemo(() => eachDay(range.from, range.to), [range.from, range.to])
  const buckets = useMemo(
    () => bucketByDay(days, dayTasks, dayPages, events),
    [days, dayTasks, dayPages, events]
  )

  // A week shows every day, empty ones included — the shape of the week is
  // part of what you are reading. A quarter is ninety days, so there only the
  // days carrying something are worth a row.
  const visible =
    kind === 'week' ? buckets : buckets.filter((b) => b.tasks.length + b.pages.length + b.events.length > 0)

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
              <TaskRow
                key={`${task.pageId}:${task.blockId}`}
                task={task}
                onToggle={toggle}
                onReschedule={reschedule}
                onOpen={openPage}
              />
            ))}
          </Panel>
        )}

        {kind === 'week' && !loading && (
          <Panel
            title="Plan"
            className="nx-tracker__plan"
            actions={
              weekPage ? (
                <Button variant="ghost" onClick={() => void openPage(weekPage.id)}>
                  Open week
                </Button>
              ) : null
            }
          >
            <div className="nx-tracker__plan-body">
              {weekPage ? (
                planLines.length + planTasks.length === 0 ? (
                  <div className="nx-tracker__blank nx-type-data">Nothing written under Plan yet.</div>
                ) : (
                  <>
                    {planLines.map((line, i) => (
                      <div key={i} className="nx-tracker__plan-line">
                        {line}
                      </div>
                    ))}
                    {planTasks.map((task) => (
                      <TaskRow
                        key={`${task.pageId}:${task.blockId}`}
                        task={task}
                        onToggle={toggle}
                        onReschedule={reschedule}
                        onOpen={openPage}
                        inPlan
                      />
                    ))}
                  </>
                )
              ) : offset === 0 || offset === 1 ? (
                // This week, or the next one at a review held before it starts.
                // Never further ahead: weeks are planned as they come.
                <div className="nx-tracker__plan-empty">
                  <span className="nx-type-data">
                    {offset === 0 ? 'No plan for this week yet.' : 'No plan for next week yet.'}
                  </span>
                  <Button onClick={() => void openWeek(range.from)}>
                    {offset === 0 ? 'Plan this week' : 'Plan next week'}
                  </Button>
                </div>
              ) : (
                <div className="nx-tracker__blank nx-type-data">
                  {offset < 0 ? 'No plan was written for this week.' : 'Weeks are planned as they come.'}
                </div>
              )}
              {logged.length > 0 && (
                <div className="nx-tracker__logged nx-type-data">
                  <span className="nx-tracker__logged-label">Logged</span>
                  {logged.map((l) => (
                    <span key={l.name}>
                      {l.name} {l.text}
                    </span>
                  ))}
                </div>
              )}
            </div>
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
                  <div className={`nx-tracker__day ${bucket.date === today ? 'nx-tracker__day--today' : ''}`}>
                    <div className="nx-tracker__day-label nx-type-data">
                      {dayLabel(bucket.date)}
                      {bucket.date === today && <span className="nx-tracker__today">today</span>}
                    </div>
                    <div className="nx-tracker__day-body">
                      {bucket.tasks.length + bucket.pages.length + bucket.events.length === 0 ? (
                        <div className="nx-tracker__blank nx-type-data">—</div>
                      ) : (
                        <>
                          {bucket.events.map((event) => (
                            <EventRow key={event.id} event={event} day={bucket.date} />
                          ))}
                          {bucket.tasks.map((task) => (
                            <TaskRow
                              key={`${task.pageId}:${task.blockId}`}
                              task={task}
                              onToggle={toggle}
                              onReschedule={reschedule}
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

        {/* Open lines on days that are over. Not overdue — nothing here was
            ever scheduled — so this sits below the window rather than above
            it, and carries no colour. */}
        {isCurrent && shownLooseEnds.length > 0 && (
          <Panel title={`Left open · ${shownLooseEnds.length}`}>
            {shownLooseEnds.map((task) => (
              <TaskRow
                key={`${task.pageId}:${task.blockId}`}
                task={task}
                onToggle={toggle}
                onReschedule={reschedule}
                onOpen={openPage}
              />
            ))}
          </Panel>
        )}

        {/* A todo typed into an ordinary note has no date anywhere, and a
            date-scoped view would otherwise swallow it without a trace. */}
        {isCurrent && undated.length > 0 && (
          <Panel title={`No date · ${undated.length}`}>
            {undated.map((task) => (
              <TaskRow
                key={`${task.pageId}:${task.blockId}`}
                task={task}
                onToggle={toggle}
                onReschedule={reschedule}
                onOpen={openPage}
              />
            ))}
          </Panel>
        )}
        </>
      )}
    </div>
  )
}
