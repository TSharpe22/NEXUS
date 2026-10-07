/**
 * What do Home's Habits, Week and Calendar widgets look like with something in
 * them? Seeds a scratch vault with two habits (done, missed and blank days)
 * and a calendar feed with past, today and future events, then screenshots
 * Home and Tracker → Habits. No assertions: this is for looking at.
 *
 *   npm run build && node scripts/probes/home-look.mjs
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createServer } from 'http'
import { fileURLToPath } from 'url'

const APP = process.env.APP_DIR || fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')
const SHOT = process.env.SCREENSHOT_DIR || '/tmp/shots'
mkdirSync(SHOT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pad = (n) => String(n).padStart(2, '0')
const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const day = (offset) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d
}
const at = (offset, h, m = 0) => {
  const d = day(offset)
  d.setHours(h, m, 0, 0)
  return d
}
const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const monday = (() => {
  const d = new Date()
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
})()
const fromMonday = (n) => Math.round((monday - new Date()) / 864e5) + n

const events = [
  ['Gym — legs', fromMonday(0), 7, 8],
  ['Standup', fromMonday(1), 9, 9.5],
  ['Dentist', fromMonday(1), 14, 15],
  ['MMA class', fromMonday(2), 18, 19.5],
  ['Spanish lesson', 0, 17, 18],
  ['Fight night', 0, 21, 23],
  ['Market open review', fromMonday(4), 9, 10],
  ['Long run', fromMonday(5), 8, 9.5]
]
const ics = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//nexus//home-look//EN',
  ...events.flatMap(([title, off, h1, h2], i) => [
    'BEGIN:VEVENT', `UID:look-${i}`, `SUMMARY:${title}`,
    `DTSTART:${stamp(at(off, Math.floor(h1), (h1 % 1) * 60))}`,
    `DTEND:${stamp(at(off, Math.floor(h2), (h2 % 1) * 60))}`, 'END:VEVENT'
  ]),
  'BEGIN:VEVENT', 'UID:look-allday', 'SUMMARY:Rest day',
  `DTSTART;VALUE=DATE:${localISO(day(fromMonday(6))).replace(/-/g, '')}`, 'END:VEVENT',
  'END:VCALENDAR', ''
].join('\r\n')
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/calendar' })
  res.end(ics)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nexus-look-'))}`, APP],
  cwd: APP,
  env: { ...process.env, NODE_ENV: 'production' },
  timeout: 45_000
})
const page = await app.firstWindow()
await page.setViewportSize({ width: 1400, height: 1000 })
await page.waitForSelector('.nx-app', { timeout: 20_000 })

// Two habits over the last two weeks: done, missed (an entry saying no) and
// blank (no entry at all) all present.
const plan = {
  Meditation: [1, 1, 0, null, 1, 1, 1, 0, 1, null, 1, 1, 1, 1],
  Training: [1, null, 1, 0, null, 1, null, 1, 0, 1, null, 1, 1, null]
}
await page.evaluate(async ({ plan, start }) => {
  for (const [name, marks] of Object.entries(plan)) {
    const type = await window.api.types.create(name, null)
    await window.api.types.defineProperty(type.id, 'Date', 'date')
    await window.api.types.defineProperty(type.id, 'Done', 'boolean')
    for (let i = 0; i < marks.length; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (iso > new Date().toISOString().slice(0, 10) || marks[i] === null) continue
      const p = await window.api.pages.create(type.id)
      await window.api.pages.update(p.id, { title: `${name} ${iso}` })
      await window.api.properties.set(p.id, 'date', 'date', iso)
      await window.api.properties.set(p.id, 'done', 'boolean', marks[i] ? 'true' : 'false')
    }
  }
}, { plan, start: (() => { const d = new Date(monday); d.setDate(d.getDate() - 7); return d.getTime() })() })
await page.evaluate(async (port) => {
  for (const f of await window.api.calendar.feeds()) await window.api.calendar.removeFeed(f.id)
  await window.api.calendar.addFeed('Proton', `http://127.0.0.1:${port}/cal.ics`)
  await window.api.dashboard.set(JSON.stringify({
    version: 1,
    widgets: [
      { id: 'w-habits', kind: 'habits', config: {}, span: 6 },
      { id: 'w-week', kind: 'week', config: {}, span: 6 },
      { id: 'w-cal', kind: 'calendar', config: {}, span: 12 }
    ]
  }))
}, port)

const nav = (label) =>
  page.evaluate((label) => {
    const item = [...document.querySelectorAll('.nx-nav-item')].find((el) => el.textContent.trim() === label)
    item?.click()
  }, label)
await page.reload()
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await sleep(2000)
await page.screenshot({ path: `${SHOT}/look-home.png` })
for (const [sel, name] of [['.nx-home__habits', 'habits'], ['.nx-home__cal', 'calendar'], ['.nx-home__week-strip', 'week']]) {
  const el = await page.$(sel)
  if (el) await el.screenshot({ path: `${SHOT}/look-${name}.png` })
}

await page.evaluate(() => window.nexus.store.getState().setTrackerMode('habits'))
await nav('Tracker')
await sleep(1000)
await page.screenshot({ path: `${SHOT}/look-tracker-habits.png` })

console.log(`shots in ${SHOT}`)
await app.close()
server.close()
