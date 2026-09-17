/**
 * Canvas: can you actually build a board, with the mouse and keyboard, and does
 * what you built survive a reload, the mirror and the rest of the app?
 *
 *     npm run build
 *     APP_DIR=$PWD xvfb-run -a node scripts/probes/canvas.mjs
 *
 * Every step drives the real UI where a person would — double-click, drag a
 * handle, press a key — and then asks the database what was stored, because a
 * canvas that looks right and saved something else is the failure worth
 * catching.
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const APP = process.env.APP_DIR
const SHOT = process.env.SCREENSHOT_DIR || '/tmp/shots-canvas'
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
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nexus-canvas-'))}`, APP],
  cwd: APP,
  env: { ...process.env, NODE_ENV: 'production' },
  timeout: 45_000
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await page.setViewportSize({ width: 1600, height: 1000 })

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const SAVE_WAIT = 1200

const pages = await page.evaluate(async () => {
  const uid = () => crypto.randomUUID()
  const make = async (title, text) => {
    const p = await window.api.pages.create()
    await window.api.pages.update(p.id, {
      title,
      content: JSON.stringify([{ id: uid(), type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }])
    })
    return p.id
  }
  return { trading: await make('Trading Revival', 'Size down and trade the plan.'), training: await make('Training', 'Three sessions a week.') }
})
await page.evaluate(() => window.location.reload())
await page.waitForSelector('.nx-app')

const doc = async () => {
  const id = await page.evaluate(() => document.querySelector('.nx-canvas-rail__item.is-active')?.getAttribute('data-canvas-id'))
  const list = await page.evaluate(() => window.api.canvases.list())
  const canvas = await page.evaluate((cid) => window.api.canvases.get(cid), id ?? list[0]?.id)
  return canvas ? { canvas, doc: JSON.parse(canvas.content) } : null
}
const centre = (sel) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, left: r.x, top: r.y }
  }, sel)
const pane = () => centre('.react-flow__pane')
/** A point on bare canvas: the pane itself is the topmost element there. */
const emptySpot = () =>
  page.evaluate(() => {
    const r = document.querySelector('.react-flow__pane').getBoundingClientRect()
    for (let fy = 0.9; fy > 0.1; fy -= 0.05) {
      for (let fx = 0.1; fx < 0.9; fx += 0.05) {
        const x = r.x + r.width * fx
        const y = r.y + r.height * fy
        if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y }
      }
    }
    return null
  })
/**
 * A point on a card that the card itself is topmost at — not a handle, not a
 * resize control, not another card lying over it. `within` narrows the search
 * to a part of the card, such as its header.
 */
const spotOn = (nodeId, within = '.nx-canvas-card') =>
  page.evaluate(({ nodeId, within }) => {
    const host = document.querySelector(`[data-id="${nodeId}"]`)
    const target = host?.querySelector(within) ?? host
    if (!target) return null
    const r = target.getBoundingClientRect()
    for (let fy = 0.5; fy < 0.95; fy += 0.07) {
      for (const fy2 of [fy, 1 - fy]) {
        for (let fx = 0.5; fx < 0.95; fx += 0.07) {
          for (const fx2 of [fx, 1 - fx]) {
            const x = r.x + r.width * fx2
            const y = r.y + r.height * fy2
            const top = document.elementFromPoint(x, y)
            if (!top || top.closest('.react-flow__handle, .react-flow__resize-control, button, .react-flow__node-toolbar')) continue
            if (top.closest('.react-flow__node')?.getAttribute('data-id') === nodeId) return { x, y }
          }
        }
      }
    }
    return null
  }, { nodeId, within })
