import { execFile } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import * as repo from './repo'
import * as reminders from './reminders'
import { getEvents } from './calendar'
import { parseDocument, sectionLines } from '@shared/document'
import type { BriefingInfo, BriefingSyncStatus, Page } from '@shared/types'

/**
 * The Exec-Bot hand-off: a snapshot out, a briefing back.
 *
 * The morning routine runs in the cloud and can't see the vault, so Nexus
 * writes it a small snapshot of what tomorrow's briefing needs and pushes it
 * to the private Exec-Bot repo; the routine writes the briefing back to the
 * same repo, and Nexus pulls it. Only `snapshot/` is written from here and
 * only `briefings/` by the routine, so the two never edit the same file.
 *
 * Off until switched on in Settings, and pointed at a checkout that already
 * pushes with this machine's git login. Nothing here asks for a credential.
 */

const ENABLED_KEY = 'execbot.enabled'
const DIR_KEY = 'execbot.dir'
const INSERTED_KEY = 'briefing.insertedFor'
const PUSH_DEBOUNCE_MS = 90_000
const PULL_EVERY_MS = 30 * 60 * 1000
const GIT_TIMEOUT_MS = 60_000
/** The routine runs at 8:30; until then, today's briefing is still to come. */
const BRIEFING_HOUR = 8
const BRIEFING_MINUTE = 30

const state = {
  lastPushAt: null as string | null,
  lastPullAt: null as string | null,
  lastSnapshotFor: null as string | null,
  error: null as string | null
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return localDay(new Date(y, m - 1, d + n))
}

function getDir(): string | null {
  const stored = repo.getSetting(DIR_KEY)
  if (stored) return stored
  const guess = join(homedir(), 'Desktop', 'exec-bot')
  return existsSync(join(guess, '.git')) ? guess : null
}

function isEnabled(): boolean {
  return repo.getSetting(ENABLED_KEY) === '1'
}

function isReady(dir: string | null): dir is string {
  return !!dir && existsSync(join(dir, '.git'))
}

export function status(): BriefingSyncStatus {
  const dir = getDir()
  return { enabled: isEnabled(), dir, ready: isReady(dir), ...state }
}

export function setDir(dir: string | null): BriefingSyncStatus {
  repo.setSetting(DIR_KEY, dir?.trim() || null)
  return status()
}

export function setEnabled(enabled: boolean): BriefingSyncStatus {
  repo.setSetting(ENABLED_KEY, enabled ? '1' : null)
  if (enabled) start()
  else stop()
  return status()
}

// ---------------------------------------------------------------- git

let queue: Promise<unknown> = Promise.resolve()

/** Git calls run one at a time: a pull and a push must never interleave. */
function git(dir: string, args: string[]): Promise<string> {
  const run = () =>
    new Promise<string>((resolve, reject) => {
      execFile(
        'git',
        args,
        { cwd: dir, timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
        (err, stdout, stderr) => {
          if (err) reject(new Error((stderr || err.message).trim().split('\n').slice(-2).join(' ')))
          else resolve(stdout)
        }
      )
    })
  const next = queue.then(run, run)
  queue = next.catch(() => undefined)
  return next
}

// ---------------------------------------------------------------- snapshot

/** The day the next briefing is for: today until 8:30, tomorrow after. */
export function nextBriefingDate(now = new Date()): string {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), BRIEFING_HOUR, BRIEFING_MINUTE)
  return now < cutoff ? localDay(now) : addDays(localDay(now), 1)
}

/**
 * Every line under the first top-level heading containing `match`, checkboxes
 * included and marked, up to the next heading of the same level or higher.
 */
