import { v4 as uuidv4 } from 'uuid'
import { getSetting, setSetting } from './repo'
import { expandCalendar } from './ical-expand'
import type { CalendarFeedInfo, CalendarResult } from '@shared/calendar'

/**
 * The calendar feeds Nexus reads, and the last good copy of each.
 *
 * A feed's link is a secret — anyone holding a Proton "share with anyone"
 * link can read the calendar — so it is kept here, in the main process and
 * the `settings` table, and the renderer is only ever told the host. It is in
 * the vault file and so in its backups, exactly as readable as the vault is;
 * it is not in the Markdown mirror, which writes pages and nothing else.
 *
 * The last fetched document is kept too, so a launch with no network still
 * shows the week rather than an empty calendar.
 */

interface StoredFeed {
  id: string
  name: string
  url: string
}

const FEEDS_KEY = 'calendar.feeds'
const cacheKey = (id: string) => `calendar.cache.${id}`
const fetchedKey = (id: string) => `calendar.fetched.${id}`

/** A feed fetched longer ago than this is fetched again the next time it is read. */
const REFRESH_MS = 10 * 60 * 1000
const FETCH_TIMEOUT_MS = 20_000

const errors = new Map<string, string>()
const inFlight = new Map<string, Promise<void>>()

function readFeeds(): StoredFeed[] {
  try {
    const raw = JSON.parse(getSetting(FEEDS_KEY) ?? '[]')
    return Array.isArray(raw)
      ? raw.filter((f) => f && typeof f.id === 'string' && typeof f.url === 'string')
      : []
  } catch {
    return []
  }
}

function writeFeeds(feeds: StoredFeed[]): void {
  setSetting(FEEDS_KEY, JSON.stringify(feeds))
}

function info(feed: StoredFeed): CalendarFeedInfo {
  let host = ''
  try {
    host = new URL(feed.url).host
  } catch {
    host = '?'
  }
  return {
    id: feed.id,
    name: feed.name,
    host,
    fetchedAt: getSetting(fetchedKey(feed.id)),
    error: errors.get(feed.id) ?? null
  }
}

/**
 * The link as it will be fetched, or an error saying why it will not be.
 * `webcal://` is how calendar apps spell a subscription; it is plain HTTPS.
 * Plain HTTP is refused except to this machine, where the checks serve
 * their fixture — a calendar link sent in the clear is a calendar anyone on
 * the network can read.
 */
function normaliseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/^webcal:\/\//i, 'https://')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('That is not a link.')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('Calendar links must be https.')
  }
  return url.toString()
}

async function fetchFeed(feed: StoredFeed): Promise<void> {
  try {
    const response = await fetch(feed.url, {
      headers: { Accept: 'text/calendar, */*;q=0.5' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`The calendar answered ${response.status}.`)
    const body = await response.text()
    if (!body.includes('BEGIN:VCALENDAR')) throw new Error('That link did not return a calendar.')
    // Parse once here so a broken document is reported as this feed's error
    // instead of replacing the last copy that worked.
    expandCalendar(body, feed, '2000-01-01', '2000-01-01')
    setSetting(cacheKey(feed.id), body)
    setSetting(fetchedKey(feed.id), new Date().toISOString())
    errors.delete(feed.id)
  } catch (e) {
    const message =
      e instanceof Error && e.name === 'TimeoutError'
        ? 'The calendar took too long to answer.'
        : e instanceof Error
          ? e.message
          : String(e)
    errors.set(feed.id, message)
  }
}

/** Fetch a feed unless a recent copy is good enough. One fetch per feed at a time. */
function ensureFresh(feed: StoredFeed, force: boolean): Promise<void> {
  const fetchedAt = getSetting(fetchedKey(feed.id))
  const fresh = fetchedAt && Date.now() - Date.parse(fetchedAt) < REFRESH_MS
  // A feed that failed last time is retried on the same schedule, not on
  // every read — a dead link must not mean a request per render.
  if (!force && fresh) return Promise.resolve()
  const running = inFlight.get(feed.id)
  if (running) return running
  const job = fetchFeed(feed).finally(() => inFlight.delete(feed.id))
  inFlight.set(feed.id, job)
  return job
}

export function listFeeds(): CalendarFeedInfo[] {
  return readFeeds().map(info)
}

export async function addFeed(name: string, rawUrl: string): Promise<CalendarFeedInfo> {
  const url = normaliseUrl(rawUrl)
  const feeds = readFeeds()
  if (feeds.some((f) => f.url === url)) throw new Error('That calendar is already added.')
  const feed: StoredFeed = { id: uuidv4(), name: name.trim() || 'Calendar', url }
  writeFeeds([...feeds, feed])
  await ensureFresh(feed, true)
  return info(feed)
}

export function renameFeed(id: string, name: string): void {
  writeFeeds(readFeeds().map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f)))
}

export function removeFeed(id: string): void {
  writeFeeds(readFeeds().filter((f) => f.id !== id))
  setSetting(cacheKey(id), null)
  setSetting(fetchedKey(id), null)
  errors.delete(id)
}

/**
 * Every occurrence across every feed that overlaps [from, to], local and
 * inclusive. Fetches whatever is stale first; a feed that cannot be fetched
 * is drawn from its last good copy and named in `errors`.
 */
export async function getEvents(from: string, to: string, force = false): Promise<CalendarResult> {
  const feeds = readFeeds()
  await Promise.all(feeds.map((f) => ensureFresh(f, force)))

  const result: CalendarResult = { events: [], errors: [] }
  for (const feed of feeds) {
    const error = errors.get(feed.id)
    if (error) result.errors.push({ feedId: feed.id, feedName: feed.name, message: error })
    const cached = getSetting(cacheKey(feed.id))
    if (!cached) continue
    try {
      result.events.push(...expandCalendar(cached, feed, from, to))
    } catch (e) {
      result.errors.push({
        feedId: feed.id,
        feedName: feed.name,
        message: `Could not read the calendar: ${e instanceof Error ? e.message : String(e)}`
      })
    }
  }
  result.events.sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
    return a.start < b.start ? -1 : a.start > b.start ? 1 : a.title.localeCompare(b.title)
  })
  return result
}
