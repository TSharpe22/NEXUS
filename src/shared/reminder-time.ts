/**
 * When a reminder fires, read from the words that set it.
 *
 * Shared by the capture bar ("1600 tomorrow armored mma") and by `!` lines in
 * a page ("!1600 armored mma"). Pure and local-time only: the result is an
 * absolute instant, so it can be handed to ntfy as a timestamp. ntfy's own
 * "At: 4pm" is read in the server's zone, which for ntfy.sh is UTC, so words
 * are never passed through.
 *
 * Accepted, in any order before the text:
 *   a time     1600 · 930 · 16:00 · 4pm · 4:30pm · 4 pm
 *   a day      today · tomorrow · tmrw · tmr · mon…sun / monday…sunday · 2026-10-08
 *   or instead a span from now   30m · 2h · 1h30m · 90min · in 45 min
 * A day with no time is not a reminder; a time with no day is the next time
 * that clock time comes round (or the line's own day, for a `!` line).
 */

export interface ParsedReminder {
  fireAt: Date
  text: string
}

const WEEKDAY_WORDS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6
}

function weekdayIndex(word: string): number {
  return WEEKDAY_WORDS[word.toLowerCase()] ?? -1
}

/** `HH:MM` from one token (or two, for "4 pm"); null when it isn't a time. */
export function readTime(token: string, next: string | undefined): { h: number; m: number; used: number } | null {
  const t = token.toLowerCase()
  let match = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(t)
  let used = 1
  if (!match && next && /^(am|pm)$/i.test(next)) {
    const bare = /^(\d{1,2})(?::(\d{2}))?$/.exec(t)
    if (bare) {
      match = [t + next, bare[1], bare[2], next.toLowerCase()] as unknown as RegExpExecArray
      used = 2
    }
  }
  if (match) {
    let h = Number(match[1])
    const m = Number(match[2] ?? 0)
    if (h < 1 || h > 12 || m > 59) return null
    if (match[3] === 'pm' && h !== 12) h += 12
    if (match[3] === 'am' && h === 12) h = 0
    return { h, m, used }
  }
  const colon = /^(\d{1,2}):(\d{2})$/.exec(t)
  if (colon) {
    const h = Number(colon[1])
    const m = Number(colon[2])
    return h < 24 && m < 60 ? { h, m, used: 1 } : null
  }
  // 930, 0930, 1600: military time. Two digits alone ("16") is too likely to
  // be a number in the text to count.
  const military = /^(\d{1,2})(\d{2})$/.exec(t)
  if (military && t.length >= 3) {
    const h = Number(military[1])
    const m = Number(military[2])
    return h < 24 && m < 60 ? { h, m, used: 1 } : null
  }
  return null
}

/** Minutes from a span token ("30m", "2h", "1h30m", "90min"); null otherwise. */
function readSpan(token: string, next: string | undefined): { minutes: number; used: number } | null {
  const t = token.toLowerCase()
  const compact = /^(?:(\d+)h)?(?:(\d+)m(?:in|ins)?)?$/.exec(t)
  if (compact && (compact[1] || compact[2])) {
    return { minutes: Number(compact[1] ?? 0) * 60 + Number(compact[2] ?? 0), used: 1 }
  }
  if (/^\d+$/.test(t) && next && /^(m|min|mins|minutes?|h|hr|hrs|hours?)$/i.test(next)) {
    const n = Number(t)
    return { minutes: /^h/i.test(next) ? n * 60 : n, used: 2 }
  }
  return null
}

export function readDay(token: string, now: Date): Date | null {
  const t = token.toLowerCase()
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (t === 'today') return base
  if (t === 'tomorrow' || t === 'tmrw' || t === 'tmr') {
    base.setDate(base.getDate() + 1)
    return base
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  const wd = weekdayIndex(t)
  if (wd >= 0) {
    const ahead = (wd - base.getDay() + 7) % 7
    base.setDate(base.getDate() + ahead)
    return base
  }
  return null
}

function dayOf(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * Read a reminder. `lineDay` is the day a `!` line belongs to (its page's
 * date), used when no day is written. Returns null when there's no time, or
 * no text left to remind about.
 */
export function parseReminder(input: string, now: Date = new Date(), lineDay?: string): ParsedReminder | null {
  const tokens = input.trim().replace(/^!/, '').split(/\s+/).filter(Boolean)
  let day: Date | null = null
  let time: { h: number; m: number } | null = null
  let span: number | null = null
  let i = 0
  // Read leading schedule words, stopping at the first word that is none of them.
  for (let guard = 0; guard < 4 && i < tokens.length; guard++) {
    const token = tokens[i]
    const next = tokens[i + 1]
    if (token.toLowerCase() === 'in' && next && readSpan(next, tokens[i + 2])) {
      i++
      continue
    }
    if (token.toLowerCase() === 'at' && next && readTime(next, tokens[i + 2])) {
      i++
      continue
    }
    if (!time && span === null) {
      const s = readSpan(token, next)
      if (s) {
        span = s.minutes
        i += s.used
        continue
      }
    }
    if (!time && span === null) {
      const t = readTime(token, next)
      if (t) {
        time = { h: t.h, m: t.m }
        i += t.used
        continue
      }
    }
    if (!day && span === null) {
      const d = readDay(token, now)
      if (d) {
        day = d
        i++
        continue
      }
    }
    break
  }

  const text = tokens.slice(i).join(' ').replace(/^[-–—:,]\s*/, '').trim()
  if (!text) return null

  if (span !== null) {
    if (span <= 0) return null
    return { fireAt: new Date(now.getTime() + span * 60_000), text }
  }
  if (!time) return null

  if (day) {
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.h, time.m)
    // "fri" said on a Friday after the time has gone means next Friday.
    if (at <= now && day.getDay() === now.getDay() && !/^\d{4}-|^today$/i.test(tokens.find((t) => readDay(t, now)) ?? '')) {
      at.setDate(at.getDate() + 7)
    }
    return { fireAt: at, text }
  }
  if (lineDay) {
    const d = dayOf(lineDay)
    return { fireAt: new Date(d.getFullYear(), d.getMonth(), d.getDate(), time.h, time.m), text }
  }
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), time.h, time.m)
  if (at <= now) at.setDate(at.getDate() + 1)
  return { fireAt: at, text }
}

/** `!1600 …`, `!16:00 …`, `!4pm …` at the start of a line. */
export const REMINDER_LINE = /^!(\d{3,4}|\d{1,2}:\d{2}|\d{1,2}(?::\d{2})?\s?(?:am|pm))\b/i

/** "Thu 8 Oct, 16:00" — how a reminder's time is shown back. */
export function describeFireAt(at: Date, now: Date = new Date()): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  if (sameDay(at, now)) return `today, ${hhmm}`
  if (sameDay(at, tomorrow)) return `tomorrow, ${hhmm}`
  return `${days[at.getDay()]} ${at.getDate()} ${months[at.getMonth()]}, ${hhmm}`
}
