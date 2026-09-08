/**
 * Typing: what does a keystroke cost in a vault that is actually in use?
 *
 * "Blocks respond poorly" is reported from daily use and had no reproduction,
 * which is what kept it off the fix list. The suspicion this probe was written
 * to test is that the cost is not BlockNote's at all: the autosave the typing
 * triggers writes the page back into the renderer's store, and everything
 * subscribed to that store — the folder tree, the properties panel, the editor
 * itself — re-renders on the beat, 600ms after you stop.
 *
 * So it types a burst into a real page in a seeded vault and records every
 * long task the renderer's main thread runs while it does. A long task is
 * 50ms+ of blocked main thread: a dropped keystroke, a caret that lands late,
 * a menu that opens after you have typed past it.
 *
 *     npm run build
 *     APP_DIR=$PWD SEED_PAGES=400 xvfb-run -a node scripts/probes/typing.mjs
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const APP = process.env.APP_DIR
const SHOT = process.env.SCREENSHOT_DIR || '/tmp/shots-typing'
const N = Number(process.env.SEED_PAGES || 400)
const KEYS = Number(process.env.KEYSTROKES || 160)
mkdirSync(SHOT, { recursive: true })
const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nexus-t-'))}`, APP],
  cwd: APP,
  env: { ...process.env, NODE_ENV: 'production' },
  timeout: 45_000
})
const page = await app.firstWindow()
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await page.setViewportSize({ width: 1280, height: 820 })

// A vault with folders and a type carrying properties, because both are on
// screen while you type: the tree in the sidebar, the properties panel above
// the document. A flat vault of untyped pages measures a case nobody has.
log(`seeding ${N} pages…`)
const target = await page.evaluate(async (n) => {
  const folders = []
  for (let i = 0; i < 12; i++) folders.push((await window.api.folders.create(`Folder ${i}`, null)).id)

  const type = await window.api.types.create('Note+', null)
  for (const [name, kind] of [
    ['Status', 'select'],
    ['Due', 'date'],
    ['Score', 'number'],
    ['Source', 'text'],
    ['Done', 'boolean']
  ])
    await window.api.types.defineProperty(type.id, name, kind)

  let first = null
  for (let i = 0; i < n; i++) {
    const p = await window.api.pages.create(type.id)
    if (i === 0) first = p.id
    await window.api.pages.update(p.id, { title: `Seeded page ${i}` })
    await window.api.pages.move(p.id, folders[i % folders.length])
  }
  await window.api.properties.set(first, 'status', 'select', 'open')
  await window.api.properties.set(first, 'source', 'text', 'the probe')
  return first
}, N)

await page.evaluate(() => window.location.reload())
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await sleep(1500)

// Open the page in Notes, with the tree expanded — the state a real session is
// in, not a collapsed sidebar that renders twelve rows.
await page.evaluate((id) => {
  const s = window.nexus.store.getState()
  for (const f of s.folders) s.setFolderExpanded(f.id, true)
  s.openPage(id)
}, target)
await page.waitForSelector('.bn-editor', { timeout: 20_000 })
await sleep(1200)

// Two instruments, because they answer different halves of the question.
// `longtask` names the main-thread blocks a person feels as a dropped
// keystroke; the frame recorder catches the case where the work is spread
// thinly enough to stay under 50ms a task and still miss frames.
await page.evaluate(() => {
  window.__nx_long = []
  window.__nx_frames = []
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__nx_long.push(Math.round(e.duration))
    }).observe({ entryTypes: ['longtask'] })
  } catch {
    window.__nx_long = null // not supported — the frame gaps still stand
  }
  let last = performance.now()
  const tick = (now) => {
    window.__nx_frames.push(now - last)
    last = now
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

log(`typing ${KEYS} keystrokes…`)
await page.click('.bn-editor')
const started = Date.now()
// 55ms apart: faster than the 600ms autosave debounce, so the saves land
// between keystrokes exactly as they do under a person typing a sentence.
await page.keyboard.type('The rate constant rises with temperature. ', { delay: 55 })
await sleep(900)
await page.keyboard.type('Arrhenius gives the shape of it, and the barrier the scale. ', { delay: 55 })
await sleep(900)
await page.keyboard.type('Everything after that is bookkeeping about units.', { delay: 55 })
await sleep(1500)
const elapsed = Date.now() - started

// Proof the burst went where it was aimed. A probe that types into nothing
// reports a very smooth application.
const landed = await page.evaluate(
  (id) => (window.nexus.store.getState().pageContent[id] || '').length,
  target
)

const { long, frames } = await page.evaluate(() => ({
  long: window.__nx_long,
  frames: window.__nx_frames.map((f) => Math.round(f))
}))
const total = (long || []).reduce((a, b) => a + b, 0)
const worst = long && long.length ? Math.max(...long) : 0
// A frame is 16.7ms. Two frames missed is the point a caret stops feeling
// attached to the key that moved it.
const dropped = frames.filter((f) => f > 34)
const worstFrame = frames.length ? Math.max(...frames) : 0

log('')
log(`  pages in vault          ${N}`)
log(`  characters saved        ${landed} (document JSON)`)
log(`  wall time typing        ${elapsed}ms`)
log(`  long tasks (>50ms)      ${long === null ? 'unsupported' : long.length}`)
log(`  blocked on them         ${total}ms  (${((total / elapsed) * 100).toFixed(1)}% of the burst)`)
log(`  worst single task       ${worst}ms`)
log(`  durations               ${(long || []).join(', ') || '—'}`)
log(`  frames drawn            ${frames.length}`)
log(`  frames over 34ms        ${dropped.length}`)
log(`  worst frame gap         ${worstFrame}ms`)
log(`  gaps                    ${dropped.slice(0, 24).join(', ') || '—'}`)

await page.screenshot({ path: join(SHOT, 'typing.png') })
await app.close()
