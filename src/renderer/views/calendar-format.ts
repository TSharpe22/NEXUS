import type { CalendarEvent } from '@shared/calendar'

/**
 * How a calendar event is written on screen, shared by the Calendar widget on
 * Home and the days in Tracker → Week.
 */

/** The start time as the system writes times, "7:00 PM" or "19:00". */
export function eventTime(event: CalendarEvent, day: string): string {
  if (event.allDay) return ''
  const start = new Date(event.start)
  const startDay = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(
    start.getDate()
  ).padStart(2, '0')}`
  // An event carried over from the night before has no start on this day.
  if (startDay !== day) return '…'
  return start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Everything about an event worth a hover: when, where, what, from which calendar. */
export function eventTooltip(event: CalendarEvent): string {
  const when = event.allDay
    ? 'All day'
    : `${new Date(event.start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} – ${new Date(
        event.end
      ).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  return [event.title, when, event.location, event.description, event.link ? `${event.link} (click to open)` : null, event.feedName]
    .filter(Boolean)
    .join('\n')
}

/** Only web links leave the app, and only in the browser. */
export function openEventLink(event: CalendarEvent): void {
  if (event.link && /^https?:\/\//i.test(event.link)) window.open(event.link, '_blank', 'noopener')
}