function linesUnder(content: string | null, match: string): string[] {
  const blocks = parseDocument(content) as { type?: string; props?: { level?: number; checked?: boolean }; content?: unknown; children?: unknown[] }[]
  const textOf = (c: unknown): string =>
    Array.isArray(c) ? c.map((x) => (x && typeof x === 'object' && 'text' in x ? String((x as { text: unknown }).text) : '')).join('') : ''
  const start = blocks.findIndex((b) => b?.type === 'heading' && textOf(b.content).toLowerCase().includes(match))
  if (start < 0) return []
  const level = Number(blocks[start].props?.level ?? 1)
  const out: string[] = []
  const visit = (list: typeof blocks, depth: number) => {
    for (const b of list) {
      if (!b || typeof b !== 'object') continue
      const text = textOf(b.content).trim()
      const pad = '  '.repeat(depth)
      if (text) {
        if (b.type === 'checkListItem') out.push(`${pad}[${b.props?.checked ? 'x' : ' '}] ${text}`)
        else if (b.type === 'bulletListItem' || b.type === 'numberedListItem') out.push(`${pad}- ${text}`)
        else out.push(`${pad}${text}`)
      }
      if (Array.isArray(b.children)) visit(b.children as typeof blocks, depth + 1)
    }
  }
  for (const b of blocks.slice(start + 1)) {
    if (b?.type === 'heading' && Number(b.props?.level ?? 1) <= level) break
    visit([b], 0)
  }
  return out
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** What the routine needs for `date`'s briefing, and nothing else from the vault. */
export async function buildSnapshot(date: string): Promise<Record<string, unknown>> {
  const [y, m, d] = date.split('-').map(Number)
  const monday = localDay(new Date(y, m - 1, d - ((new Date(y, m - 1, d).getDay() + 6) % 7)))
  const sunday = addDays(monday, 6)

  const evening = repo.getJournalEntryFor(addDays(date, -1))
  const sameDay = repo.getJournalEntryFor(date)
  const weekPage = repo.getWeekPage(date)
  const quarterPage = repo.getQuarterPage(date)

  const weekLogs = new Map<string, { done: number; total: number; checkable: boolean }>()
  for (const p of repo.getDatedPagesInRange(monday, sunday)) {
    if (p.typeName === 'Week' || p.typeName === 'Journal' || p.date > date) continue
    const name = p.typeName ?? 'Note'
    const e = weekLogs.get(name) ?? { done: 0, total: 0, checkable: false }
    e.total++
    if (p.done !== null) e.checkable = true
    if (p.done) e.done++
    weekLogs.set(name, e)
  }

  let events: { time: string; title: string; location: string | null }[] = []
  try {
    const result = await getEvents(date, date)
    events = result.events
      .filter((e) => e.days.includes(date))
      .map((e) => ({ time: e.allDay ? 'all day' : `${hhmm(e.start)}–${hhmm(e.end)}`, title: e.title, location: e.location }))
  } catch {
    // The routine reads the calendar itself too; a stale or missing copy here is fine.
  }

  return {
    version: 1,
    date,
    generatedAt: new Date().toISOString(),
    plansForTomorrow: evening ? linesUnder(evening.content, 'plans for tomorrow') : [],
    entryAlreadyStarted: !!sameDay,
    tasksDue: repo.getTasksInRange(date, date).map((t) => ({ text: t.text, done: t.isDone, page: t.pageTitle })),
    overdue: repo
      .getOverdueTasks(date)
      .slice(0, 5)
      .map((t) => ({ text: t.text, due: t.dueDate })),
    week: {
      monday,
      plan: weekPage ? sectionLines(weekPage.content, 'Plan') : [],
      logged: [...weekLogs.entries()].map(([type, e]) => ({ type, done: e.done, total: e.total, checkable: e.checkable }))
    },
    milestones: quarterPage
      ? repo
          .getTasksForPage(quarterPage.id)
          .filter((t) => t.dueDate && t.dueDate >= monday && t.dueDate <= sunday)
          .map((t) => ({ text: t.text, due: t.dueDate, done: t.isDone }))
      : [],
    training: repo
      .getDatedPagesInRange(addDays(date, -21), addDays(date, -1))
      .filter((p) => p.typeName === 'Training')
      .map((p) => ({ date: p.date, title: p.pageTitle, done: p.done })),
    reminders: reminders.onDay(date).map((r) => ({ time: hhmm(r.fireAt), text: r.text })),
    calendarFromNexus: events
  }
}

/** Write the next briefing's snapshot and push it. A no-op when nothing changed. */
export async function pushSnapshot(): Promise<void> {
  const dir = getDir()
  if (!isEnabled() || !isReady(dir)) return
  const date = nextBriefingDate()
  try {
    const snapshot = await buildSnapshot(date)
    const folder = join(dir, 'snapshot')
    mkdirSync(folder, { recursive: true })
    const file = join(folder, `${date}.json`)
    // `generatedAt` changes every time; compare without it so an unchanged
    // vault doesn't push a new commit every 90 seconds.
    const comparable = (s: Record<string, unknown>) => JSON.stringify({ ...s, generatedAt: null })
    let previous: Record<string, unknown> | null = null
    try {
      previous = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      previous = null
    }
    if (previous && comparable(previous) === comparable(snapshot)) return

    writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n')
    await git(dir, ['add', `snapshot/${date}.json`])
    await git(dir, ['commit', '-q', '-m', `snapshot ${date}`, '--', `snapshot/${date}.json`])
    await git(dir, ['pull', '-q', '--rebase', '--autostash'])
    await git(dir, ['push', '-q'])
    state.lastPushAt = new Date().toISOString()
    state.lastSnapshotFor = date
    state.error = null
  } catch (e) {
    state.error = `Push: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function pull(): Promise<void> {
  const dir = getDir()
  if (!isEnabled() || !isReady(dir)) return
  try {
    await git(dir, ['pull', '-q', '--rebase', '--autostash'])
    state.lastPullAt = new Date().toISOString()
    state.error = null
  } catch (e) {
    state.error = `Pull: ${e instanceof Error ? e.message : String(e)}`
  }
}

export async function syncNow(): Promise<BriefingSyncStatus> {
  await pushSnapshot()
  await pull()
  return status()
}

// ---------------------------------------------------------------- briefing

/** The briefing the routine wrote for `date`, from the local checkout. */
export function briefingFor(date: string): BriefingInfo | null {
  const dir = getDir()
  if (!isReady(dir)) return null
  try {
    const raw = readFileSync(join(dir, 'briefings', `${date}.md`), 'utf8')
    const split = raw.indexOf('\n---\n')
    const head = split >= 0 ? raw.slice(0, split) : ''
    const body = split >= 0 ? raw.slice(split + 5) : raw
    const title = /^title:\s*(.*)$/m.exec(head)?.[1]?.trim() ?? `Briefing · ${date}`
    return { date, title, body: body.trim() }
  } catch {
    return null
  }
}

export function today(): BriefingInfo | null {
  return briefingFor(localDay(new Date()))
}

type Styled = { type: 'text'; text: string; styles: Record<string, boolean> }

function inline(text: string): Styled[] {
  const parts: Styled[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parts.push({ type: 'text', text: text.slice(last, m.index), styles: {} })
    parts.push({ type: 'text', text: m[1], styles: { bold: true } })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last), styles: {} })
  return parts
}

function block(type: string, content: Styled[], props: Record<string, unknown> = {}) {
  return {
    id: uuidv4(),
    type,
    props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left', ...props },
    content,
    children: []
  }
}

/** The briefing as editor blocks, under a "Briefing" heading. */
function briefingBlocks(b: BriefingInfo) {
  const out = [block('heading', [{ type: 'text', text: 'Briefing', styles: {} }], { level: 2 })]
  for (const line of b.body.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const bullet = /^[-•]\s+(.*)$/.exec(t)
    out.push(bullet ? block('bulletListItem', inline(bullet[1])) : block('paragraph', inline(t)))
  }
  return out
}

/**
 * Put today's briefing at the top of today's entry, replacing an earlier copy
 * of the section. Returns the entry.
 */
export function addToEntry(): Page {
  const b = today()
  if (!b) throw new Error("Today's briefing hasn't arrived yet.")
  const entry = repo.getOrCreateTodayEntry()
  const blocks = parseDocument(entry.content) as { type?: string; props?: { level?: number }; content?: unknown }[]
  const textOf = (c: unknown): string =>
    Array.isArray(c) ? c.map((x) => (x && typeof x === 'object' && 'text' in x ? String((x as { text: unknown }).text) : '')).join('') : ''
  let at = blocks.findIndex((x) => x?.type === 'heading' && textOf(x.content).trim().toLowerCase() === 'briefing')
  if (at >= 0) {
    const level = Number(blocks[at].props?.level ?? 1)
    let end = at + 1
    while (end < blocks.length && !(blocks[end]?.type === 'heading' && Number(blocks[end].props?.level ?? 1) <= level)) end++
    blocks.splice(at, end - at)
  } else {
    at = 0
  }
  blocks.splice(at, 0, ...(briefingBlocks(b) as unknown as typeof blocks))
  repo.updatePage(entry.id, { content: JSON.stringify(blocks) })
  repo.setSetting(INSERTED_KEY, b.date)
  return repo.getPageById(entry.id)!
}

/**
 * Once a day, the first time today's entry is opened after the briefing has
 * arrived, the briefing goes into it. Deleting the section afterwards sticks.
 */
export function ensureInEntry(entry: Page): Page {
  const b = today()
  if (!b || repo.getSetting(INSERTED_KEY) === b.date) return entry
  try {
    return addToEntry()
  } catch {
    return entry
  }
}

// ---------------------------------------------------------------- timers

let pushTimer: ReturnType<typeof setTimeout> | null = null
let pullTimer: ReturnType<typeof setInterval> | null = null

/** A page was saved: push a fresh snapshot once editing settles. */
export function pageChanged(): void {
  if (!isEnabled()) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    void pushSnapshot()
  }, PUSH_DEBOUNCE_MS)
}

export function start(): void {
  if (!isEnabled() || pullTimer) return
  setTimeout(() => void syncNow(), 15_000)
  pullTimer = setInterval(() => void pull(), PULL_EVERY_MS)
}

export function stop(): void {
  if (pullTimer) clearInterval(pullTimer)
  pullTimer = null
}

/** On quit: push a snapshot that was still waiting on its debounce. */
export async function flush(): Promise<void> {
  if (!pushTimer) return
  clearTimeout(pushTimer)
  pushTimer = null
  await pushSnapshot()
}
