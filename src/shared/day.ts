/**
 * When a day starts.
 *
 * Everything dated in Nexus used calendar midnight, which is not when a day
 * ends for anyone who is still awake at 1am. Write a task at 11pm and by 1am
 * it had rolled over: "Today's entry" opened a *new* page instead of the one
 * you had been writing in all evening, the tracker moved its `today` marker,
 * and the task you had just written was already overdue. None of that is
 * about the task — it is about the clock.
 *
 * So there is one setting, an hour, and one rule: before that hour, it is
 * still yesterday. It is deliberately a single number rather than a per-view
 * preference, because the bug was the three views disagreeing with the person
 * using them, and three separate settings would just let them disagree with
 * each other too.
 *
 * Shared between processes: the main process names the journal entry, the
 * renderer decides which row is today, and they must not drift.
 */

import { localDateISO } from './journal-date'

/**
 * 4am. Late enough to cover an ordinary late night, early enough that nobody
 * waking up at 5 finds themselves still filing under yesterday.
 */
export const DEFAULT_DAY_START_HOUR = 4

/** Clamp anything stored or typed into a real hour of the day. */
export function normaliseDayStartHour(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_DAY_START_HOUR
  return Math.min(23, Math.max(0, Math.floor(n)))
}

/**
 * The date `now` belongs to, given a day that starts at `startHour`.
 *
 * Returns a `Date` at local midnight of that day, so callers that need a
 * weekday, a week or a label can use it directly rather than re-parsing.
 */
export function logicalDate(startHour: number, now: Date = new Date()): Date {
  const hour = normaliseDayStartHour(startHour)
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (now.getHours() < hour) d.setDate(d.getDate() - 1)
  return d
}

/** The same, as the `YYYY-MM-DD` every date in the vault is stored in. */
export function logicalDateISO(startHour: number, now: Date = new Date()): string {
  return localDateISO(logicalDate(startHour, now))
}

/**
 * How the setting reads back to the user, e.g. "4am" — used in Settings and
 * anywhere a view needs to explain why it thinks it is still yesterday.
 */
export function dayStartLabel(startHour: number): string {
  const h = normaliseDayStartHour(startHour)
  if (h === 0) return 'midnight'
  if (h === 12) return 'noon'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}
