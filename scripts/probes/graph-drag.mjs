/**
 * Graph drag: does a grabbed node stay under the pointer, does the layout
 * react while it is held, and does the fit button frame the graph?
 *
 *     npm run build
 *     APP_DIR=$PWD node scripts/probes/graph-drag.mjs
 *
 * Needs a display: run under xvfb-run where it is installed.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const APP = process.env.APP_DIR
const SHOT = process.env.SCREENSHOT_DIR || '/tmp/shots-graph-drag'
mkdirSync(SHOT, { recursive: true })
const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--disable-gpu',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nexus-gd-'))}`, APP],
  cwd: APP, env: { ...process.env, NODE_ENV: 'production' }, timeout: 45_000
})
const page = await app.firstWindow()
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await page.setViewportSize({ width: 1600, height: 1000 })

// Twenty pages, a ring of six links, a tag and a folder — roughly the vault
// this was reported against, which had no links at all.
await page.evaluate(async () => {
  const uid = () => crypto.randomUUID()
  const ids = []
  for (let i = 0; i < 20; i++) ids.push((await window.api.pages.create()).id)
  for (let i = 0; i < 20; i++) {
    const content = i < 6
      ? [{ id: uid(), type: 'paragraph', props: {}, content: [{ type: 'text', text: 'see ', styles: {} }, { type: 'pageMention', props: { pageId: ids[(i + 1) % 6], pageTitle: 'x' } }], children: [] }]
      : [{ id: uid(), type: 'paragraph', props: {}, content: [{ type: 'text', text: 'plain', styles: {} }], children: [] }]
    await window.api.pages.update(ids[i], { title: `Page ${i}`, content: JSON.stringify(content) })
  }
  for (const id of ids.slice(8, 13)) await window.api.tags.addToPage(id, 'reading')
  const folder = await window.api.folders.create('Journal', null)
  for (const id of ids.slice(14, 19)) await window.api.pages.move(id, folder.id)
})
await page.evaluate(() => window.location.reload())
await page.waitForSelector('.nx-app', { timeout: 30_000 })
await sleep(2000)

const fps = await page.evaluate(() => new Promise((resolve) => {
  let n = 0
  const t0 = performance.now()
  const tick = (t) => (t - t0 < 1000 ? (n++, requestAnimationFrame(tick)) : resolve(n))
  requestAnimationFrame(tick)
}))
log(`  window is painting at ${fps} fps`)

// Wait for the layout to come to rest — idle drift still moves nodes by a
// couple of pixels, so "at rest" is nothing moving further than that in a second.
const centres = () => page.evaluate(() => [...document.querySelectorAll('.nx-graph__node--page .nx-graph__node-dot')].map((d) => {
  const r = d.getBoundingClientRect()
  return [r.x + r.width / 2, r.y + r.height / 2]
}))
let settledAfter = -1
for (let i = 0; i < 20; i++) {
  const a = await centres()
  await sleep(1000)
  const b = await centres()
  if (a.length === b.length && a.every((p, j) => Math.hypot(p[0] - b[j][0], p[1] - b[j][1]) < 6)) { settledAfter = i; break }
}
check('the layout comes to rest', settledAfter >= 0)
const spread = await centres()
let closest = Infinity
for (let i = 0; i < spread.length; i++) for (let j = i + 1; j < spread.length; j++)
  closest = Math.min(closest, Math.hypot(spread[i][0] - spread[j][0], spread[i][1] - spread[j][1]))
check('no two pages settle on top of each other', closest > 18, `closest pair ${closest.toFixed(0)}px apart`)
if (process.env.DEBUG_LAYOUT) log(JSON.stringify(await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.nx-graph__node')].map((g) => {
    const m = /translate\(([-\d.e]+),\s*([-\d.e]+)\)/.exec(g.getAttribute('transform'))
    return { id: g.dataset.nodeId.slice(0, 10), title: g.querySelector('text')?.textContent, x: +m[1], y: +m[2], cls: g.getAttribute('class').replace(/nx-graph__node--?/g, '').trim() }
  })
  const pairs = []
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++)
    pairs.push([Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y).toFixed(1), nodes[i].title, nodes[j].title])
  pairs.sort((a, b) => a[0] - b[0])
  return { closest: pairs.slice(0, 5), zoom: document.querySelector('.nx-graph__canvas g g').getAttribute('transform'), nodes }
}), null, 0))

const data = await page.evaluate(() => window.api.stats.getGraph())
check('graph data carries tags and folders', data.tags.length === 1 && data.folders.length === 1 &&
  data.nodes.filter((n) => n.tag_ids.length).length === 5 && data.nodes.filter((n) => n.folder_id).length === 5,
  `${data.tags.length} tags, ${data.folders.length} folders`)

const panel = await page.evaluate(() => {
  const r = document.querySelector('.nx-graph__canvas')?.getBoundingClientRect()
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
})
log('panel', JSON.stringify(panel))
check('the Home graph is taller than it was', panel && panel.h >= 400, `${panel?.h}px`)
const clipped = await page.evaluate(() => {
  const g = document.querySelector('.nx-graph').getBoundingClientRect()
  const p = document.querySelector('.nx-graph').closest('.nx-panel').getBoundingClientRect()
  return g.bottom - p.bottom
})
check('and its panel does not clip it', clipped <= 1, `${clipped.toFixed(1)}px past the panel`)
check('tag and folder hubs are drawn', await page.evaluate(() =>
  !!document.querySelector('.nx-graph__node--tag') && !!document.querySelector('.nx-graph__node--folder')))

const inside = () => page.evaluate(() => {
  const r = document.querySelector('.nx-graph__canvas').getBoundingClientRect()
  const dots = [...document.querySelectorAll('.nx-graph__node-dot')].map((d) => d.getBoundingClientRect())
  const ok = dots.filter((d) => d.x >= r.x - 1 && d.right <= r.right + 1 && d.y >= r.y - 1 && d.bottom <= r.bottom + 1)
  return { total: dots.length, inside: ok.length }
})
const fitted = await inside()
check('auto-fit frames every node inside the panel', fitted.inside === fitted.total, JSON.stringify(fitted))
await page.screenshot({ path: SHOT + '/1-settled.png' })

const centreOf = (sel) => page.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
}, sel)
const pageNode = (i) => `.nx-graph__node--page:nth-of-type(${i + 1}) .nx-graph__node-dot`
const ids = await page.evaluate(() => [...document.querySelectorAll('.nx-graph__node--page')].map((n) => n.dataset.nodeId))
const sel = (id) => `[data-node-id="${id}"] .nx-graph__node-dot`

// Grab a linked page (its neighbour should follow) and drag it 120px.
const linked = data.edges[0].source
const neighbour = data.edges.find((e) => e.target === linked || e.source === linked && e.target !== linked)
const other = neighbour.source === linked ? neighbour.target : neighbour.source
let start = await centreOf(sel(linked))
// Measure the node that is actually on top at that point: a neighbour's hit
// area can overlap, and the grab goes to whichever is drawn last.
const topId = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-node-id]')?.dataset.nodeId, start)
check('the node aimed at is the one under the pointer', topId === linked, `${topId} vs ${linked}`)
const nStart = await centreOf(sel(other))
const scrollBefore = await page.evaluate(() => document.querySelector('.nx-home')?.closest('[class*=main], main')?.scrollTop ?? window.scrollY)
await page.mouse.move(start.x, start.y)
await page.mouse.down()
const target = { x: start.x + 120, y: start.y + 60 }
for (let s = 1; s <= 12; s++) await page.mouse.move(start.x + 10 * s, start.y + 5 * s)
await sleep(700)
const held = await centreOf(sel(linked))
const miss = Math.hypot(held.x - target.x, held.y - target.y)
check('a grabbed node stays under the pointer', miss < 6, `off by ${miss.toFixed(1)}px`)
const nHeld = await centreOf(sel(other))
const followed = Math.hypot(nHeld.x - nStart.x, nHeld.y - nStart.y)
check('its linked neighbour follows while it is held', followed > 5, `moved ${followed.toFixed(1)}px`)
await page.screenshot({ path: SHOT + '/2-dragged.png' })
await page.mouse.up()
check('letting go does not open the page', await page.evaluate(() => !!document.querySelector('.nx-graph__canvas')))
await sleep(3500)
const released = await centreOf(sel(linked))
check('an unpinned node settles back after release', Math.hypot(released.x - target.x, released.y - target.y) > 8)

// Right-click pins, and the pin is kept on the widget instance.
const pinAt = await centreOf(sel(ids[10]))
await page.mouse.click(pinAt.x, pinAt.y, { button: 'right' })
await sleep(800)
const pinned = await page.evaluate(async (id) => {
  const dash = await window.api.dashboard.get()
  return { el: !!document.querySelector(`[data-node-id="${id}"].nx-graph__node--pinned`), raw: JSON.stringify(dash ?? null) }
}, ids[10])
check('right-click pins a node', pinned.el)
check('the pin is written to the dashboard', pinned.raw.includes(ids[10]), pinned.raw.slice(0, 120))
check('an unpin control appears', await page.evaluate(() => /unpin 1/.test(document.querySelector('.nx-graph__controls').innerText)))

// Wheel zooms the graph and does not scroll Home.
const scroller = await page.evaluate(() => {
  let el = document.querySelector('.nx-graph')
  while (el && !(el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== 'visible')) el = el.parentElement
  return el ? true : false
})
const zoomBefore = await page.evaluate(() => document.querySelector('.nx-graph__canvas g g').getAttribute('transform'))
const scrollTopBefore = await page.evaluate(() => [...document.querySelectorAll('*')].reduce((s, e) => s + e.scrollTop, 0))
await page.mouse.move(panel.x + panel.w / 2, panel.y + panel.h / 2)
await page.mouse.wheel(0, -240)
await sleep(300)
const zoomAfter = await page.evaluate(() => document.querySelector('.nx-graph__canvas g g').getAttribute('transform'))
const scrollTopAfter = await page.evaluate(() => [...document.querySelectorAll('*')].reduce((s, e) => s + e.scrollTop, 0))
check('the wheel zooms the graph', zoomBefore !== zoomAfter)
check('the wheel does not scroll Home', scrollTopBefore === scrollTopAfter, `${scrollTopBefore} → ${scrollTopAfter} (scrollable ancestor: ${scroller})`)

// The size setting.
await page.click('.nx-graph__toolbar button:text-is("L")')
await sleep(600)
const large = await page.evaluate(() => document.querySelector('.nx-graph').getBoundingClientRect().height)
check('size L makes the panel 640px', large === 640, `${large}px`)
await page.click('.nx-graph__toolbar button:text-is("M")')
await sleep(300)

// The full view.
await page.click('button[aria-label="Open the full graph"]')
await sleep(1500)
const full = await page.evaluate(() => document.querySelector('.nx-graph-full .nx-graph')?.getBoundingClientRect().height ?? 0)
check('the full view opens and fills the window', full > 800, `${full}px`)
check('only one graph is mounted while it is open', (await page.evaluate(() => document.querySelectorAll('.nx-graph__canvas').length)) === 1)
const fullInside = await inside()
check('the full view frames every node', fullInside.inside === fullInside.total, JSON.stringify(fullInside))
check('the pin survives into the full view', await page.evaluate((id) => !!document.querySelector(`[data-node-id="${id}"].nx-graph__node--pinned`), ids[10]))
await page.screenshot({ path: SHOT + '/3-full.png' })
await page.keyboard.press('Escape')
await sleep(500)
check('escape closes the full view', await page.evaluate(() => !document.querySelector('.nx-graph-full') && !!document.querySelector('.nx-graph__canvas')))

// Colour cycles.
await page.click('.nx-graph__toolbar button:has-text("colour")')
await sleep(300)
check('colour cycles to type', await page.evaluate(() => /colour: type/.test(document.querySelector('.nx-graph__toolbar').innerText)))

// A tag hub opens the Notes list filtered to that tag.
await sleep(2500)
const tagAt = await centreOf('.nx-graph__node--tag .nx-graph__node-dot')
await page.mouse.click(tagAt.x, tagAt.y)
await sleep(800)
check('clicking a tag hub opens Notes filtered to it', await page.evaluate(() => !document.querySelector('.nx-graph__canvas')))
await page.screenshot({ path: SHOT + '/4-tag.png' })

await app.close()
log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
