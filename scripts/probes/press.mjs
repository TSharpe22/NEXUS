// Press feedback: does each kind of clickable change the instant the button goes down?
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const APP = process.env.APP_DIR
const SHOT = process.env.SCREENSHOT_DIR || '/tmp/shots-probe'
mkdirSync(SHOT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nexus-press-'))}`, APP],
  cwd: APP, env: { ...process.env, NODE_ENV: 'production' }, timeout: 45_000
})
const page = await app.firstWindow()
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await page.setViewportSize({ width: 1500, height: 950 })

const seeded = await page.evaluate(async () => {
  const uid = () => crypto.randomUUID()
  const ids = []
  for (let i = 0; i < 12; i++) ids.push((await window.api.pages.create()).id)
  for (let i = 0; i < 12; i++) await window.api.pages.update(ids[i], { title: `Note ${i}`, content: JSON.stringify([{ id: uid(), type: 'paragraph', props: {}, content: [{ type: 'text', text: 'see ', styles: {} }, { type: 'pageMention', props: { pageId: ids[(i + 1) % 12], pageTitle: 'x' } }], children: [] }]) })
  const f = await window.api.folders.create('Journal', null)
  for (const id of ids.slice(0, 3)) await window.api.pages.move(id, f.id)
  const c = await window.api.canvases.create('Board')
  await window.api.canvases.update(c.id, { content: JSON.stringify({ version: 1, nodes: [{ id: 'a', type: 'text', text: 'card', x: 0, y: 0, width: 240, height: 120 }], edges: [] }) })
  return { canvas: c.id }
})
await page.evaluate(() => window.location.reload())
await page.waitForSelector('.nx-app', { timeout: 30_000 })
await sleep(1200)

// Press on `sel`, read `prop` of `readSel` (default: same element) on the very next frame, compare with hover-only.
async function press(label, sel, prop, want, readSel = null) {
  const el = page.locator(sel).first()
  await el.scrollIntoViewIfNeeded()
  const b = await el.boundingBox()
  const x = b.x + Math.min(20, b.width / 2), y = b.y + b.height / 2
  await page.mouse.move(x, y); await sleep(250)
  const read = () => el.evaluate((e, prop) => new Promise((r) => requestAnimationFrame(() => r(getComputedStyle(e)[prop]))), prop)
  const hover = await read()
  await page.mouse.down()
  const pressed = await read()
  await page.mouse.up()
  await sleep(150)
  const ok = typeof want === 'function' ? want(pressed, hover) : pressed === want
  check(`${label}: pressed looks different from hovered, on the first frame`, ok && pressed !== hover, `hover ${hover} → press ${pressed}`)
}
const tint = 'rgba(105, 180, 138, 0.14)'
const accent = 'rgb(105, 180, 138)'

await page.evaluate(() => window.nexus.store.getState().setActiveView('notes'))
await page.waitForSelector('.nx-tree-row', { timeout: 10_000 }); await sleep(500)
await press('sidebar nav item', '.nx-nav-item >> nth=3', 'backgroundColor', tint)
await page.evaluate(() => window.nexus.store.getState().setActiveView('notes'))
await page.waitForSelector('.nx-tree-row--page'); await sleep(400)
await press('page tree row', '.nx-tree-row:not(.nx-tree-row--folder) >> nth=4', 'backgroundColor', tint)
await press('folder row', '.nx-tree-row--folder', 'backgroundColor', tint)
await press('a button', '.nx-notes__trash-toggle', 'translate', '0px 1px')
const dur = await page.evaluate(() => getComputedStyle(document.querySelector('.nx-nav-item')).transitionDuration)
check('hover still eases (80ms), so only the press is instant', dur.split(',').every((d) => d.trim() === '0.08s'), dur)

// canvas card
await page.evaluate((id) => window.nexus.store.getState().openCanvas(id), seeded.canvas)
await page.waitForSelector('.react-flow__node[data-id="a"]'); await sleep(800)
await press('canvas card', '.react-flow__node[data-id="a"] .nx-canvas-card', 'borderTopColor', accent)
const cb = await page.locator('.react-flow__node[data-id="a"]').boundingBox()
await page.mouse.move(cb.x + 60, cb.y + 60); await page.mouse.down()
await page.mouse.move(cb.x + 120, cb.y + 90, { steps: 6 })
const lifted = await page.evaluate(() => { const c = document.querySelector('.react-flow__node[data-id="a"] .nx-canvas-card'); const s = getComputedStyle(c); return { bg: s.backgroundColor, outline: s.outlineColor, cursor: getComputedStyle(c.parentElement).cursor } })
await page.screenshot({ path: join(SHOT, 'card-carried.png') })
await page.mouse.up()
check('a carried card is lifted onto the raised surface with an accent edge', lifted.bg === 'rgb(28, 32, 29)' && lifted.outline === accent, JSON.stringify(lifted))
check('and the hand is closed while carrying it', lifted.cursor === 'grabbing', lifted.cursor)

// graph node
await page.evaluate(() => window.nexus.store.getState().setActiveView('home'))
await page.waitForSelector('.nx-graph__node--page'); await sleep(5000)
await page.evaluate(() => document.querySelector('.nx-graph__canvas').scrollIntoView({ block: 'center' })); await sleep(300)
const nd = await page.evaluate(() => { const r = document.querySelectorAll('.nx-graph__node--page .nx-graph__node-dot')[2].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await page.mouse.move(nd.x, nd.y); await sleep(250)
const gHover = await page.evaluate(({ x, y }) => { const d = document.elementFromPoint(x, y).closest('.nx-graph__node').querySelector('.nx-graph__node-dot'); return getComputedStyle(d).stroke }, nd)
await page.mouse.down()
const gPress = await page.evaluate(({ x, y }) => new Promise((r) => requestAnimationFrame(() => { const n = document.elementFromPoint(x, y).closest('.nx-graph__node'); r({ stroke: getComputedStyle(n.querySelector('.nx-graph__node-dot')).stroke, cursor: getComputedStyle(n).cursor }) })), nd)
await page.mouse.up()
check('graph node: an accent ring and a closed hand on press', gPress.stroke === accent && gPress.cursor === 'grabbing' && gHover !== gPress.stroke, `hover ${gHover} → ${JSON.stringify(gPress)}`)

await app.close()
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS')
process.exit(failed ? 1 : 0)
