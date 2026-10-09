/**
 * Practice sessions from trading.db: the Trading page reads the Kairos sim
 * lab's saved sessions (read-only), shows each one's report, and "Write note"
 * makes one Practice session note per session — the second click opens it.
 *
 *   npm run check:practice     (builds, then runs under xvfb)
 *
 * Runs against a scratch userData directory and a copy of a fixture ledger
 * (test-fixtures/trading-practice.db, two sessions saved by Kairos), so it
 * never touches real notes or the real trading.db.
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, mkdtempSync, statSync } from 'fs'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

const APP = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const userDataDir = mkdtempSync(join(tmpdir(), 'nexus-practice-'))
const ledgerDir = mkdtempSync(join(tmpdir(), 'nexus-ledger-'))
const ledger = join(ledgerDir, 'trading.db')
copyFileSync(join(APP, 'test-fixtures/trading-practice.db'), ledger)
const hash = () => createHash('sha256').update(readFileSync(ledger)).digest('hex')
const before = hash()

let fails = 0
const check = (label, ok, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? ' ok  ' : 'FAIL '} ${label}${extra ? ' — ' + extra : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`, APP],
  cwd: APP,
  env: { ...process.env, NODE_ENV: 'production', TRADING_DB: ledger },
  timeout: 45_000
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await sleep(800)

const nav = (label) =>
  page.evaluate((label) => {
    const item = [...document.querySelectorAll('.nx-nav-item')].find((el) => el.textContent.trim() === label)
    item?.click()
    return !!item
  }, label)
const panelTitles = () => page.evaluate(() => [...document.querySelectorAll('.nx-panel__title')].map((e) => e.textContent.trim()))

// ---------------------------------------------------------------- the API
const sessions = await page.evaluate(() => window.api.trading.sessions(10))
check('trading.sessions reads the ledger, newest first', sessions.length === 2 && sessions[0].id > sessions[1].id, JSON.stringify(sessions.map((s) => s.id)))
check('no session has a note yet', sessions.every((s) => s.noteId === null))
const report = await page.evaluate((id) => window.api.trading.session(id), sessions[1].id)
check('a report carries the scorecard and every trade', report && report.scorecard.trades === report.tradeList.length && report.tradeList.length > 0,
  report && `${report.scorecard.trades} / ${report.tradeList.length}`)
check('the report is the one Kairos computed (net = sum of trades)',
  report && Math.abs(report.scorecard.net - report.tradeList.reduce((n, t) => n + t.netPnl, 0)) < 0.01)
const snap = await page.evaluate(() => window.api.trading.snapshot('2026-10-09'))
check('the practice panel is real; the rest stays the simulation', snap.real?.practice === true && snap.source === 'mock')

// ---------------------------------------------------------------- the page
// An empty vault shows its way in instead of panels; a vault with a page in
// it is what the Trading page is for.
await page.locator('button', { hasText: 'New page' }).first().click()
await sleep(600)
check('Trading is in the sidebar', await nav('Trading'))
await sleep(1200)
const titles = await panelTitles()
check('Trading shows Practice and Practice sessions', titles.includes('Practice') && titles.includes('Practice sessions'), titles.join(' | '))
const rows = await page.locator('.nx-tr-session').count()
check('one row per saved session', rows === 2, String(rows))

await page.locator('.nx-tr-session__main').nth(1).click()
await sleep(500)
// SCREENSHOT_DIR=... saves what was checked, for a look by eye.
const shot = async (name) => process.env.SCREENSHOT_DIR && page.screenshot({ path: join(process.env.SCREENSHOT_DIR, name) })
await page.locator('.nx-tr-sessions').scrollIntoViewIfNeeded()
await shot('practice-sessions.png')
const reportText = await page.locator('.nx-tr-report').first().textContent()
check('a row opens its report', /adherence/.test(reportText) && /#1/.test(reportText), reportText.slice(0, 80))

// ---------------------------------------------------------------- the note
await page.locator('.nx-tr-session__note').nth(1).click()
await sleep(1200)
const opened = await page.evaluate(async () => {
  const id = window.nexus.store.getState().activePageId
  return id ? (await window.api.pages.getById(id))?.title ?? '' : ''
})
check('Write note opens a note titled for the session', opened.startsWith(`Practice #${sessions[1].id}`), opened)
await shot('practice-note.png')
const noteBody = await page.evaluate(() => document.querySelector('.bn-editor')?.textContent ?? '')
check('the note starts with the report and keeps the headings to write under',
  /Replayed/.test(noteBody) && /Trades/.test(noteBody) && /What to fix/.test(noteBody), noteBody.slice(0, 120))

const props = await page.evaluate(async (sid) => {
  const s = await window.api.trading.sessions(10)
  const id = s.find((x) => x.id === sid).noteId
  const p = await window.api.properties.getForPage(id)
  return { id, keys: Object.fromEntries(p.map((x) => [x.key, x.value_number ?? x.value_text ?? x.value_date])) }
}, sessions[1].id)
check('the session list now links the note', !!props.id)
check('the note carries the session id and numbers as properties',
  props.keys.session === sessions[1].id && props.keys.mode === 'practice' && typeof props.keys.net === 'number' && !!props.keys.replayed,
  JSON.stringify(props.keys))

await nav('Trading')
await sleep(1000)
const label = await page.locator('.nx-tr-session__note').nth(1).textContent()
check('the button now says Open note', label.trim() === 'Open note', label)
await page.locator('.nx-tr-session__note').nth(1).click()
await sleep(1000)
const count = await page.evaluate(async () => {
  const types = await window.api.types.list()
  const t = types.find((x) => x.name === 'Practice session')
  const all = await window.api.pages.list()
  return all.filter((p) => p.type_id === t.id && !p.title.endsWith('template')).length
})
check('asking again opens the same note rather than making a second', count === 1, String(count))

check('trading.db was never written to', hash() === before)
check('no errors in the renderer', errors.length === 0, errors.join(' | '))

await app.close()
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