const clickCard = async (nodeId, within) => {
  const spot = await spotOn(nodeId, within)
  if (!spot) throw new Error(`no clickable point on ${nodeId}`)
  await page.mouse.click(spot.x, spot.y)
}
const dragCard = async (nodeId, dx, dy, within) => {
  const spot = await spotOn(nodeId, within)
  if (!spot) throw new Error(`no draggable point on ${nodeId}`)
  await page.mouse.move(spot.x, spot.y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(spot.x + (dx * i) / 10, spot.y + (dy * i) / 10)
  await page.mouse.up()
}
const clickEmpty = async () => {
  const spot = await emptySpot()
  await page.mouse.click(spot.x, spot.y)
}

// ---------------------------------------------------------------- the section
log('— the section —')
await page.keyboard.press(`${MOD}+6`)
await sleep(600)
check('Cmd/Ctrl+6 opens Canvas', await page.evaluate(() => !!document.querySelector('.nx-canvas-screen')))
check('the nav lists Canvas', await page.evaluate(() => [...document.querySelectorAll('.nx-nav-item')].some((n) => /Canvas/.test(n.textContent))))
check('an empty vault offers a new canvas', await page.evaluate(() => /No canvas open/.test(document.querySelector('.nx-canvas-main').innerText)))

await page.click('.nx-canvas-rail__top button')
await sleep(900)
check('New canvas opens a board', await page.evaluate(() => !!document.querySelector('.react-flow')))
await page.fill('.nx-canvas-main__title', 'Quarter plan')
await sleep(SAVE_WAIT)
check('the title is saved', (await page.evaluate(() => window.api.canvases.list()))[0]?.title === 'Quarter plan')

// ---------------------------------------------------------------- text cards
log('— text cards —')
let p = await pane()
await page.mouse.dblclick(p.x - 300, p.y - 120)
await sleep(400)
check('double-clicking the canvas makes a card in edit mode', await page.evaluate(() => !!document.querySelector('.nx-canvas-card__textarea')))
await page.keyboard.type('# Goals\n- **Consistency** first\n- see [[Training]]')
await page.mouse.click(p.x + 350, p.y + 250)
await sleep(SAVE_WAIT)
check('leaving the card renders its markdown', await page.evaluate(() => document.querySelector('.nx-canvas-card__md h1')?.textContent === 'Goals'))
let state = await doc()
const textNode = state.doc.nodes.find((n) => n.type === 'text')
check('the card is stored as a JSON Canvas text node', !!textNode && textNode.text.includes('[[Training]]') && textNode.width > 0, JSON.stringify(textNode))
check('a [[link]] in a text card puts the canvas on that page', (await page.evaluate((id) => window.api.canvases.forPage(id), pages.training)).length === 1)

// ---------------------------------------------------------------- page cards
log('— page cards —')
await page.click('.nx-canvas-bar button:text-is("+ page")')
await sleep(300)
await page.keyboard.type('Trading')
await page.keyboard.press('Enter')
await sleep(SAVE_WAIT)
state = await doc()
const pageNode = state.doc.nodes.find((n) => n.type === 'page')
check('the picker places a page card', pageNode?.pageId === pages.trading)
check('the card previews the page body', await page.evaluate(() => /Size down/.test(document.querySelector('.nx-canvas-card--page .nx-canvas-card__preview')?.textContent ?? '')))
check('the page knows it is on the canvas', (await page.evaluate((id) => window.api.canvases.forPage(id), pages.trading)).length === 1)

// Move the page card clear of the text card so the handles are reachable.
const pageSel = `[data-id="${pageNode.id}"]`
const textSel = `[data-id="${textNode.id}"]`
await dragCard(pageNode.id, 350, 100, '.nx-canvas-card__head')
await sleep(SAVE_WAIT)
const moved = (await doc()).doc.nodes.find((n) => n.id === pageNode.id)
check('dragging a card moves it, and the move is saved', moved.x - pageNode.x > 250, `${pageNode.x} → ${moved.x}`)

// ---------------------------------------------------------------- undo
log('— undo —')
await clickEmpty()
await page.keyboard.press(`${MOD}+z`)
await sleep(SAVE_WAIT)
check('undo puts the card back', (await doc()).doc.nodes.find((n) => n.id === pageNode.id).x === pageNode.x)
await page.keyboard.press(`${MOD}+Shift+z`)
await sleep(SAVE_WAIT)
check('redo moves it again', (await doc()).doc.nodes.find((n) => n.id === pageNode.id).x === moved.x)

// ---------------------------------------------------------------- arrows
log('— arrows —')
await page.hover(textSel)
const from = await centre(`${textSel} .react-flow__handle-right`)
await page.hover(pageSel)
const to = await centre(`${pageSel} .react-flow__handle-left`)
await page.mouse.move(from.x, from.y)
await page.mouse.down()
for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12)
await page.mouse.up()
await sleep(SAVE_WAIT)
state = await doc()
const edge = state.doc.edges[0]
check('dragging from a card edge to another card draws an arrow', !!edge && edge.fromNode === textNode.id && edge.toNode === pageNode.id, JSON.stringify(edge))
check('the arrow records the sides it joins', edge?.fromSide === 'right' && edge?.toSide === 'left')

