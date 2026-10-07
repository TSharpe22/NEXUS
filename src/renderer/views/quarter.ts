import type { DatedPage, TrackerTask } from '@shared/types'
import { addDays, fromISO, isoWeek, startOfWeek } from '@shared/date-range'
import { localDateISO } from '@shared/journal-date'
import { isWeekItem } from './week'

/**
 * What a quarter is made of, read as its weeks: Tracker → Quarter draws one
 * row per week, and these are the rules for what lands on which row.
 */

export interface QuarterWeek {
  /** The week's Monday, `YYYY-MM-DD`. */
  monday: string
  sunday: string
  isoWeek: number
  /** The page written for the week, when there is one. */
  weekPage: DatedPage | null
  /** Logs by type name: how many, and how many of them are ticked done. */
  logs: Map<string, { total: number; done: number; checkable: boolean }>
  /** The quarter's milestones falling due this week. */
  milestones: TrackerTask[]
  /**
   * Every other task due in the week: done of total. A week's own plan items
   * are the week's, not Monday's (see `isWeekItem`), and are not counted.
   */
  tasks: { total: number; done: number }
}

/** The Mondays of every week that overlaps `from`…`to` — 13 or 14 a quarter. */
export function weeksOverlapping(from: string, to: string): { monday: string; sunday: string }[] {
  const weeks: { monday: string; sunday: string }[] = []
  const last = fromISO(to)
  for (let d = startOfWeek(fromISO(from)); d <= last; d = addDays(d, 7)) {
    weeks.push({ monday: localDateISO(d), sunday: localDateISO(addDays(d, 6)) })
  }
  return weeks
}

/**
 * The quarter as week rows.
 *
 * Week pages are the plan's own rows, not logs, so they never count in the
 * strip. A milestone is a task on the quarter page that carries its own
 * `@date`; the page has no date for anything to inherit (see
 * `ensureQuarterSetup`), so every dated task there is one.
 */
export function quarterWeeks(
  from: string,
  to: string,
  pages: DatedPage[],
  tasks: TrackerTask[],
  quarterPageId: string | null
): QuarterWeek[] {
  const rows = weeksOverlapping(from, to).map(
    ({ monday, sunday }): QuarterWeek => ({
      monday,
      sunday,
      isoWeek: isoWeek(fromISO(monday)),
      weekPage: null,
      logs: new Map(),
      milestones: [],
      tasks: { total: 0, done: 0 }
    })
  )
  const rowFor = (date: string) => rows.find((r) => date >= r.monday && date <= r.sunday)

  for (const page of pages) {
    const row = rowFor(page.date)
    if (!row) continue
    if (page.typeName === 'Week') {
      if (page.date === row.monday) row.weekPage = page
      continue
    }
    const name = page.typeName ?? 'Note'
    const entry = row.logs.get(name) ?? { total: 0, done: 0, checkable: false }
    entry.total++
    if (page.done !== null) entry.checkable = true
    if (page.done) entry.done++
    row.logs.set(name, entry)
  }

  for (const task of tasks) {
    if (!task.dueDate) continue
    const row = rowFor(task.dueDate)
    if (!row) continue
    if (quarterPageId && task.pageId === quarterPageId) {
      row.milestones.push(task)
    } else if (!isWeekItem(task, row.weekPage?.pageId ?? null)) {
      row.tasks.total++
      if (task.isDone) row.tasks.done++
    }
  }
  return rows
}

/** Every log type seen across the quarter, in a stable order, for the strip's columns. */
export function logTypes(weeks: QuarterWeek[]): string[] {
  const names = new Set<string>()
  for (const week of weeks) for (const name of week.logs.keys()) names.add(name)
  return [...names].sort((a, b) => a.localeCompare(b))
}
