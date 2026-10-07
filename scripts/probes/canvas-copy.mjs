// Canvas resize, click tolerance, copy/cut/paste between canvases, and the graph's
// instant hover and still-under-the-pointer drift. Throwaway vault.
//     APP_DIR=$PWD SCREENSHOT_DIR=/tmp/shots node scripts/probes/canvas-copy.mjs
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
  args: ['--no-sandbox', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nexus-verify-'))}`, APP],
  cwd: APP, env: { ...process.env, NODE_ENV: 'production' }, timeout: 45_000
})
const page = await app.firstWindow()
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await page.setViewportSize({ width: 1500, height: 950 })

const seeded = await page.evaluate(async () => {
  const uid = () => crypto.randomUUID()
  const ids = []
  for (let i = 0; i < 40; i++) ids.push((await window.api.pages.create()).id)
  for (let i = 1; i < 40; i++) {
    const content = [{ id: uid(), type: 'paragraph', props: {}, content: [{ type: 'text', text: 'see ', styles: {} }, { type: 'pageMention', props: { pageId: ids[(i * 7) % 40], pageTitle: 'x' } }], children: [] }]
    await window.api.pages.update(ids[i], { title: `Note ${i}`, content: JSON.stringify(content) })
  }
  await window.api.pages.update(ids[0], { title: 'Spanish hub' })
  const mk = (i, extra = {}) => ({ id: `n${i}`, type: 'text', text: `card ${i}`, x: (i % 3) * 320, y: Math.floor(i / 3) * 220, width: 240, height: 120, ...extra })
  const a = await window.api.canvases.create('Board A')
  const nodes = [mk(0), mk(1), mk(2), mk(3), { id: 'pg', type: 'page', pageId: ids[0], x: 320, y: 220, width: 260, height: 160 },
    { id: 'grp', type: 'group', label: 'Box', x: -40, y: 440, width: 600, height: 260 },
    { id: 'in1', type: 'text', text: 'inside one', x: 0, y: 500, width: 200, height: 100 },
    { id: 'in2', type: 'text', text: 'inside two', x: 300, y: 500, width: 200, height: 100 }]
  const edges = [{ id: 'e1', fromNode: 'n0', toNode: 'n1', fromSide: 'right', toSide: 'left' }, { id: 'e2', fromNode: 'in1', toNode: 'in2' }]
  await window.api.canvases.update(a.id, { content: JSON.stringify({ version: 1, nodes, edges }) })
  const b = await window.api.canvases.create('Board B')
  return { a: a.id, b: b.id }
})
await page.evaluate(() => window.location.reload())
await page.waitForSelector('.nx-app', { timeout: 30_000 })
await sleep(1200)