await page.click(`.react-flow__edge[data-id="${edge.id}"]`, { force: true }).catch(() => {})
const edgePath = await centre(`.react-flow__edge[data-id="${edge.id}"] .react-flow__edge-interaction`)
await page.mouse.dblclick(edgePath.x, edgePath.y)
await sleep(300)
await page.keyboard.type('drives')
await page.keyboard.press('Enter')
await sleep(SAVE_WAIT)
check('double-clicking an arrow labels it', (await doc()).doc.edges[0]?.label === 'drives')

// ---------------------------------------------------------------- colour
log('— colour and resize —')
await clickCard(textNode.id)
await sleep(300)
await page.click('.react-flow__node-toolbar button[aria-label="Colour warning"]')
await sleep(SAVE_WAIT)
check('a swatch colours the card', (await doc()).doc.nodes.find((n) => n.id === textNode.id).color === 'warning')

const before = (await doc()).doc.nodes.find((n) => n.id === textNode.id)
const corner = await centre(`${textSel} .react-flow__resize-control.handle.bottom.right`)
await page.mouse.move(corner.x, corner.y)
await page.mouse.down()
for (let i = 1; i <= 8; i++) await page.mouse.move(corner.x + i * 10, corner.y + i * 8)
await page.mouse.up()
await sleep(SAVE_WAIT)
const after = (await doc()).doc.nodes.find((n) => n.id === textNode.id)
check('dragging a corner resizes the card', after.width > before.width + 40 && after.height > before.height + 30, `${before.width}×${before.height} → ${after.width}×${after.height}`)
await page.screenshot({ path: SHOT + '/1-board.png' })

// ---------------------------------------------------------------- editing a page in place
log('— editing a page in place —')
await clickEmpty()
await page.dblclick(`${pageSel} .nx-canvas-card__preview`)
await sleep(1200)
check('double-clicking a page card mounts the block editor in it', await page.evaluate((sel) => !!document.querySelector(`${sel} .nx-canvas-card__editor .bn-editor`), pageSel))
await page.click(`${pageSel} .bn-inline-content`)
await page.keyboard.press('End')
await page.keyboard.type(' Edited on the canvas.')
await sleep(1500)
const body = await page.evaluate((id) => window.api.pages.getById(id).then((p) => p.content), pages.trading)
check('typing in the card saves the page itself', body.includes('Edited on the canvas.'))
check('only one editor is mounted', (await page.evaluate(() => document.querySelectorAll('.bn-editor').length)) === 1)
await page.keyboard.press('Backspace')
check('Backspace inside the editor edits text, not the canvas', (await doc()).doc.nodes.some((n) => n.id === pageNode.id))
await clickEmpty()
await sleep(600)
await page.screenshot({ path: SHOT + '/editor-left.png' })
check('clicking the canvas leaves the editor', await page.evaluate(() => !document.querySelector('.nx-canvas-card__editor')))
check('and the preview shows the edit', await page.evaluate((sel) => /Edited on the canvas/.test(document.querySelector(`${sel} .nx-canvas-card__preview`)?.textContent ?? ''), pageSel))

// ---------------------------------------------------------------- groups
log('— groups —')
await page.click('.nx-canvas-bar button:text-is("+ group")')
await sleep(300)
await page.keyboard.type('Now')
await page.keyboard.press('Enter')
await sleep(SAVE_WAIT)
state = await doc()
const group = state.doc.nodes.find((n) => n.type === 'group')
check('+ group makes a named group', group?.label === 'Now')
check('groups are stored before cards, so they draw underneath', state.doc.nodes[0].type === 'group')

// Put a fresh card inside the group by double-clicking in its body.
const gBox = await centre(`[data-id="${group.id}"] .nx-canvas-card`)
await page.mouse.dblclick(gBox.left + 40, gBox.top + gBox.h - 40)
await sleep(300)
await page.keyboard.type('inside')
await clickEmpty()
await sleep(SAVE_WAIT)
state = await doc()
const inner = state.doc.nodes.find((n) => n.type === 'text' && n.text === 'inside')
check('double-clicking inside a group writes a card there', !!inner)

