/** Graph: does it settle, fit its panel, and stay interactive? */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
const APP = process.env.APP_DIR
const SHOT = process.env.SCREENSHOT_DIR || '/tmp/shots-after'
const N = Number(process.env.SEED_PAGES || 400)
mkdirSync(SHOT, { recursive: true })
const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nexus-g-'))}`, APP],
  cwd: APP, env: { ...process.env, NODE_ENV: 'production' }, timeout: 45_000
})
const page = await app.firstWindow()
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await page.setViewportSize({ width: 1280, height: 820 })
await page.evaluate(async (n) => {
  const uid = () => crypto.randomUUID()
  const ids = []
  for (let i = 0; i < n; i++) ids.push((await window.api.pages.create()).id)
  for (let i = 0; i < n; i++)
    await window.api.pages.update(ids[i], {
      title: `Page ${i}`,
      content: JSON.stringify([{ id: uid(), type: 'paragraph', props: {}, content: [{ type: 'text', text: 'see ', styles: {} }, { type: 'pageMention', props: { pageId: ids[(i * 17 + 3) % n], pageTitle: 'x' } }], children: [] }])
    })
}, N)
await page.evaluate(() => window.location.reload())
await page.waitForSelector('.nx-app', { timeout: 30_000 })
await sleep(12000)  // well past MAX_TICKS
const box = await page.evaluate(() => {
  const svg = document.querySelector('.nx-graph__canvas')
  const g = svg.querySelector('g > g')
  const r = svg.getBoundingClientRect()
  const b = g.getBBox()
  const m = g.getScreenCTM()
  const corners = [[b.x, b.y], [b.x + b.width, b.y + b.height]].map(([x, y]) => {
    const p = svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(m)
  })
  return {
    transform: g.getAttribute('transform'),
    nodes: svg.querySelectorAll('.nx-graph__node').length,
    labels: svg.querySelectorAll('.nx-graph__node-label').length,
    panel: { w: Math.round(r.width), h: Math.round(r.height) },
    drawn: { w: Math.round(corners[1].x - corners[0].x), h: Math.round(corners[1].y - corners[0].y) },
    overflowLeft: Math.round(r.left - corners[0].x),
    overflowRight: Math.round(corners[1].x - r.right)
  }
})
log(JSON.stringify(box, null, 1))
await page.screenshot({ path: `${SHOT}/graph-settled.png` })
// interaction still works?
await page.evaluate(() => document.querySelector('.nx-graph__controls button:last-child')?.click())
await sleep(600)
log('after fit:', await page.evaluate(() => document.querySelector('.nx-graph__canvas g > g').getAttribute('transform')))
await page.screenshot({ path: `${SHOT}/graph-fit.png` })
await app.close()
process.exit(0)
