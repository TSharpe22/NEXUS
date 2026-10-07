import ICAL from 'ical.js'
import type { CalendarEvent } from '@shared/calendar'

/**
 * An ICS document, expanded into the occurrences that fall inside a window.
 *
 * Kept free of any `electron` import so the checks can run it against a
 * fixture directly. `ical.js` does the hard parts — recurrence rules, EXDATE,
 * moved occurrences (RECURRENCE-ID) and any VTIMEZONE the feed carries. What
 * is here is the glue, and one fallback: a TZID the feed names but does not
 * define is resolved through `Intl` rather than being read as local time,
 * which would put every event in another zone hours out.
 */

/** A recurrence with no end has to stop somewhere; this is far past any window. */
const MAX_OCCURRENCES = 50_000
const DESCRIPTION_LIMIT = 280

const pad = (n: number) => String(n).padStart(2, '0')
const isoDay = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const localDay = (date: Date) => isoDay(date.getFullYear(), date.getMonth() + 1, date.getDate())

function isIanaZone(tzid: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tzid })
    return true
  } catch {
    return false
  }
}

/** How far `tz` is ahead of UTC at `date`, in milliseconds. */
function zoneOffset(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - date.getTime()
}

/** A wall-clock time in `tz` as an instant. Twice round, so a time near a DST change settles. */
function fromZone(t: ICAL.Time, tz: string): Date {
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
  let guess = wall
  for (let i = 0; i < 2; i++) guess = wall - zoneOffset(new Date(guess), tz)
  return new Date(guess)
}

/**
 * The instant a timed `ICAL.Time` names. `tzid` is the TZID its property was
 * written with, which `ical.js` drops when the feed defines no such zone.
 */