// The card was centred on the click, so it may overhang; pull it fully inside
// by shrinking it through the stored document, then drag the group by its body.
const g = state.doc.nodes.find((n) => n.id === group.id)
const fits = inner.x >= g.x && inner.y >= g.y && inner.x + inner.width <= g.x + g.width && inner.y + inner.height <= g.y + g.height
if (!fits) {
  await page.evaluate(async ({ cid, gid, iid }) => {
    const c = await window.api.canvases.get(cid)
    const d = JSON.parse(c.content)
    const gg = d.nodes.find((n) => n.id === gid)
    const ii = d.nodes.find((n) => n.id === iid)
    Object.assign(ii, { x: gg.x + 30, y: gg.y + 30, width: 160, height: 80 })
    await window.api.canvases.update(cid, { content: JSON.stringify(d) })
  }, { cid: state.canvas.id, gid: group.id, iid: inner.id })
  await page.evaluate(() => window.location.reload())
  await page.waitForSelector('.nx-app')
  await page.keyboard.press(`${MOD}+6`)
  await page.waitForSelector('.react-flow__node')
  await sleep(1000)
  state = await doc()
}
const innerBefore = state.doc.nodes.find((n) => n.id === inner.id)
const groupBefore = state.doc.nodes.find((n) => n.id === group.id)
await dragCard(group.id, 120, 60)
await sleep(SAVE_WAIT)
state = await doc()
const groupAfter = state.doc.nodes.find((n) => n.id === group.id)
const innerAfter = state.doc.nodes.find((n) => n.id === inner.id)
const gdx = groupAfter.x - groupBefore.x
check('dragging a group moves it', gdx > 50, `moved ${gdx}`)
check('and carries the cards inside it', innerAfter.x - innerBefore.x === gdx && innerAfter.y - innerBefore.y === groupAfter.y - groupBefore.y, `card moved ${innerAfter.x - innerBefore.x}, ${innerAfter.y - innerBefore.y}`)

// ---------------------------------------------------------------- make page
log('— make page —')
await clickCard(inner.id)
await sleep(300)
await page.click('.react-flow__node-toolbar button:text-is("make page")')
await sleep(SAVE_WAIT + 400)
state = await doc()
const converted = state.doc.nodes.find((n) => n.id === inner.id)
const madePage = converted?.pageId && (await page.evaluate((id) => window.api.pages.getById(id), converted.pageId))
check('make page turns a text card into a page card', converted?.type === 'page' && !('text' in converted))
check('and the page exists, titled from the card', madePage?.title === 'inside')

// ---------------------------------------------------------------- delete, duplicate
log('— delete and duplicate —')
await clickCard(textNode.id)
await page.keyboard.press(`${MOD}+d`)
await sleep(SAVE_WAIT)
check('Cmd/Ctrl+D duplicates the selection', (await doc()).doc.nodes.filter((n) => n.type === 'text' && n.text.includes('Goals')).length === 2)
await page.keyboard.press('Backspace')
await sleep(SAVE_WAIT)
state = await doc()
check('Backspace deletes the selected card', state.doc.nodes.filter((n) => n.type === 'text' && n.text.includes('Goals')).length === 1)
await clickCard(textNode.id)
await page.keyboard.press('Delete')
await sleep(SAVE_WAIT)
state = await doc()
check('deleting a card takes its arrows with it', !state.doc.nodes.some((n) => n.id === textNode.id) && state.doc.edges.length === 0)
check('a card that goes takes its [[link]] ref with it', (await page.evaluate((id) => window.api.canvases.forPage(id), pages.training)).length === 0)

// ---------------------------------------------------------------- images
log('— images —')
/** A real PNG, drawn in the page: `w`×`h`, one colour. */
const makePng = (w, h, colour) =>
  page.evaluateHandle(async ({ w, h, colour }) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    g.fillStyle = colour
    g.fillRect(0, 0, w, h)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    return new File([blob], `drawn-${w}x${h}.png`, { type: 'image/png' })
  }, { w, h, colour })

