import { readDay, readTime } from './reminder-time'

/**
 * A calendar event, read from the words that describe it.
 *
 * The capture bar's Event target: "nov 14 2000 armored mma nashville" becomes
 * an event in the Exec-Bot calendar feed, which Proton subscribes to. Local
 * time throughout (Nexus runs in New York, and so does the feed's builder).
 *
 * Accepted, in any order before the title:
 *   a day      nov 14 · 14 nov · november 14th · nov 14 2027 · 11/14 · 2026-11-14
 *              today · tomorrow · mon…sun
 *   a time     2000 · 8pm · 20:00, or a range: 2000-2300 · 8pm-11pm · 2000 to 2300
 * A day is required. No time makes an all-day event. A month and day with no
 * year is the next time that date comes round.
 */

export interface ParsedEvent {
  /** `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`, local time. */
  start: string
  end: string | null
  title: string
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, '')
  if (w.length < 3) return -1
  const i = MONTHS.indexOf(w.slice(0, 3))
  if (i < 0) return -1
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][i]
  return full.startsWith(w) || w === 'sept' ? i : -1
}

function dayNumber(word: string): number {
  const m = /^(\d{1,2})(?:st|nd|rd|th)?,?$/i.exec(word)
  const n = m ? Number(m[1]) : 0
  return n >= 1 && n <= 31 ? n : 0
}

/**
 * A year, only this one or the next three: "nov 14 2000" is 8 pm, not the
 * year 2000. ("nov 14 2027" is read as the year, never as 20:27.)
 */
function yearNumber(word: string | undefined, now: Date): number {
  if (!word || !/^20\d{2},?$/.test(word)) return 0
  const y = Number(word.replace(',', ''))
  return y >= now.getFullYear() && y <= now.getFullYear() + 3 ? y : 0
}

/** A month and day, next time it comes round unless a year is given. */
function monthDay(month: number, day: number, year: number, now: Date): Date | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let d = new Date(year || now.getFullYear(), month, day)
  if (d.getMonth() !== month) return null // 31 Nov and the like
  if (!year && d < today) d = new Date(now.getFullYear() + 1, month, day)
  return d
}

const pad = (n: number) => String(n).padStart(2, '0')
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function parseEvent(input: string, now: Date = new Date()): ParsedEvent | null {
  const tokens = input.trim().split(/\s+/).filter(Boolean)
  let day: Date | null = null
  let start: { h: number; m: number } | null = null
  let end: { h: number; m: number } | null = null
  let i = 0

  for (let guard = 0; guard < 6 && i < tokens.length; guard++) {
    const t = tokens[i]
    const next = tokens[i + 1]
    const lower = t.toLowerCase()
    if ((lower === 'on' || lower === 'at') && next) {
      i++
      continue
    }
    if (!day) {
      // nov 14 [2027]
      const mi = monthIndex(t)
      if (mi >= 0 && next && dayNumber(next)) {
        const y = yearNumber(tokens[i + 2], now)
        day = monthDay(mi, dayNumber(next), y, now)
        if (day) {
          i += y ? 3 : 2
          continue
        }
      }
      // 14 nov [2027]
      if (dayNumber(t) && next && monthIndex(next) >= 0) {
        const y = yearNumber(tokens[i + 2], now)
        day = monthDay(monthIndex(next), dayNumber(t), y, now)
        if (day) {
          i += y ? 3 : 2
          continue
        }
      }
      // 11/14 or 11/14/2027
      const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?$/.exec(t)
      if (slash) {
        day = monthDay(Number(slash[1]) - 1, Number(slash[2]), Number(slash[3] ?? 0), now)
        if (day) {
          i++
          continue
        }
      }
      const d = readDay(t, now)
      if (d) {
        day = d
        i++
        continue
      }
    }
    if (!start) {
      // 2000-2300 or 8pm-11pm, in one token
      const dash = /^([^-–]+)[-–]([^-–]+)$/.exec(t)
      if (dash) {
        const a = readTime(dash[1], undefined)
        const b = readTime(dash[2], undefined)
        if (a && b) {
          start = a
          end = b
          i++
          continue
        }
      }
      const a = readTime(t, next)
      if (a) {
        start = a
        i += a.used
        // 2000 - 2300 · 2000 to 2300
        const sep = tokens[i]?.toLowerCase()
        if (sep === '-' || sep === '–' || sep === 'to' || sep === 'until') {
          const b = readTime(tokens[i + 1] ?? '', tokens[i + 2])
          if (b) {
            end = b
            i += 1 + b.used
          }
        }
        continue
      }
    }
    break
  }

  const title = tokens.slice(i).join(' ').replace(/^[-–—:,]\s*/, '').trim()
  if (!day || !title) return null
  const date = isoDay(day)
  if (!start) return { start: date, end: null, title }

  const startIso = `${date}T${pad(start.h)}:${pad(start.m)}`
  if (!end) return { start: startIso, end: null, title }
  // 2000-0000 runs past midnight.
  const endDay = new Date(day)
  if (end.h * 60 + end.m <= start.h * 60 + start.m) endDay.setDate(endDay.getDate() + 1)
  return { start: startIso, end: `${isoDay(endDay)}T${pad(end.h)}:${pad(end.m)}`, title }
}

/** "Sat 14 Nov, 20:00–23:00" or "Sat 14 Nov, all day": how an event is shown back. */
export function describeEvent(e: ParsedEvent): string {
  const [y, mo, d] = e.start.slice(0, 10).split('-').map(Number)
  const date = new Date(y, mo - 1, d)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const label = `${days[date.getDay()]} ${d} ${months[mo - 1]}`
  if (e.start.length === 10) return `${label}, all day`
  return `${label}, ${e.start.slice(11)}${e.end ? `–${e.end.slice(11)}` : ''}`
}