function instantOf(t: ICAL.Time, tzid: string | null): Date {
  const zone = t.zone?.tzid
  if (zone === 'UTC' || (zone && zone !== 'floating' && ICAL.TimezoneService.has(zone))) return t.toJSDate()
  if (tzid && isIanaZone(tzid)) return fromZone(t, tzid)
  // Floating: the same wall time wherever you are, which is local time here.
  return new Date(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
}

function tzidOf(component: ICAL.Component, name: 'dtstart' | 'dtend'): string | null {
  const value = component.getFirstProperty(name)?.getParameter('tzid')
  return typeof value === 'string' ? value : null
}

function text(component: ICAL.Component, name: string): string | null {
  const value = component.getFirstPropertyValue(name)
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === '' ? null : s
}

const LINK = /https?:\/\/[^\s<>"')]+/i

function linkOf(component: ICAL.Component): string | null {
  const url = text(component, 'url')
  if (url && /^https?:\/\//i.test(url)) return url
  for (const field of ['location', 'description']) {
    const found = text(component, field)?.match(LINK)
    if (found) return found[0]
  }
  return null
}

/** Every day from `from` to `to` inclusive, local, clipped to the window. */
function daysBetween(from: Date, to: Date, windowFrom: string, windowTo: string): string[] {
  const days: string[] = []
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const last = localDay(to)
  for (let i = 0; i < 400; i++) {
    const day = localDay(d)
    if (day >= windowFrom && day <= windowTo) days.push(day)
    if (day >= last) break
    d.setDate(d.getDate() + 1)
  }
  return days
}

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + n)
  return localDay(date)
}

interface Feed {
  id: string
  name: string
}

/**
 * The occurrences of every event in `ics` that overlap [from, to], both local
 * `YYYY-MM-DD` and inclusive.
 */
export function expandCalendar(ics: string, feed: Feed, from: string, to: string): CalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(ics))
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    const tz = new ICAL.Timezone(vtz)
    if (tz.tzid && !ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(tz)
  }

  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const windowStart = new Date(fy, fm - 1, fd)
  const windowEnd = new Date(ty, tm - 1, td + 1)

  // Masters and their moved or edited occurrences share a UID. The masters
  // are expanded; an exception is related to its master so the expansion
  // yields the edited version in place of the original.
  const masters = new Map<string, ICAL.Event>()
  const exceptions: ICAL.Component[] = []
  const standalone: ICAL.Component[] = []
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const uid = text(vevent, 'uid') ?? ''
    if (vevent.hasProperty('recurrence-id')) exceptions.push(vevent)
    else if (uid && !masters.has(uid)) masters.set(uid, new ICAL.Event(vevent))
    else standalone.push(vevent)
  }
  for (const exc of exceptions) {
    const master = masters.get(text(exc, 'uid') ?? '')
    if (master && master.isRecurring()) master.relateException(exc)
    else standalone.push(exc)
  }

  const out: CalendarEvent[] = []

  const emit = (component: ICAL.Component, start: ICAL.Time, end: ICAL.Time | null, uid: string) => {
    if ((text(component, 'status') ?? '').toUpperCase() === 'CANCELLED') return
    const base = {
      feedId: feed.id,
      feedName: feed.name,
      title: text(component, 'summary') ?? '(no title)',
      location: text(component, 'location'),
      description: (() => {
        const d = text(component, 'description')
        return d && d.length > DESCRIPTION_LIMIT ? `${d.slice(0, DESCRIPTION_LIMIT).trimEnd()}…` : d
      })(),
      link: linkOf(component)
    }

    if (start.isDate) {
      const startDay = isoDay(start.year, start.month, start.day)
      const endDay = end ? isoDay(end.year, end.month, end.day) : addDaysISO(startDay, 1)
      const lastDay = addDaysISO(endDay > startDay ? endDay : addDaysISO(startDay, 1), -1)
      if (lastDay < from || startDay > to) return
      const days: string[] = []
      for (let d = startDay < from ? from : startDay; d <= lastDay && d <= to; d = addDaysISO(d, 1)) days.push(d)
      out.push({ ...base, id: `${feed.id}:${uid}:${startDay}`, allDay: true, start: startDay, end: endDay, days })
      return
    }

    const startAt = instantOf(start, tzidOf(component, 'dtstart'))
    const endAt = end ? instantOf(end, tzidOf(component, 'dtend') ?? tzidOf(component, 'dtstart')) : startAt
    if (startAt >= windowEnd || (endAt <= windowStart && startAt < windowStart)) return
    // A zero-length event (a reminder, a premiere time) still belongs to its
    // day; anything else covers up to, not including, its end.
    const lastMoment = endAt > startAt ? new Date(endAt.getTime() - 1) : startAt
    out.push({
      ...base,
      id: `${feed.id}:${uid}:${startAt.toISOString()}`,
      allDay: false,
      start: startAt.toISOString(),
      end: endAt.toISOString(),
      days: daysBetween(startAt, lastMoment, from, to)
    })
  }

  for (const [uid, event] of masters) {
    if (!event.isRecurring()) {
      emit(event.component, event.startDate, event.endDate, uid)
      continue
    }
    if ((text(event.component, 'status') ?? '').toUpperCase() === 'CANCELLED') continue
    const it = event.iterator()
    for (let i = 0, next = it.next(); next && i < MAX_OCCURRENCES; i++, next = it.next()) {
      const details = event.getOccurrenceDetails(next)
      const component = details.item.component
      const startAt = details.startDate.isDate
        ? new Date(details.startDate.year, details.startDate.month - 1, details.startDate.day)
        : instantOf(details.startDate, tzidOf(component, 'dtstart'))
      // The rule is in start order, so the first occurrence past the window
      // ends it. A moved occurrence can land earlier than its slot, which is
      // why the check is on the original recurrence time as well.
      const slot = details.recurrenceId.isDate
        ? new Date(details.recurrenceId.year, details.recurrenceId.month - 1, details.recurrenceId.day)
        : instantOf(details.recurrenceId, tzidOf(event.component, 'dtstart'))
      if (startAt >= windowEnd && slot >= windowEnd) break
      emit(component, details.startDate, details.endDate, `${uid}:${details.recurrenceId.toString()}`)
    }
  }

  for (const component of standalone) {
    const event = new ICAL.Event(component)
    emit(component, event.startDate, event.endDate, `${text(component, 'uid') ?? 'x'}:${event.startDate?.toString()}`)
  }

  return out.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
    return a.start < b.start ? -1 : a.start > b.start ? 1 : a.title.localeCompare(b.title)
  })
}