const imageCount = async () => (await doc()).doc.nodes.filter((n) => n.type === 'image').length
let spot = await emptySpot()
const wide = await makePng(400, 200, '#69b48a')
await page.evaluate(({ file, x, y }) => {
  const dt = new DataTransfer()
  dt.items.add(file)
  const target = document.elementFromPoint(x, y)
  target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
  target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
}, { file: wide, x: spot.x, y: spot.y })
await sleep(SAVE_WAIT + 300)
state = await doc()
const dropped = state.doc.nodes.find((n) => n.type === 'image')
check('dropping a picture file makes an image card', !!dropped)
check('the card names a stored attachment, not a path', /^[0-9a-f]{64}\.png$/.test(dropped?.file ?? ''), dropped?.file)
check('and starts at the picture\'s proportions', dropped && Math.abs(dropped.width / dropped.height - 2) < 0.05, `${dropped?.width}×${dropped?.height}`)
check('the picture draws', await page.evaluate((id) => {
  const img = document.querySelector(`[data-id="${id}"] img`)
  return !!img && img.complete && img.naturalWidth === 400
}, dropped.id))

const tall = await makePng(120, 240, '#7ea3c9')
await clickEmpty()
await page.evaluate((file) => {
  const dt = new DataTransfer()
  dt.items.add(file)
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
}, tall)
await sleep(SAVE_WAIT + 300)
check('pasting a picture makes an image card', (await imageCount()) === 2)

await clickEmpty()
await page.evaluate(() => {
  const dt = new DataTransfer()
  dt.setData('text/plain', 'pasted thought')
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
})
await sleep(SAVE_WAIT)
check('pasting text makes a text card', (await doc()).doc.nodes.some((n) => n.type === 'text' && n.text === 'pasted thought'))
check('a paste into a text field is left to the field', await page.evaluate(async () => {
  const before = (await window.api.canvases.get((await window.api.canvases.list())[0].id)).content
  const input = document.querySelector('.nx-canvas-main__title')
  input.focus()
  const dt = new DataTransfer()
  dt.setData('text/plain', 'not a card')
  input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 1200))
  input.blur()
  const after = (await window.api.canvases.get((await window.api.canvases.list())[0].id)).content
  return !after.includes('not a card') && before.length > 0
}))

// Resizing an image keeps its shape. Fitted first: by now the board is
// bigger than the window, and a handle off-screen cannot be grabbed.
await page.click('.nx-canvas-bar button:text-is("fit")')
await sleep(500)
await clickCard(dropped.id)
await sleep(200)
const imgCorner = await centre(`[data-id="${dropped.id}"] .react-flow__resize-control.handle.bottom.right`)
await page.mouse.move(imgCorner.x, imgCorner.y)
await page.mouse.down()
for (let i = 1; i <= 8; i++) await page.mouse.move(imgCorner.x + i * 15, imgCorner.y + i * 2)
await page.mouse.up()
await sleep(SAVE_WAIT)
const resizedImg = (await doc()).doc.nodes.find((n) => n.id === dropped.id)
check('resizing an image keeps its proportions', Math.abs(resizedImg.width / resizedImg.height - 2) < 0.08 && resizedImg.width > dropped.width, `${resizedImg.width}×${resizedImg.height}`)

const stats = await page.evaluate(() => window.api.files.stats())
check('reclaiming space counts canvas pictures as in use', stats.unreferencedCount === 0, JSON.stringify(stats))
await page.evaluate(() => window.api.files.reclaim())
await page.evaluate(() => window.location.reload())
await page.waitForSelector('.nx-app')
await page.keyboard.press(`${MOD}+6`)
await page.waitForSelector('.react-flow__node-image img')
await sleep(900)
check('and a reclaim leaves them on disk', await page.evaluate(() =>
  [...document.querySelectorAll('.react-flow__node-image img')].every((img) => img.complete && img.naturalWidth > 0)))

// ---------------------------------------------------------------- persistence
log('— persistence —')
await page.evaluate(async (cid) => {
  const c = await window.api.canvases.get(cid)
  const d = JSON.parse(c.content)
  d.nodes.push({ id: 'from-the-future', type: 'sticker', x: 900, y: 900, width: 120, height: 80, emoji: 'star' })
  await window.api.canvases.update(cid, { content: JSON.stringify(d) })
}, state.canvas.id)
await page.evaluate(() => window.location.reload())
await page.waitForSelector('.nx-app')
await page.keyboard.press(`${MOD}+6`)
await page.waitForSelector('.react-flow__node')
await sleep(900)
const reloaded = await doc()
check('a reload draws what was saved', (await page.evaluate(() => document.querySelectorAll('.react-flow__node').length)) === reloaded.doc.nodes.length)
check('a card type from a later build is drawn as a placeholder', await page.evaluate(() => /sticker/.test(document.querySelector('.nx-canvas-card--unknown')?.textContent ?? '')))
// Any edit rewrites the whole document; the unknown card must ride through it.
const anyCard = reloaded.doc.nodes.find((n) => n.type === 'page')
await clickCard(anyCard.id, '.nx-canvas-card__head')
await page.click('.react-flow__node-toolbar button[aria-label="Colour info"]')
await sleep(SAVE_WAIT)
const kept = (await doc()).doc.nodes.find((n) => n.id === 'from-the-future')
check('and survives the next save untouched', kept?.emoji === 'star' && kept?.type === 'sticker')

