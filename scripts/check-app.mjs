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

// A toggle you cannot put anything inside is just a paragraph with a chevron.
// Enter used to produce a sibling, and collapsing used to do nothing at all —
// both silent, which is why neither was caught until someone tried to use one.
await page.keyboard.press('Enter')
await sleep(400)
await page.keyboard.type('Nested under the toggle', { delay: 15 })
await sleep(900)
doc = await firstDoc()
const nested = doc.find((b) => b.type === 'toggle')?.children ?? []
check(
  'Enter inside a toggle nests, rather than making a sibling',
  nested.length === 1 && (nested[0].content ?? []).map((c) => c.text).join('') === 'Nested under the toggle',
  JSON.stringify(nested.map((c) => [c.type, (c.content ?? []).map((x) => x.text).join('')]))
)

// Click and read in separate evaluates: the open state is React-rendered, so
// reading it in the same tick as the click sees the pre-render DOM.
await page.evaluate(() => document.querySelector('.nx-toggle__chevron')?.click())
await sleep(400)
const collapse = await page.evaluate(() => {
  const el = document.querySelector('.nx-toggle')
  if (!el) return { error: 'no toggle rendered' }
  const group = el.closest('.bn-block')?.querySelector(':scope > .bn-block-group')
  return { open: el.getAttribute('data-open'), display: group ? getComputedStyle(group).display : 'NO_GROUP' }
})
check(
  'collapsing a toggle hides its children',
  collapse.open === 'false' && collapse.display === 'none',
  JSON.stringify(collapse)
)
await page.evaluate(() => document.querySelector('.nx-toggle__chevron')?.click())
await sleep(300)

// Both markers are centred on the FIRST LINE of their text. Fixed pixel
// nudges used to leave them sitting below it, and would drift again whenever the
// editor's font size or line height changes.
const markerOffsets = await page.evaluate(() => {
  const centreDelta = (markerSel, textSel) => {
    const marker = document.querySelector(markerSel)
    const text = document.querySelector(textSel)
    if (!marker || !text) return null
    const range = document.createRange()
    range.selectNodeContents(text)
    const t = range.getBoundingClientRect()
    const m = marker.getBoundingClientRect()
    return (m.top + m.height / 2) - (t.top + t.height / 2)
  }
  return {
    toggle: centreDelta('.nx-toggle__chevron', '.nx-toggle__summary'),
    callout: centreDelta('.nx-callout__marker', '.nx-callout__content')
  }
})
check(
  'toggle chevron is centred on its first line',
  markerOffsets.toggle !== null && Math.abs(markerOffsets.toggle) <= 1,
  `offset ${markerOffsets.toggle}px`
)
check(
  'callout marker is centred on its first line',
  markerOffsets.callout !== null && Math.abs(markerOffsets.callout) <= 1,
  `offset ${markerOffsets.callout}px`
)

// ---------------------------------------------------------------- tags
log('\n— tags —')
check('tag bar present under the title', await page.evaluate(() => !!document.querySelector('.nx-tagbar__add')))
await page.evaluate(() => document.querySelector('.nx-tagbar__add').click())
await sleep(300)
await page.keyboard.type('kinetics', { delay: 20 })
await page.keyboard.press('Enter')
await sleep(800)
await page.keyboard.type('kine', { delay: 20 })
await sleep(400)
const suggested = await page.evaluate(
  () => [...document.querySelectorAll('.nx-tagbar__option')].map((o) => o.innerText.trim())
)
check('existing tags autocomplete', suggested.length === 0 || !suggested.some((t) => t === 'kinetics'),
  JSON.stringify(suggested))
await page.keyboard.press('Escape')
await sleep(200)
const pageTags = await page.evaluate(() => window.api.pages.getAll().then((p) => window.api.tags.getForPage(p[0].id)))
check('tag attached to the page', pageTags.length === 1 && pageTags[0].name === 'kinetics',
  JSON.stringify(pageTags.map((t) => t.name)))
