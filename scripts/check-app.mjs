/**
 * End-to-end smoke test: launches the built Electron app and drives the real
 * UI through the flows that matter, asserting against the database rather than
 * the DOM wherever "did it actually save?" is the question.
 *
 *   npm run build && npm run check:app
 *
 * On headless Linux this needs an X server: `xvfb-run -a npm run check:app`.
 * Screenshots land in $SCREENSHOT_DIR (default /tmp/shots).
 *
 * Runs against a scratch userData directory so it never touches real notes.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const APP = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const SHOT = process.env.SCREENSHOT_DIR || '/tmp/shots'
const userDataDir = mkdtempSync(join(tmpdir(), 'nexus-check-'))
mkdirSync(SHOT, { recursive: true })

const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, extra = '') => {
  if (!ok) fails++
  log(`${ok ? ' ok  ' : 'FAIL '} ${label}${extra ? ' — ' + extra : ''}`)
}

const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  // A throwaway userData dir keeps this from writing into the real vault.
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`, APP],
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

const clickText = (t) =>
  page.evaluate((t) => {
    const els = [...document.querySelectorAll('button,a,[role="button"],[cmdk-item]')]
    const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t))
    if (!el) return 'NOT_FOUND'
    el.click()
    return 'OK'
  }, t)
const firstPage = () => page.evaluate(() => window.api.pages.getAll().then((p) => p[0]))
const firstDoc = () => page.evaluate(() => window.api.pages.getAll().then((p) => JSON.parse(p[0].content)))
const nav = (i) => page.evaluate((i) => document.querySelectorAll('.nx-nav-item')[i].click(), i)

// ---------------------------------------------------------------- create
log('\n— creating and saving a page —')
check('create page from empty state', (await clickText('New page')) === 'OK')
await page.waitForSelector('.nx-editor__title', { timeout: 10_000 })
await page.click('.nx-editor__title')
await page.keyboard.type('Reaction kinetics', { delay: 20 })
await sleep(900)
check('title persisted', (await firstPage()).title === 'Reaction kinetics')

// ---------------------------------------------------------------- blocks
log('\n— block editing —')
await page.click('.bn-editor .bn-block-content')
await page.keyboard.type('Rate depends on temperature.', { delay: 15 })
await sleep(900)
check('paragraph saved', JSON.stringify(await firstDoc()).includes('Rate depends on temperature'))

await page.keyboard.press('Enter')
await page.keyboard.type('## Arrhenius', { delay: 15 })
await sleep(900)
check('markdown heading shortcut', (await firstDoc()).some((b) => b.type === 'heading'))

await page.keyboard.press('Enter')
await page.keyboard.type('- first item', { delay: 15 })
await sleep(900)
check('markdown bullet shortcut', (await firstDoc()).some((b) => b.type === 'bulletListItem'))
await page.screenshot({ path: SHOT + '/02-editor.png' })

// ---------------------------------------------------------------- slash menu
log('\n— slash menu —')
await page.keyboard.press('Enter')
await page.keyboard.type('/', { delay: 40 })
await sleep(700)
const items = await page.evaluate(() =>
  [...document.querySelectorAll('.bn-ak-menu-item, [role="option"]')].map((e) => e.innerText.split('\n')[0].trim())
)
check('slash menu opens', items.length > 0, `${items.length} items`)
check('Toggle is reachable', items.some((t) => /toggle/i.test(t)))
check('Callout is reachable', items.some((t) => /callout/i.test(t)))
await page.screenshot({ path: SHOT + '/03-slash-menu.png' })

await page.keyboard.type('callout', { delay: 30 })
await sleep(500)
await page.keyboard.press('Enter')
await sleep(900)
await page.keyboard.type('Watch the units.', { delay: 15 })
await sleep(900)
let doc = await firstDoc()
const callout = doc.find((b) => b.type === 'callout')
check('callout inserted', !!callout)
// Regression guard for the tiptap pin: with a mismatched @tiptap/react the
// block renders but text lands in the *next* block instead of inside it.
check(
  'text typed into the callout stays in the callout',
  (callout?.content ?? []).map((c) => c.text).join('') === 'Watch the units.',
  JSON.stringify(doc.map((b) => [b.type, (b.content ?? []).map((c) => c.text).join('')]))
)
await page.screenshot({ path: SHOT + '/04-callout.png' })

await page.keyboard.press('ArrowDown')
await page.keyboard.press('Enter')
await page.keyboard.type('/toggle', { delay: 30 })
await sleep(600)
await page.keyboard.press('Enter')
await sleep(700)
await page.keyboard.type('Derivation', { delay: 15 })
await sleep(900)
doc = await firstDoc()
const toggle = doc.find((b) => b.type === 'toggle')
check('toggle inserted', !!toggle)
check(
  'text typed into the toggle stays in the toggle',
  (toggle?.content ?? []).map((c) => c.text).join('') === 'Derivation'
)

// ---------------------------------------------------------------- properties
log('\n— properties —')
check('add-property control', (await clickText('+ Add property')) === 'OK')
await sleep(300)
await page.evaluate(() => document.querySelector('.nx-properties__add-form .nx-input').focus())
await page.keyboard.type('Difficulty', { delay: 20 })
await clickText('Add')
await sleep(600)
check(
  'definition created on the type',
  (await page.evaluate(() => window.api.types.getPropertyDefinitions('note'))).some((d) => d.name === 'Difficulty')
)

await page.evaluate(() => {
  const row = [...document.querySelectorAll('.nx-properties__row')].find((r) => r.textContent.includes('Difficulty'))
  row.querySelector('input').focus()
})
await page.keyboard.type('high', { delay: 20 })
await page.evaluate(() => document.querySelector('.nx-editor__title').focus())
await sleep(700)
check(
  'property value saved',
  (await page.evaluate(() => window.api.pages.getAll().then((p) => window.api.properties.getForPage(p[0].id)))).some(
    (p) => p.key === 'difficulty' && p.value_text === 'high'
  )
)

// ---------------------------------------------------------------- links
log('\n— second page and [[ links —')
const before = await page.evaluate(() => window.api.pages.getAll().then((p) => p.length))
await page.evaluate(() => document.querySelectorAll('.nx-notes__create .nx-button')[0].click())
await sleep(900)
check('second page created', (await page.evaluate(() => window.api.pages.getAll().then((p) => p.length))) === before + 1)

await page.click('.nx-editor__title')
await page.keyboard.type('Catalysis', { delay: 20 })
await sleep(600)
await page.click('.bn-editor .bn-block-content')
await page.keyboard.type('See [[Reaction', { delay: 40 })
await sleep(900)
const linkItems = await page.evaluate(() =>
  [...document.querySelectorAll('.nx-link-menu__item')].map((e) => e.innerText.trim())
)
check('[[ opens the link picker', linkItems.length > 0, JSON.stringify(linkItems))
// The picker must not offer the page being edited as a link target.
check('link picker excludes the current page', !linkItems.some((t) => /^Catalysis$/.test(t)))
await page.screenshot({ path: SHOT + '/05-link-menu.png' })

await page.evaluate(() => document.querySelector('.nx-link-menu__item').click())
await sleep(1200)
const graph = await page.evaluate(() => window.api.stats.getGraph())
check('link recorded as a graph edge', graph.edges.length > 0, `${graph.nodes.length} nodes, ${graph.edges.length} edges`)

// ---------------------------------------------------------------- graph
log('\n— graph —')
await nav(0)
await sleep(1800)
check('graph renders nodes', (await page.evaluate(() => document.querySelectorAll('.nx-graph__node').length)) > 0)
const box = await page.evaluate(() => {
  const n = document.querySelector('.nx-graph__node-dot')
  if (!n) return null
  const r = n.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
check('nodes have real screen positions', !!box && box.x > 0 && box.y > 0, JSON.stringify(box))
await page.screenshot({ path: SHOT + '/06-home-graph.png' })
if (box) {
  await page.mouse.click(box.x, box.y)
  await sleep(700)
  check('clicking a node opens the page', await page.evaluate(() => !!document.querySelector('.nx-editor__title')))
}

// ---------------------------------------------------------------- other views
log('\n— other views —')
await nav(2)
await sleep(900)
check(
  'Tables shows a column for the new property',
  // innerText reflects CSS text-transform, so headers come back uppercased.
  (await page.evaluate(() => [...document.querySelectorAll('.nx-table th')].map((e) => e.innerText))).some((h) =>
    /difficulty/i.test(h)
  )
)
await page.screenshot({ path: SHOT + '/07-tables.png' })

await nav(3)
await sleep(900)
check('Activity has rows', (await page.evaluate(() => document.querySelectorAll('.nx-table tbody tr').length)) > 0)
const editRows = await page.evaluate(
  () => [...document.querySelectorAll('.nx-table tbody tr')].filter((r) => r.innerText.includes('Edited')).length
)
// One row per page per editing session, not one per debounced save.
check('edit events are coalesced', editRows <= 3, `${editRows} "Edited" rows`)
await page.screenshot({ path: SHOT + '/08-activity.png' })

await nav(4)
await sleep(600)
await page.screenshot({ path: SHOT + '/09-settings.png' })

await page.keyboard.press('Control+k')
await sleep(500)
check('command palette opens', await page.evaluate(() => !!document.querySelector('.nx-palette')))
await page.screenshot({ path: SHOT + '/10-palette.png' })
await page.keyboard.press('Escape')

check('no uncaught renderer errors', errors.length === 0, errors.slice(0, 5).join(' | '))

await app.close()
rmSync(userDataDir, { recursive: true, force: true })
log(fails === 0 ? '\nall checks passed' : `\n${fails} check(s) failed`)
process.exit(fails === 0 ? 0 : 1)