const stored = (id) => page.evaluate(async (id) => JSON.parse((await window.api.canvases.get(id)).content), id)
const box = (id) => page.evaluate((id) => { const r = document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height } }, id)
const isSel = (id) => page.evaluate((id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.classList.contains('selected'), id)
const flush = () => sleep(900)
const clickEmpty = async () => { const r = await page.evaluate(() => { const p = document.querySelector('.react-flow__pane').getBoundingClientRect(); return { x: p.x + p.width - 60, y: p.y + p.height - 200 } }); await page.mouse.click(r.x, r.y) }

// ===== CANVAS =====
await page.evaluate((id) => window.nexus.store.getState().openCanvas(id), seeded.a)
await page.waitForSelector('.react-flow__node[data-id="n0"]', { timeout: 20_000 })
await page.evaluate(() => document.querySelector('.nx-canvas-bar button[title="Fit everything"]')?.click())
await sleep(600)
const zoom = await page.evaluate(() => { const t = document.querySelector('.react-flow__viewport').style.transform; return Number(/scale\(([\d.]+)\)/.exec(t)?.[1] ?? 1) })
console.log(`  (canvas zoom ${zoom.toFixed(2)})`)

// wobble click
let b1 = await box('n1')
await page.mouse.move(b1.x + b1.w / 2, b1.y + b1.h / 2)
await page.mouse.down(); await page.mouse.move(b1.x + b1.w / 2 + 2, b1.y + b1.h / 2 + 2, { steps: 2 }); await page.mouse.up()
await sleep(300)
let b1b = await box('n1')
check('a click with a 2px wobble selects without moving the card', (await isSel('n1')) && Math.abs(b1b.x - b1.x) < 0.5 && Math.abs(b1b.y - b1.y) < 0.5)
// a real drag still drags
await page.mouse.move(b1.x + b1.w / 2, b1.y + b1.h / 2)
await page.mouse.down(); await page.mouse.move(b1.x + b1.w / 2 + 40, b1.y + b1.h / 2, { steps: 6 }); await page.mouse.up()
await sleep(300)
b1b = await box('n1')
check('a real drag still moves the card', b1b.x - b1.x > 30, `moved ${(b1b.x - b1.x).toFixed(0)}px`)

// resize an UNselected card from its right edge (3px inside, away from the arrow handle at the middle)
await clickEmpty(); await sleep(200)
const b2 = await box('n2')
check('the card starts unselected', !(await isSel('n2')))
await page.mouse.move(b2.x + b2.w - 2, b2.y + b2.h * 0.25)
await sleep(150)
const cursor = await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)).cursor, { x: b2.x + b2.w - 2, y: b2.y + b2.h * 0.25 })
check('hovering an edge shows a resize cursor', cursor === 'ew-resize', cursor)
await page.mouse.down(); await page.mouse.move(b2.x + b2.w + 80, b2.y + b2.h * 0.25, { steps: 8 }); await page.mouse.up()
await sleep(300)
const b2b = await box('n2')
check('dragging an unselected card\'s edge resizes it', b2b.w - b2.w > 50 && Math.abs(b2b.x - b2.x) < 1, `width ${b2.w.toFixed(0)} → ${b2b.w.toFixed(0)}`)
// corner of an unselected card
await clickEmpty(); await sleep(200)
const b3 = await box('n3')
await page.mouse.move(b3.x + b3.w - 1, b3.y + b3.h - 1); await sleep(150)
await page.mouse.down(); await page.mouse.move(b3.x + b3.w + 50, b3.y + b3.h + 40, { steps: 8 }); await page.mouse.up()
await sleep(300)
const b3b = await box('n3')
check('dragging an unselected card\'s corner resizes it', b3b.w - b3.w > 30 && b3b.h - b3.h > 20 && Math.abs(b3b.x - b3.x) < 1, `${b3.w.toFixed(0)}x${b3.h.toFixed(0)} → ${b3b.w.toFixed(0)}x${b3b.h.toFixed(0)}`)
const handleOpacity = await page.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node[data-id="n0"] .nx-canvas-resize-handle')).opacity)
check('resize corners are invisible on a card that is neither hovered nor selected', handleOpacity === '0', handleOpacity)
// arrow handle at the middle of an edge still starts an arrow
await clickEmpty(); await sleep(200)
const before = (await stored(seeded.a)).edges.length
const s0 = await box('n0'); const t2 = await box('n2')
await page.mouse.move(s0.x + s0.w / 2, s0.y + s0.h - 1); await sleep(150)
await page.mouse.down()
for (let i = 1; i <= 12; i++) await page.mouse.move(s0.x + s0.w / 2 + ((t2.x + t2.w / 2 - s0.x - s0.w / 2) * i) / 12, s0.y + s0.h + ((t2.y + 5 - s0.y - s0.h) * i) / 12)
await page.mouse.up(); await flush()
check('the middle of an edge still draws an arrow', (await stored(seeded.a)).edges.length === before + 1)
await page.keyboard.press('Control+z'); await flush()

