/**
 * The things a click test cannot assert: does dragging a graph node navigate,
 * does a settled graph still move, and does chrome text select?
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const APP = process.env.APP_DIR
const SHOT = process.env.SCREENSHOT_DIR || '/tmp/shots-interaction'
mkdirSync(SHOT, { recursive: true })
const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nexus-int-'))}`, APP],
  cwd: APP,
  env: { ...process.env, NODE_ENV: 'production' },
  timeout: 45_000
})
const page = await app.firstWindow()
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await page.setViewportSize({ width: 1280, height: 820 })

await page.evaluate(async () => {
  const uid = () => crypto.randomUUID()
  const ids = []
  for (let i = 0; i < 12; i++) ids.push((await window.api.pages.create()).id)
  for (let i = 0; i < 12; i++) {
    await window.api.pages.update(ids[i], {
      title: `Node ${i}`,
      content: JSON.stringify([
        {
          id: uid(),
          type: 'paragraph',
          props: {},
          content: [
            { type: 'text', text: 'see ', styles: {} },
            { type: 'pageMention', props: { pageId: ids[(i + 1) % 12], pageTitle: 'x' } }
          ],
          children: []
        }
      ])
    })
  }
})
await page.evaluate(() => window.location.reload())
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await sleep(9000) // let the layout settle

const nav = (label) =>
  page.evaluate((label) => {
    ;[...document.querySelectorAll('.nx-nav-item')].find((e) => e.textContent.trim() === label)?.click()
  }, label)

// ------------------------------------------------------------ drag vs click
log('— dragging a graph node —')
const before = await page.evaluate(() => window.nexus.store.getState().activeView)
const box = await page.evaluate(() => {
  const n = document.querySelector('.nx-graph__node')
  const r = n.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await page.mouse.move(box.x, box.y)
await page.mouse.down()
for (const dx of [6, 12, 18, 24, 18, 12]) await page.mouse.move(box.x + dx, box.y + dx / 2)
await page.mouse.up()
await sleep(900)
const afterDrag = await page.evaluate(() => window.nexus.store.getState().activeView)
log(`  view before: ${before}, after a drag: ${afterDrag}`)
log(`  drag navigated: ${afterDrag !== before}  (want false)`)

// ------------------------------------------------------------ genuine click
log('\n— clicking a graph node —')
const box2 = await page.evaluate(() => {
  const n = document.querySelector('.nx-graph__node')
  const r = n.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await page.mouse.click(box2.x, box2.y)
await sleep(900)
const afterClick = await page.evaluate(() => window.nexus.store.getState().activeView)
log(`  view after a click: ${afterClick}  (want notes)`)

// ------------------------------------------------------------ idle drift
log('\n— idle drift on a settled graph —')
await nav('Home')
await sleep(9000)
const drift = await page.evaluate(async () => {
  const read = () => document.querySelector('.nx-graph__node').getAttribute('transform')
  const samples = [read()]
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 260))
    samples.push(read())
  }
  const parse = (t) => t.match(/-?[\d.]+/g).map(Number)
  const xs = samples.map((s) => parse(s)[0])
  const ys = samples.map((s) => parse(s)[1])
  return {
    distinct: new Set(samples).size,
    xSpread: +(Math.max(...xs) - Math.min(...xs)).toFixed(2),
    ySpread: +(Math.max(...ys) - Math.min(...ys)).toFixed(2)
  }
})
log(`  ${JSON.stringify(drift)}  (want distinct > 1, spreads a few px)`)

// ------------------------------------------------------------ selection
log('\n— chrome text selection —')
const selectable = await page.evaluate(() => {
  const style = (sel) => {
    const el = document.querySelector(sel)
    return el ? getComputedStyle(el).userSelect : 'NO_ELEMENT'
  }
  return {
    navItem: style('.nx-nav-item'),
    panelTitle: style('.nx-panel__title'),
    captureInput: style('.nx-home__capture-input')
  }
})
log(`  ${JSON.stringify(selectable)}  (want none/none/text)`)

await page.screenshot({ path: `${SHOT}/home.png` })
await nav('Tracker')
await sleep(1200)
await page.screenshot({ path: `${SHOT}/tracker.png` })
await nav('Settings')
await sleep(1200)
await page.screenshot({ path: `${SHOT}/settings.png` })
await nav('Notes')
await sleep(1200)
await page.screenshot({ path: `${SHOT}/notes.png` })

await app.close()
process.exit(0)
