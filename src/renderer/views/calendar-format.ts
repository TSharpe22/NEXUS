import type { CalendarEvent } from '@shared/calendar'

/**
 * How a calendar event is written on screen, shared by the Calendar widget on
 * Home and the days in Tracker → Week.
 */

/**
 * Times are 24-hour, "07:00" and "19:00": five characters that fit one line
 * of a narrow day column, and the way times are typed into capture ("1600").
 */
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }

/** The start time, as "07:00". */
export function eventTime(event: CalendarEvent, day: string): string {
  if (event.allDay) return ''
  const start = new Date(event.start)
  const startDay = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(
    start.getDate()
  ).padStart(2, '0')}`
  // An event carried over from the night before has no start on this day.
  if (startDay !== day) return '…'
  return start.toLocaleTimeString([], TIME)
}

/** Everything about an event worth a hover: when, where, what, from which calendar. */
export function eventTooltip(event: CalendarEvent): string {
  const when = event.allDay
    ? 'All day'
    : `${new Date(event.start).toLocaleString([], { weekday: 'short', ...TIME })} – ${new Date(
        event.end
      ).toLocaleTimeString([], TIME)}`
  return [event.title, when, event.location, event.description, event.link ? `${event.link} (click to open)` : null, event.feedName]
    .filter(Boolean)
    .join('\n')
}

/** Only web links leave the app, and only in the browser. */
export function openEventLink(event: CalendarEvent): void {
  if (event.link && /^https?:\/\//i.test(event.link)) window.open(event.link, '_blank', 'noopener')
}