// ---- copy / paste ----
const count = async () => (await stored(seeded.a)).nodes.length
await clickEmpty(); await sleep(200)
const n0 = await box('n0')
await page.mouse.click(n0.x + n0.w / 2, n0.y + n0.h / 2)
await page.keyboard.down('Control'); await page.mouse.click(b1b.x + b1b.w / 2, b1b.y + b1b.h / 2); await page.keyboard.up('Control')
await sleep(200)
check('two cards selected', (await isSel('n0')) && (await isSel('n1')))
await page.keyboard.press('Control+c')
await sleep(200)
const clip = await app.evaluate(({ clipboard }) => ({ text: clipboard.readText(), formats: clipboard.availableFormats() }))
check('copy puts readable text on the system clipboard', clip.text.includes('card 0') && clip.text.includes('card 1'), JSON.stringify(clip.text))
const n0count = await count()
// paste at pointer, empty spot
const pane = await page.evaluate(() => { const r = document.querySelector('.react-flow__pane').getBoundingClientRect(); return { x: r.x + r.width - 250, y: r.y + 150 } })
await page.mouse.move(pane.x, pane.y)
await page.keyboard.press('Control+v')
await flush()
let doc = await stored(seeded.a)
check('paste adds the two cards', doc.nodes.length === n0count + 2, `${n0count} → ${doc.nodes.length}`)
const pasted = doc.nodes.filter((n) => !['n0', 'n1', 'n2', 'n3', 'pg', 'grp', 'in1', 'in2'].includes(n.id))
check('pasted cards have new ids and the same text', pasted.length === 2 && pasted.map((n) => n.text).sort().join() === 'card 0,card 1')
const pastedIds = new Set(pasted.map((n) => n.id))
check('the arrow between them is pasted too, pointing at the copies', doc.edges.some((e) => pastedIds.has(e.fromNode) && pastedIds.has(e.toNode)))
const selNow = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node.selected')].map((n) => n.dataset.id))
check('the pasted cards are what is selected afterwards', selNow.length === 2 && selNow.every((id) => pastedIds.has(id)))
const pb = await box(pasted[0].id); const pb2 = await box(pasted[1].id)
const cx = (Math.min(pb.x, pb2.x) + Math.max(pb.x + pb.w, pb2.x + pb2.w)) / 2
check('they land centred on the pointer', Math.abs(cx - pane.x) < 20, `centre ${cx.toFixed(0)} vs pointer ${pane.x.toFixed(0)}`)
await page.screenshot({ path: join(SHOT, 'after-paste.png') })
// paste again same spot steps
await page.keyboard.press('Control+v'); await flush()
doc = await stored(seeded.a)
const third = doc.nodes.filter((n) => !['n0', 'n1', 'n2', 'n3', 'pg', 'grp', 'in1', 'in2'].includes(n.id) && !pastedIds.has(n.id))
check('a second paste in the same spot steps down-right', third.length === 2 && third[0].x !== pasted.find((p) => p.text === third[0].text).x)
// undo removes the paste
await page.keyboard.press('Control+z'); await flush()
check('undo takes a paste back', (await count()) === n0count + 2)

// copy a group: contents come too
await clickEmpty(); await sleep(200)
const g = await box('grp')
await page.mouse.click(g.x + g.w - 30, g.y + g.h - 20)
await sleep(200)
check('group selected', await isSel('grp'))
await page.keyboard.press('Control+c'); await sleep(200)

// paste into another canvas
await page.evaluate((id) => window.nexus.store.getState().openCanvas(id), seeded.b)
await page.waitForSelector('.nx-canvas-hint', { timeout: 10_000 })
await sleep(600)
await page.mouse.move(700, 500)
await page.keyboard.press('Control+v'); await flush()
let docB = await stored(seeded.b)
check('a group pasted into another canvas brings what was inside it', docB.nodes.length === 3 && docB.nodes.some((n) => n.type === 'group' && n.label === 'Box') && docB.nodes.filter((n) => n.type === 'text').length === 2, `${docB.nodes.length} nodes`)
check('and the arrow inside it', docB.edges.length === 1)
const grp = docB.nodes.find((n) => n.type === 'group')
check('contents stay inside the pasted group', docB.nodes.filter((n) => n.type === 'text').every((n) => n.x >= grp.x && n.y >= grp.y && n.x + n.width <= grp.x + grp.width && n.y + n.height <= grp.y + grp.height))

// cut
await clickEmpty(); await sleep(200)
const t = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node-text')].map((n) => n.dataset.id))
const tb = await box(t[0])
await page.mouse.click(tb.x + tb.w / 2, tb.y + tb.h / 2); await sleep(200)
await page.keyboard.press('Control+x'); await flush()
docB = await stored(seeded.b)
check('cut removes the card', docB.nodes.length === 2)
await page.mouse.move(400, 300)
await page.keyboard.press('Control+v'); await flush()
docB = await stored(seeded.b)
check('and paste puts it back', docB.nodes.length === 3)

// page card copy keeps pageId; plain text uses [[title]]
await page.evaluate((id) => window.nexus.store.getState().openCanvas(id), seeded.a)
await page.waitForSelector('.react-flow__node[data-id="pg"]', { timeout: 10_000 }); await sleep(600)
await clickEmpty(); await sleep(200)
const pgb = await box('pg')
await page.mouse.click(pgb.x + 20, pgb.y + 10); await sleep(200)
await page.keyboard.press('Control+c'); await sleep(200)
const clip2 = await app.evaluate(({ clipboard }) => clipboard.readText())
check('a page card copies as a [[link]] in plain text', clip2 === '[[Spanish hub]]', JSON.stringify(clip2))
await page.mouse.move(pgb.x + 600, pgb.y); await page.keyboard.press('Control+v'); await flush()
doc = await stored(seeded.a)
check('a pasted page card shows the same page', doc.nodes.filter((n) => n.type === 'page' && n.pageId === doc.nodes.find((x) => x.id === 'pg').pageId).length === 2)

