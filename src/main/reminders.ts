import { v4 as uuidv4 } from 'uuid'
import { getDb } from './database'
import { getSetting, setSetting } from './repo'
import * as ntfy from './ntfy'
import { parseDocument } from '@shared/document'
import { parseReminder, REMINDER_LINE } from '@shared/reminder-time'
import type { ReminderInfo } from '@shared/types'

/**
 * Phone reminders: set from the capture bar, or written as `!1600 …` lines in
 * a page.
 *
 * Fire-and-forget by design. Once a reminder is handed to ntfy, ntfy holds it
 * and delivers it at its time whether or not Nexus is running, so deleting
 * the line or the page afterwards does not stop it. What Nexus keeps is a log
 * (one `settings` row), so a line is never sent twice and Home can list
 * what's coming.
 *
 * A `!` line is sent only once it has stopped changing for SETTLE_MS: while
 * you're still typing "!16", nothing goes out. Quitting sends whatever is
 * waiting, because quitting means you've finished typing.
 */

const LOG_KEY = 'reminders.log'
// Both shortened by the checks, which can't sit through 45 seconds per case.
const SETTLE_MS = Number(process.env.NEXUS_REMINDER_SETTLE_MS) || 45_000
const TICK_MS = Number(process.env.NEXUS_REMINDER_TICK_MS) || 20_000
const KEEP_AFTER_MS = 7 * 24 * 60 * 60 * 1000
const MAX_TRIES = 5

interface Entry {
  id: string
  source: 'capture' | 'page'
  pageId: string | null
  pageTitle: string | null
  blockId: string | null
  /** The line as written, for a `!` line: an unchanged line is never sent twice. */
  raw?: string
  text: string
  fireAt: string
  status: 'pending' | 'sent' | 'passed' | 'failed'
  lastChanged: number
  tries: number
  error: string | null
}