// ---------------------------------------------------------------- the rest of the app
log('— the rest of the app —')
await page.keyboard.press(`${MOD}+k`)
await page.keyboard.type('Quarter')
await sleep(500)
check('the palette finds canvases by title', await page.evaluate(() => /Quarter plan/.test(document.querySelector('.nx-palette')?.innerText ?? '')))
await page.keyboard.press('Escape')

await page.keyboard.press(`${MOD}+k`)
await page.keyboard.type('Trading Revival')
await sleep(600)
await page.keyboard.press('Enter')
await sleep(1200)
await page.evaluate(() => document.querySelector('.nx-backlinks__toggle')?.click())
await sleep(500)
check("a page's backlinks list the canvas it is on", await page.evaluate(() => /Quarter plan[\s\S]*on canvas/.test(document.querySelector('.nx-backlinks')?.innerText ?? '')))
await page.click('.nx-backlinks__item:has-text("on canvas")')
await sleep(900)
check('and clicking it opens the canvas', await page.evaluate(() => !!document.querySelector('.react-flow') && document.querySelector('.nx-canvas-main__title')?.value === 'Quarter plan'))

// ---------------------------------------------------------------- mirror
log('— mirror —')
const mirrorDir = mkdtempSync(join(tmpdir(), 'nexus-canvas-mirror-'))
await page.evaluate((dir) => window.api.mirror.setFolder(dir), mirrorDir)
await page.evaluate(() => window.api.mirror.syncNow())
const canvasDir = join(mirrorDir, 'Canvases')
const files = existsSync(canvasDir) ? readdirSync(canvasDir) : []
check('the mirror writes a .canvas file', files.includes('Quarter plan.canvas'), files.join(', '))
if (files.includes('Quarter plan.canvas')) {
  const written = JSON.parse(readFileSync(join(canvasDir, 'Quarter plan.canvas'), 'utf-8'))
  const fileNode = written.nodes.find((n) => n.type === 'file')
  check('page cards become JSON Canvas file nodes pointing at the mirrored note', fileNode?.file?.endsWith('.md') && existsSync(join(mirrorDir, fileNode.file)), fileNode?.file)
  check('colours become JSON Canvas presets', written.nodes.some((n) => /^[1-6]$/.test(n.color ?? '')))
  const pictures = written.nodes.filter((n) => n.type === 'file' && n.file.startsWith('_files/'))
  check('image cards become file nodes pointing at copied pictures', pictures.length === 2 && pictures.every((n) => existsSync(join(mirrorDir, n.file))), pictures.map((n) => n.file).join(', '))
}

// ---------------------------------------------------------------- trash
log('— trash —')
const cid = (await page.evaluate(() => window.api.canvases.list()))[0].id
await page.hover('.nx-canvas-rail__item')
await page.click('.nx-canvas-rail__item button:text-is("trash")')
await sleep(600)
check('trashing a canvas takes it off the list', (await page.evaluate(() => window.api.canvases.list())).length === 0)
check('and off the page it showed', (await page.evaluate((id) => window.api.canvases.forPage(id), pages.trading)).length === 0)
await page.click('.nx-canvas-rail__trash')
await sleep(400)
await page.click('.nx-canvas-rail__item button:text-is("restore")')
await sleep(800)
check('restore brings it back and opens it', (await page.evaluate(() => window.api.canvases.list())).some((c) => c.id === cid) && await page.evaluate(() => !!document.querySelector('.react-flow')))

check('no errors in the renderer', errors.length === 0, errors.slice(0, 3).join(' | '))
await page.screenshot({ path: SHOT + '/2-end.png' })
await app.close()
log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