// copying text out of an editing card is left alone
await page.mouse.dblclick((await box('n3')).x + 40, (await box('n3')).y + 40)
await page.waitForSelector('.nx-canvas-card__textarea')
await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c'); await sleep(200)
check('Ctrl+C inside an editing card copies its text, not cards', (await app.evaluate(({ clipboard }) => clipboard.readText())) === 'card 3')
const nBefore = (await stored(seeded.a)).nodes.length
await page.keyboard.press('End'); await page.keyboard.press('Control+v'); await sleep(200)
check('Ctrl+V inside an editing card pastes text into it', (await page.inputValue('.nx-canvas-card__textarea')) === 'card 3card 3')
await page.keyboard.press('Escape'); await flush()
check('and adds no cards', (await stored(seeded.a)).nodes.length === nBefore)
// plain text from outside still makes a text card
await app.evaluate(({ clipboard }) => clipboard.writeText('from another app'))
await clickEmpty(); await sleep(200)
await page.mouse.move(pane.x, pane.y + 300)
await page.keyboard.press('Control+v'); await flush()
check('outside text still pastes as a text card', (await stored(seeded.a)).nodes.some((n) => n.text === 'from another app'))
await page.screenshot({ path: join(SHOT, 'canvas-final.png') })

// ===== GRAPH =====
await page.evaluate(() => window.nexus.store.getState().setActiveView('home'))
await page.waitForSelector('.nx-graph__node--page', { timeout: 20_000 })
await sleep(6000)
const dur = await page.evaluate(() => ({
  edge: getComputedStyle(document.querySelector('.nx-graph__edge')).transitionDuration,
  dot: getComputedStyle(document.querySelector('.nx-graph__node-dot')).transitionDuration
}))
check('graph edges and dots change state instantly', dur.edge === '0s' && dur.dot === '0s', JSON.stringify(dur))
const tf = () => page.evaluate(() => [...document.querySelectorAll('.nx-graph__node')].slice(0, 15).map((n) => n.getAttribute('transform')).join('|'))
await page.mouse.move(5, 940); await sleep(300)
const o1 = await tf(); await sleep(400); const o2 = await tf()
check('nodes drift while the pointer is away', o1 !== o2)
await page.evaluate(() => document.querySelector('.nx-graph__canvas').scrollIntoView({ block: 'center' }))
await sleep(300)
const panel = await page.evaluate(() => { const r = document.querySelector('.nx-graph__canvas').getBoundingClientRect(); return { x: r.x + r.width * 0.06, y: r.y + r.height * 0.55 } })
check('(test) the pointer is really over the graph', await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.nx-graph__canvas'), panel))
await page.mouse.move(panel.x, panel.y); await sleep(200)
const i1 = await tf(); await sleep(800); const i2 = await tf()
check('nodes hold still while the pointer is over the graph', i1 === i2)
// leaving resumes without a jump: compare max displacement over one frame
await page.mouse.move(5, 940)
const jump = await page.evaluate(async () => {
  const read = () => [...document.querySelectorAll('.nx-graph__node')].slice(0, 15).map((n) => /translate\(([-\d.e]+),\s*([-\d.e]+)\)/.exec(n.getAttribute('transform')).slice(1).map(Number))
  const a = read(); await new Promise((r) => setTimeout(r, 120)); const b = read()
  return Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])))
})
check('drift resumes smoothly when the pointer leaves', jump < 1, `max ${jump.toFixed(2)}px in 120ms`)
const frames = await page.evaluate(() => new Promise((res) => { const t = []; let last = performance.now(); const f = (n) => { t.push(n - last); last = n; if (t.length < 60) requestAnimationFrame(f); else res(t) }; requestAnimationFrame(f) }))
check('idle drift keeps up with the display', frames.filter((f) => f > 34).length <= 2, `${frames.filter((f) => f > 34).length} slow frames of 60`)
// clicking a node still opens it
const nb = await page.evaluate(() => { const r = document.querySelectorAll('.nx-graph__node--page .nx-graph__node-dot')[3].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
await page.mouse.move(nb.x, nb.y); await sleep(100)
await page.mouse.click(nb.x, nb.y)
check('clicking a graph node still opens its page', await page.waitForSelector('.bn-editor', { timeout: 5000 }).then(() => true).catch(() => false))

await app.close()
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS')
process.exit(failed ? 1 : 0)
