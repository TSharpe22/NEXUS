import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
const APP = process.env.APP_DIR, SHOT = process.env.SHOT // SHOT: optional path for a mid-drag screenshot
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (n, ok, d = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const app = await electron.launch({ executablePath: join(APP, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nx-c-'))}`, APP], cwd: APP, env: { ...process.env, NODE_ENV: 'production' }, timeout: 45000 })
const page = await app.firstWindow(); await page.waitForSelector('.nx-app'); await page.setViewportSize({ width: 1400, height: 900 })
const id = await page.evaluate(async () => { const t = (x) => [{ type: 'text', text: x, styles: {} }]; const u = () => crypto.randomUUID(); const p = await window.api.pages.create(); const b = [
 { id: u(), type: 'paragraph', props: {}, content: t('Alpha line'), children: [] },
 { id: u(), type: 'heading', props: { level: 2 }, content: t('Heading'), children: [] },
 { id: u(), type: 'paragraph', props: {}, content: t('Bravo line'), children: [] },
 { id: u(), type: 'bulletListItem', props: {}, content: t('bullet'), children: [] },
 { id: u(), type: 'checkListItem', props: { checked: false }, content: t('check'), children: [] },
 { id: u(), type: 'numberedListItem', props: {}, content: t('number'), children: [] },
 { id: u(), type: 'toggle', props: { open: true }, content: t('Toggle'), children: [{ id: u(), type: 'paragraph', props: {}, content: t('inside'), children: [] }] },
 { id: u(), type: 'paragraph', props: {}, content: t('Charlie line'), children: [] },
 { id: u(), type: 'paragraph', props: {}, content: t('Delta line'), children: [] }]
 await window.api.pages.update(p.id, { title: 'C', content: JSON.stringify(b) }); return p.id })
await page.evaluate(() => window.location.reload()); await page.waitForSelector('.nx-app'); await sleep(600)
await page.evaluate((id) => window.nexus.store.getState().openPage(id), id); await page.waitForSelector('.bn-editor'); await sleep(700)

const m = await page.evaluate(() => { const ed = document.querySelector('.bn-editor').getBoundingClientRect(); const g = (t) => { const c = document.querySelector(`.bn-block-content[data-content-type="${t}"]`); const r = c.getBoundingClientRect(); const ic = c.querySelector('.bn-inline-content').getBoundingClientRect(); return { h: Math.round(r.height), x: Math.round(ic.left - ed.left) } }; return { heading: g('heading'), bullet: g('bulletListItem'), check: g('checkListItem'), number: g('numberedListItem') } })
check('heading spacing matches the 0.24 editor (54px)', m.heading.h === 54, JSON.stringify(m.heading))
check('bullet text lines up as before (14px)', m.bullet.x === 14, String(m.bullet.x))
check('checklist text lines up as before (20px)', m.check.x === 20, String(m.check.x))
check('numbered text lines up as before (21px)', Math.abs(m.number.x - 21) <= 1, String(m.number.x))
const tr = await page.evaluate(() => getComputedStyle(document.querySelector('.bn-block-content')).transitionDuration + ' / ' + getComputedStyle(document.querySelector('.bn-block-outer')).transitionDuration)
check('blocks change type and position without easing', tr.split(/[ \/,]+/).filter(Boolean).every((d) => d === '0s'), tr)

// toggle chevron keeps its rotation while pressed
const chev = page.locator('.nx-toggle__chevron').first(); const cb = await chev.boundingBox()
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2); await sleep(150); await page.mouse.down()
const held = await chev.evaluate((e) => new Promise((r) => requestAnimationFrame(() => { const s = getComputedStyle(e); r({ transform: s.transform, translate: s.translate, color: s.color }) })))
await page.mouse.move(cb.x + cb.width / 2 + 200, cb.y + 200); await page.mouse.up()
check('an open toggle\'s chevron stays rotated while pressed, and dips', /^matrix\(0, 1, -1, 0/.test(held.transform) && held.translate === '0px 1px', JSON.stringify(held))
check('and takes the accent while held', held.color === 'rgb(105, 180, 138)', held.color)

// handle
const order = () => page.evaluate(() => [...document.querySelectorAll('.bn-block-content[data-content-type="paragraph"] .bn-inline-content')].map((e) => e.textContent.split(' ')[0]).filter((w) => w !== 'inside').join(','))
const blk = page.locator('.bn-block-content[data-content-type="paragraph"] >> nth=0'); const bb = await blk.boundingBox()
await page.mouse.move(bb.x + 30, bb.y + bb.height / 2); await sleep(400)
const hl = page.locator('.bn-side-menu [draggable="true"]').first()
const h = await hl.boundingBox(); const hc = await hl.evaluate((e) => getComputedStyle(e).cursor)
check('the drag handle shows an open hand', hc === 'grab', hc)
const before = await order()
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await sleep(100); await page.mouse.down()
const pressed = await hl.evaluate((e) => new Promise((r) => requestAnimationFrame(() => { const s = getComputedStyle(e); r({ bg: s.backgroundColor, color: s.color, cursor: s.cursor }) })))
check('pressing the handle takes hold: accent tint, accent, closed hand', pressed.bg === 'rgba(105, 180, 138, 0.14)' && pressed.color === 'rgb(105, 180, 138)' && pressed.cursor === 'grabbing', JSON.stringify(pressed))
const dest = await page.locator('.bn-block-content[data-content-type="paragraph"] >> nth=4').boundingBox()
for (let i = 1; i <= 20; i++) { await page.mouse.move(h.x + 40, h.y + ((dest.y + dest.height - 3 - h.y) * i) / 20); await sleep(20) }
await sleep(250)
const mid = await page.evaluate(() => { const dc = document.querySelector('.prosemirror-dropcursor-block'); const sel = document.querySelector('.bn-block-outer.ProseMirror-selectednode > .bn-block'); return { dc: dc && { bg: getComputedStyle(dc).backgroundColor, h: getComputedStyle(dc).height, tr: getComputedStyle(dc).transitionDuration }, sel: sel && { bg: getComputedStyle(sel).backgroundColor, edge: getComputedStyle(sel).boxShadow, text: sel.textContent.slice(0, 12) } } })
if (SHOT) await page.screenshot({ path: SHOT })
check('the landing line is a 2px accent hairline that jumps, not glides', mid.dc && mid.dc.bg === 'rgb(105, 180, 138)' && mid.dc.h === '2px' && mid.dc.tr === '0s', JSON.stringify(mid.dc))
check('the block being carried is marked in the document', mid.sel && mid.sel.bg === 'rgba(105, 180, 138, 0.14)' && mid.sel.edge.includes('105, 180, 138') && mid.sel.text.startsWith('Alpha'), JSON.stringify(mid.sel))
await page.mouse.up(); await sleep(500)
const after = await order()
check('and the drop moves it', before !== after && after.indexOf('Alpha') > 0, `${before} → ${after}`)
await app.close()
console.log(failed ? `\n${failed} FAILED` : '\nALL PASS'); process.exit(failed ? 1 : 0)