function readLog(): Entry[] {
  try {
    const raw = JSON.parse(getSetting(LOG_KEY) ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function writeLog(entries: Entry[]): void {
  const cutoff = Date.now() - KEEP_AFTER_MS
  setSetting(LOG_KEY, JSON.stringify(entries.filter((e) => Date.parse(e.fireAt) > cutoff)))
}

function toInfo(e: Entry): ReminderInfo {
  return {
    id: e.id,
    text: e.text,
    fireAt: e.fireAt,
    status: e.status,
    source: e.source,
    pageId: e.pageId,
    pageTitle: e.pageTitle,
    error: e.error
  }
}

/** Reminders still to come, soonest first. */
export function upcoming(): ReminderInfo[] {
  const now = Date.now()
  return readLog()
    .filter((e) => Date.parse(e.fireAt) > now && e.status !== 'passed')
    .sort((a, b) => a.fireAt.localeCompare(b.fireAt))
    .map(toInfo)
}

/** Every reminder firing on a day (`YYYY-MM-DD`, local), soonest first. */
export function onDay(day: string): ReminderInfo[] {
  return readLog()
    .filter((e) => e.status !== 'passed' && localDay(new Date(e.fireAt)) === day)
    .sort((a, b) => a.fireAt.localeCompare(b.fireAt))
    .map(toInfo)
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function deliver(e: Entry): Promise<void> {
  try {
    await ntfy.send({ title: 'Reminder', message: e.text, tags: ['alarm_clock'], at: new Date(e.fireAt) })
    e.status = 'sent'
    e.error = null
  } catch (err) {
    e.tries++
    e.error = err instanceof Error ? err.message : String(err)
    if (e.tries >= MAX_TRIES) e.status = 'failed'
  }
}

/**
 * Set a reminder from words ("1600 tomorrow armored mma"). Sent to ntfy at
 * once when it's inside ntfy's window; further out, it waits here.
 */
export async function schedule(input: string): Promise<ReminderInfo & { held: boolean }> {
  const parsed = parseReminder(input)
  if (!parsed) throw new Error('Start with a time: "1600 armored mma", "tomorrow 4pm …", "30m …".')
  if (parsed.fireAt.getTime() <= Date.now() + 30_000) throw new Error('That time has already passed.')
  if (!ntfy.getConfig().configured) throw new Error('No ntfy topic set. Add one in Settings → Phone.')

  const entry: Entry = {
    id: uuidv4(),
    source: 'capture',
    pageId: null,
    pageTitle: null,
    blockId: null,
    text: parsed.text,
    fireAt: parsed.fireAt.toISOString(),
    status: 'pending',
    lastChanged: 0,
    tries: 0,
    error: null
  }
  const held = parsed.fireAt.getTime() - Date.now() > ntfy.MAX_DELAY_MS
  if (!held) {
    await deliver(entry)
    if (entry.status !== 'sent') throw new Error(entry.error ?? 'Could not reach ntfy.')
  }
  writeLog([...readLog(), entry])
  return { ...toInfo(entry), held }
}

interface Line {
  blockId: string
  text: string
  /** The heading the line sits under, lower-cased. */
  heading: string
}

function reminderLines(content: string | null): Line[] {
  const lines: Line[] = []
  let heading = ''
  const textOf = (content: unknown): string =>
    Array.isArray(content)
      ? content.map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : '')).join('')
      : ''
  const visit = (blocks: unknown[], top: boolean): void => {
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue
      const block = b as { id?: string; type?: string; content?: unknown; children?: unknown[] }
      const text = textOf(block.content).trim()
      if (block.type === 'heading' && top) heading = text.toLowerCase()
      else if (block.id && REMINDER_LINE.test(text)) lines.push({ blockId: block.id, text, heading })
      if (Array.isArray(block.children)) visit(block.children, false)
    }
  }
  visit(parseDocument(content) as unknown[], true)
  return lines
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return localDay(new Date(y, m - 1, d + n))
}

/**
 * Read a page's `!` lines into the log after a save. New or changed lines
 * wait as pending; lines that are gone are dropped if they weren't sent yet.
 *
 * A line's day is its page's `date`, one day on when it sits under a "Plans
 * for tomorrow" heading, and otherwise the next time the clock time comes
 * round, fixed when the line is first seen.
 */
export function projectPage(pageId: string): void {
  const row = getDb()
    .prepare(
      `SELECT p.title, p.content, p.is_locked, p.is_deleted,
              (SELECT value_date FROM properties WHERE page_id = p.id AND key = 'date' AND type = 'date') AS day
         FROM pages p WHERE p.id = ?`
    )
    .get(pageId) as
    | { title: string; content: string | null; is_locked: number; is_deleted: number; day: string | null }
    | undefined
  const lines = row && !row.is_locked && !row.is_deleted ? reminderLines(row.content) : []

  const log = readLog()
  const now = Date.now()
  let changed = false
  const keepBlocks = new Set<string>()

  for (const line of lines) {
    const lineDay = row?.day ? (line.heading.includes('tomorrow') ? addDays(row.day, 1) : row.day) : undefined
    const existing = log.filter((e) => e.pageId === pageId && e.blockId === line.blockId)
    const pending = existing.find((e) => e.status === 'pending')
    // A clock time with no page date is fixed the first time it's seen, so
    // "!1600" doesn't slide to tomorrow at 16:01.
    const parsed = parseReminder(line.text, pending ? new Date(Math.min(now, pending.lastChanged || now)) : new Date(now), lineDay)
    if (!parsed) continue
    keepBlocks.add(line.blockId)
    const fireAt = parsed.fireAt.toISOString()
    if (existing.some((e) => e.status !== 'pending' && e.raw === line.text)) continue
    if (pending) {
      if (pending.raw !== line.text || pending.fireAt !== fireAt) {
        pending.raw = line.text
        pending.text = parsed.text
        pending.fireAt = fireAt
        pending.lastChanged = now
        changed = true
      }
      if (pending.pageTitle !== (row?.title ?? null)) {
        pending.pageTitle = row?.title ?? null
        changed = true
      }
      continue
    }
    log.push({
      id: uuidv4(),
      source: 'page',
      pageId,
      pageTitle: row?.title ?? null,
      blockId: line.blockId,
      raw: line.text,
      text: parsed.text,
      fireAt,
      status: 'pending',
      lastChanged: now,
      tries: 0,
      error: null
    })
    changed = true
  }

  // Unsent lines that were deleted or edited away cost nothing to drop.
  const kept = log.filter(
    (e) => !(e.pageId === pageId && e.status === 'pending' && e.blockId && !keepBlocks.has(e.blockId))
  )
  if (kept.length !== log.length) changed = true
  if (changed) writeLog(kept)
}

let running = false

/** Send what has settled. `force` sends everything waiting, settled or not (on quit). */
export async function tick(force = false): Promise<void> {
  if (running) return
  running = true
  try {
    if (!ntfy.getConfig().configured) return
    const log = readLog()
    const now = Date.now()
    let changed = false
    for (const e of log) {
      if (e.status !== 'pending') continue
      if (!force && now - e.lastChanged < SETTLE_MS) continue
      const at = Date.parse(e.fireAt)
      if (at <= now + 30_000) {
        e.status = 'passed'
        changed = true
        continue
      }
      if (at - now > ntfy.MAX_DELAY_MS) continue
      await deliver(e)
      changed = true
    }
    if (changed) {
      // Merge onto the current log: a save may have landed while we were sending.
      const fresh = new Map(readLog().map((e) => [e.id, e]))
      for (const e of log) if (fresh.has(e.id)) fresh.set(e.id, e)
      writeLog([...fresh.values()])
    }
  } finally {
    running = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null

export function start(): void {
  if (timer) return
  timer = setInterval(() => void tick(), TICK_MS)
}

export function stop(): void {
  if (timer) clearInterval(timer)
  timer = null
}
