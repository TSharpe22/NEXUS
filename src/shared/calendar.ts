/**
 * Calendars Nexus reads but does not own.
 *
 * A feed is an ICS link — Proton Calendar's "share with anyone" link, or any
 * other — fetched by the main process and expanded into the events that fall
 * inside a window. Nothing here is written to `pages`: an event is not an
 * object in the vault, it is a reading of somebody else's calendar, and it
 * disappears from Nexus the moment it disappears from the feed.
 */

/** A feed as the renderer sees it. The link itself never leaves the main process. */
export interface CalendarFeedInfo {
  id: string
  name: string
  /** Just the host, so Settings can say where a feed comes from without showing its secret. */
  host: string
  /** When the feed was last fetched successfully, ISO, or null if never. */
  fetchedAt: string | null
  /** Why the last fetch failed, or null when it did not. */
  error: string | null
}

/** One occurrence of an event inside the asked-for window. */
export interface CalendarEvent {
  /** Stable per occurrence: feed, UID and start. */
  id: string
  feedId: string
  feedName: string
  title: string
  allDay: boolean
  /** An instant (ISO, with zone) for a timed event; `YYYY-MM-DD` for an all-day one. */
  start: string
  /** Exclusive, in the same form as `start`. */
  end: string
  /** Every local day inside the window this occurrence touches, `YYYY-MM-DD`. */
  days: string[]
  location: string | null
  /** The description, trimmed — enough for a tooltip, not the whole body. */
  description: string | null
  /** A web link for the event, when it carries one: the URL field, else the first link in its text. */
  link: string | null
}

export interface CalendarResult {
  events: CalendarEvent[]
  /** Feeds that could not be fetched this time. Their last good copy is still used. */
  errors: { feedId: string; feedName: string; message: string }[]
}