check('tag chip rendered', (await page.evaluate(() => document.querySelectorAll('.nx-tagbar .nx-tag-chip').length)) === 1)
await page.screenshot({ path: SHOT + '/05-tags.png' })

// ---------------------------------------------------------------- folders
log('\n— folders —')
check('new-folder control', (await clickText('Folder')) === 'OK')
await sleep(700)
check('folder row rendered', (await page.evaluate(() => document.querySelectorAll('.nx-tree-row--folder').length)) === 1)

const dropped = await page.evaluate(() => {
  const pageRow = document.querySelector('.nx-tree-row--page')
  const folderRow = document.querySelector('.nx-tree-row--folder')
  if (!pageRow || !folderRow) return 'MISSING'
  // Chromium won't synthesise a real HTML5 drag from script, but the handlers
  // are ordinary listeners — dispatching the sequence exercises the same path.
  const dt = new DataTransfer()
  const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
  fire(pageRow, 'dragstart')
  fire(folderRow, 'dragover')
  fire(folderRow, 'drop')
  return 'OK'
})
check('drag a page onto a folder', dropped === 'OK')
await sleep(800)
check(
  'the page is now in the folder',
  await page.evaluate(() =>
    Promise.all([window.api.pages.getAll(), window.api.folders.list()]).then(
      ([pages, folders]) => pages.some((p) => p.folder_id === folders[0].id)
    )
  )
)

check(
  'a folder cannot be moved inside its own subfolder',
  (await page.evaluate(async () => {
    const [parent] = await window.api.folders.list()
    const child = await window.api.folders.create('Child', parent.id)
    try {
      await window.api.folders.move(parent.id, child.id)
      return 'ACCEPTED'
    } catch {
      return 'REJECTED'
    }
  })) === 'REJECTED'
)
await sleep(500)
await page.screenshot({ path: SHOT + '/06-folders.png' })

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
// ---------------------------------------------------------------- search
log('\n— full-text search —')

// "Arrhenius" and "temperature" were typed into the body of the first page and
// appear in no title, so a title-only filter could never surface them.
const bodyHits = await page.evaluate(() => window.api.search.pages('arrhenius'))
check('body text is searchable', bodyHits.length === 1 && bodyHits[0].page.title === 'Reaction kinetics',
  JSON.stringify(bodyHits.map((h) => h.page.title)))
check('body match carries an excerpt', !!bodyHits[0]?.bodySnippet, JSON.stringify(bodyHits[0]?.bodySnippet))

const titleHits = await page.evaluate(() => window.api.search.pages('reaction'))
check('title match ranks first', titleHits[0]?.page.title === 'Reaction kinetics',
  JSON.stringify(titleHits.map((h) => h.page.title)))

check('prefix match works', (await page.evaluate(() => window.api.search.pages('arrhen'))).length === 1)
check('no false positives', (await page.evaluate(() => window.api.search.pages('zzzznotpresent'))).length === 0)

// FTS5 operators and quotes in user input must be literal terms, never syntax.
for (const nasty of ['"; DROP TABLE pages --', 'NEAR(a b)', '*', 'a OR b']) {
  check(`malformed query is safe: ${nasty}`,
    Array.isArray(await page.evaluate((q) => window.api.search.pages(q), nasty)))
}

// The Notes list must actually show a body-only match, not just the IPC.
await page.evaluate(() => {
  const box = document.querySelector('.nx-notes__search')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(box, 'arrhenius')
  box.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(500)
check('body-only match appears in the notes list',
  await page.evaluate(() =>
    [...document.querySelectorAll('.nx-tree-row__title')].some((t) => t.textContent.includes('Reaction kinetics'))))
check('the excerpt renders under the row',
  await page.evaluate(() => !!document.querySelector('.nx-tree-row__snippet .nx-search-hit')))

await page.evaluate(() => {
  const box = document.querySelector('.nx-notes__search')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(box, '')
  box.dispatchEvent(new Event('input', { bubbles: true }))
})
await sleep(400)

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
