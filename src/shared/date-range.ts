/**
 * The date windows the tracker scopes to.
 *
 * All of it works in local time and in `YYYY-MM-DD`, the same format the
 * `date` property stores and the `@2026-08-20` token is written in — which is
 * what lets the queries compare dates as plain strings. `toISOString()` is
 * never used here: it is UTC, and an evening in a western timezone would file
 * under tomorrow (the journal's own date helper avoids it for the same
 * reason).
 */

import { localDateISO } from './journal-date'

export type RangeKind = 'week' | 'quarter'

export interface DateRange {
  kind: RangeKind
  /** Inclusive, `YYYY-MM-DD`. */
  from: string
  /** Inclusive, `YYYY-MM-DD`. */
  to: string
  /** What the header reads, e.g. "17 – 23 Aug 2026" or "Q3 2026". */
  label: string
  /** Zero when the window contains today, negative in the past. */
  offset: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Parse `YYYY-MM-DD` as a local date, never as UTC midnight. */
export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** The Monday of the week `d` falls in. Weeks start on Monday, not Sunday. */
export function startOfWeek(d: Date): Date {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  // getDay() is Sunday-based, so Sunday has to reach back six days, not none.
  const offset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - offset)
  return start
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  next.setDate(next.getDate() + days)
  return next
}

/** Every date from `from` to `to` inclusive, as ISO strings. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = []
  const end = fromISO(to)
  for (let d = fromISO(from); d <= end; d = addDays(d, 1)) days.push(localDateISO(d))
  return days
}

export function dayLabel(iso: string): string {
  const d = fromISO(iso)
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function monthLabel(iso: string): string {
  const d = fromISO(iso)
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * The week or quarter `offset` steps from the one holding `today`.
 *
 * Offsets rather than a cursor date, so stepping forward and back always
 * lands on the same windows — adding a week to a date can otherwise drift
 * across a month boundary and never come back.
 */
export function rangeFor(kind: RangeKind, offset: number, today = new Date()): DateRange {
  if (kind === 'week') {
    const start = addDays(startOfWeek(today), offset * 7)
    const end = addDays(start, 6)
    const sameMonth = start.getMonth() === end.getMonth()
    const label = sameMonth
      ? `${start.getDate()} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
      : `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`
    return { kind, from: localDateISO(start), to: localDateISO(end), label, offset }
  }

  const quarterIndex = Math.floor(today.getMonth() / 3) + offset
  const year = today.getFullYear() + Math.floor(quarterIndex / 4)
  // A negative index has to wrap up into the previous year, and JS's % keeps
  // the sign of the dividend, so -1 % 4 is -1 rather than 3.
  const quarter = ((quarterIndex % 4) + 4) % 4
  const start = new Date(year, quarter * 3, 1)
  const end = new Date(year, quarter * 3 + 3, 0)
  return {
    kind,
    from: localDateISO(start),
    to: localDateISO(end),
    label: `Q${quarter + 1} ${year}`,
    offset
  }
}

/** Whether `iso` is today, in local time. */
export function isToday(iso: string, today = new Date()): boolean {
  return iso === localDateISO(today)
}
