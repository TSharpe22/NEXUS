import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TrackerTask, DatedPage, Page } from '@shared/types'
import { documentSections, sectionLines } from '@shared/document'
import type { CalendarEvent } from '@shared/calendar'
import { eventTime, eventTooltip, openEventLink } from './calendar-format'
import { rangeFor, eachDay, dayLabel, fromISO, type RangeKind } from '@shared/date-range'
import { useAppStore, useToday, type TrackerMode } from '../store/app-store'
import { Panel } from '../design/Panel'
import { EmptyState } from '../design/EmptyState'
import { Icon } from '../design/Icon'
import { DueDate } from '../design/DueDate'
import { Button } from '../design/Button'
import { HabitGrid } from './HabitGrid'
import { isWeekItem as belongsToWeek, loggedByType } from './week'
import { logTypes, quarterWeeks, weeksOverlapping, type QuarterWeek } from './quarter'
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
  inPlan = false,
  hideSource = false
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
  /** Drawn on its own page's panel (a quarter's milestones): the source is the panel. */
  hideSource?: boolean
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
      {!inPlan && !hideSource && (
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

/**
 * One line of a quarter area. `Floor: 3 sessions a week` reads as a dim
 * label and its value, and a label still waiting for its value says so
 * rather than showing a bare colon.
 */
function AreaLine({ line }: { line: string }) {
  const match = /^([A-Za-z][\w ]{0,20}):\s*(.*)$/.exec(line)
  if (!match) return <div className="nx-quarter__line">{line}</div>
  return (
    <div className="nx-quarter__line">
      <span className="nx-quarter__line-label nx-type-data">{match[1]}</span>
      {match[2] ? <span>{match[2]}</span> : <span className="nx-quarter__line-empty">—</span>}
    </div>
  )
}

/** `5 Oct` — a week row names its Monday. */
function shortDate(iso: string): string {
  return dayLabel(iso).split(' ').slice(1).join(' ')
}

/** A log type's count in one week: done of logged when it has a done box. */
function LogCell({ entry }: { entry: { total: number; done: number; checkable: boolean } | undefined }) {
  if (!entry) return <span className="nx-quarter__cell nx-quarter__cell--none nx-type-data">·</span>
  const full = entry.checkable ? entry.done === entry.total : true
  return (
    <span className={`nx-quarter__cell nx-type-data ${full ? 'nx-quarter__cell--full' : ''}`}>
      {entry.checkable ? `${entry.done}/${entry.total}` : entry.total}
    </span>
  )
}

/**
 * The quarter as its weeks: the week's page, what was logged by type, and
 * the milestones falling due in it. Read down a column to see a habit hold
 * or slip over thirteen weeks; read across a row to see one week whole.
 */
function QuarterWeeks({
  weeks,
  columns,
  today,
  loading,
  onOpen,
  onPlan,
  onToggle
}: {
  weeks: QuarterWeek[]
  columns: string[]
  today: string
  loading: boolean
  onOpen: (pageId: string) => void
  onPlan: (monday: string) => void
  onToggle: (task: TrackerTask) => void
}) {
  const grid = { gridTemplateColumns: `112px 64px 64px repeat(${columns.length}, 64px) minmax(0, 1fr)` }
  // Plannable: this week, or next at a review held before it starts — the
  // same two the week view offers.
  const thisMonday = weeks.find((w) => today >= w.monday && today <= w.sunday)?.monday ?? null
  return (
    <Panel dense flush className="nx-quarter__weeks">
      <div className="nx-quarter__row nx-quarter__row--head nx-type-label" style={grid}>
        <span>Week</span>
        <span>Plan</span>
        <span>Tasks</span>
        {columns.map((name) => (
          <span key={name} className="nx-quarter__col" title={name}>
            {name}
          </span>
        ))}
        <span>Milestones</span>
      </div>
      {weeks.map((week, i) => {
        const now = week.monday === thisMonday
        const ahead = week.monday > today
        const plannable = now || (thisMonday !== null && i > 0 && weeks[i - 1].monday === thisMonday)
        return (
          <div
            key={week.monday}
            className={`nx-quarter__row ${now ? 'nx-quarter__row--now' : ''} ${ahead ? 'nx-quarter__row--ahead' : ''}`}
            style={grid}
          >
            <span className="nx-quarter__week nx-type-data">
              <span className="nx-quarter__week-no">W{week.isoWeek}</span> {shortDate(week.monday)}
            </span>
            <span>
              {week.weekPage ? (
                <button className="nx-quarter__link nx-type-data" onClick={() => onOpen(week.weekPage!.pageId)}>
                  open
                </button>
              ) : plannable && !loading ? (
                <button className="nx-quarter__link nx-type-data" onClick={() => onPlan(week.monday)}>
                  plan
                </button>
              ) : (
                <span className="nx-quarter__cell--none nx-type-data">—</span>
              )}
            </span>
            <LogCell
              entry={week.tasks.total ? { ...week.tasks, checkable: true } : undefined}
            />
            {columns.map((name) => (
              <LogCell key={name} entry={week.logs.get(name)} />
            ))}
            <span className="nx-quarter__milestone-list">
              {week.milestones.map((task) => (
                <button
                  key={`${task.pageId}:${task.blockId}`}
                  className={`nx-quarter__milestone ${task.isDone ? 'nx-quarter__milestone--done' : ''}`}
                  onClick={() => onToggle(task)}
                  title={`${task.dueDate} — click to mark ${task.isDone ? 'not done' : 'done'}`}
                >
                  <Icon
                    shape="square"
                    filled={task.isDone}
                    size={11}
                    color={task.isDone ? 'var(--nx-accent)' : 'var(--nx-text-dim)'}
                  />
                  <span className="nx-quarter__milestone-text">{task.text || 'Untitled milestone'}</span>
                </button>
              ))}
            </span>
          </div>
        )
      })}
    </Panel>
  )
}

export function Tracker() {
  const openPage = useAppStore((s) => s.openPage)
  const patchPage = useAppStore((s) => s.patchPage)
  const openWeek = useAppStore((s) => s.openWeek)
  const openQuarter = useAppStore((s) => s.openQuarter)

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
  /** The quarter's page and every task in it, quarter view only. */
  const [quarterPage, setQuarterPage] = useState<Page | null>(null)
  const [quarterTasks, setQuarterTasks] = useState<TrackerTask[]>([])
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
  // A quarter is read as whole weeks, so its first and last rows reach past
  // 1 October and 31 December to their Monday and Sunday.
  const span = useMemo(() => {
    if (kind === 'week') return { from: range.from, to: range.to }
    const weeks = weeksOverlapping(range.from, range.to)
    return { from: weeks[0].monday, to: weeks[weeks.length - 1].sunday }
  }, [kind, range.from, range.to])

  const load = useCallback(async () => {
    if (mode === 'habits') {
      setLoading(false)
      return
    }
    try {
      const [rangeTasks, rangePages, before, none, loose, week, calendar, quarter] = await Promise.all([
        window.api.tasks.inRange(span.from, span.to),
        window.api.tasks.datedPages(span.from, span.to),
        window.api.tasks.overdue(today),
        window.api.tasks.undated(),
        window.api.tasks.looseEnds(today),
        kind === 'week' ? window.api.week.peek(range.from) : Promise.resolve(null),
        // A calendar that cannot be read must not take the tracker down with it.
        kind === 'week'
          ? window.api.calendar.events(range.from, range.to).catch(() => ({ events: [], errors: [] }))
          : Promise.resolve({ events: [], errors: [] }),
        kind === 'quarter' ? window.api.quarter.peek(range.from) : Promise.resolve(null)
      ])
      setQuarterPage(quarter)
      setQuarterTasks(quarter ? await window.api.tasks.forPage(quarter.id) : [])
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
  }, [mode, kind, range.from, range.to, span.from, span.to, today])

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

  const quarterId = quarterPage?.id ?? null
  const areas = useMemo(
    () => documentSections(quarterPage?.content ?? null).filter((a) => a.heading.toLowerCase() !== 'milestones'),
    [quarterPage]
  )
  const weekRows = useMemo(
    () => (kind === 'quarter' ? quarterWeeks(range.from, range.to, pages, tasks, quarterId) : []),
    [kind, range.from, range.to, pages, tasks, quarterId]
  )
  const columns = useMemo(() => logTypes(weekRows), [weekRows])
  // Milestones by date, then the quarter's undated lines after them.
  const shownQuarterTasks = useMemo(
    () =>
      [...quarterTasks].sort((a, b) =>
        a.dueDate && b.dueDate ? a.dueDate.localeCompare(b.dueDate) : a.dueDate ? -1 : b.dueDate ? 1 : 0
      ),
    [quarterTasks]
  )

  const days = useMemo(() => eachDay(range.from, range.to), [range.from, range.to])
  const buckets = useMemo(
    () => bucketByDay(days, dayTasks, dayPages, events),
    [days, dayTasks, dayPages, events]
  )

  // A week shows every day, empty ones included — the shape of the week is
  // part of what you are reading. A quarter is read as its weeks instead.

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

        {kind === 'quarter' && !loading && (
          <Panel
            title="Quarter"
            className="nx-tracker__plan"
            actions={
              quarterPage ? (
                <Button variant="ghost" onClick={() => void openPage(quarterPage.id)}>
                  Open quarter
                </Button>
              ) : null
            }
          >
            <div className="nx-tracker__plan-body">
              {quarterPage ? (
                <>
                  {areas.length === 0 ? (
                    <div className="nx-tracker__blank nx-type-data">No areas written yet.</div>
                  ) : (
                    <div className="nx-quarter__areas">
                      {areas.map((area, i) => (
                        <div key={i} className="nx-quarter__area">
                          <div className="nx-quarter__area-name">{area.heading || 'Untitled'}</div>
                          {area.lines.length === 0 ? (
                            <div className="nx-quarter__line-empty nx-type-data">Nothing written yet.</div>
                          ) : (
                            area.lines.map((line, j) => <AreaLine key={j} line={line} />)
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {shownQuarterTasks.length > 0 && (
                    <div className="nx-quarter__milestones">
                      <div className="nx-type-label">Milestones</div>
                      {shownQuarterTasks.map((task) => (
                        <TaskRow
                          key={`${task.pageId}:${task.blockId}`}
                          task={task}
                          onToggle={toggle}
                          onReschedule={reschedule}
                          onOpen={openPage}
                          hideSource
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : offset === 0 || offset === 1 ? (
                <div className="nx-tracker__plan-empty">
                  <span className="nx-type-data">
                    {offset === 0 ? 'No plan for this quarter yet.' : 'No plan for next quarter yet.'}
                  </span>
                  <Button onClick={() => void openQuarter(range.from)}>
                    {offset === 0 ? 'Plan this quarter' : 'Plan next quarter'}
                  </Button>
                </div>
              ) : (
                <div className="nx-tracker__blank nx-type-data">
                  {offset < 0 ? 'No plan was written for this quarter.' : 'Quarters are planned as they come.'}
                </div>
              )}
            </div>
          </Panel>
        )}

        {kind === 'quarter' ? (
          <QuarterWeeks
            weeks={weekRows}
            columns={columns}
            today={today}
            loading={loading}
            onOpen={openPage}
            onPlan={(monday) => void openWeek(monday)}
            onToggle={toggle}
          />
        ) : (
        <Panel dense flush>
          {!loading && buckets.length === 0 ? (
            <EmptyState text="Nothing due this week" meta={`${range.from} → ${range.to}`} />
          ) : (
            buckets.map((bucket) => {
              return (
                <div key={bucket.date}>
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
        )}

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
