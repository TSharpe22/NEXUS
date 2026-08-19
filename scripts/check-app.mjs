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
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
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
// By label, not by index: a sixth nav item would otherwise silently retarget
// every section below it to the view next door.
const nav = (label) =>
  page.evaluate((label) => {
    const item = [...document.querySelectorAll('.nx-nav-item')].find(
      (el) => el.textContent.trim() === label
    )
    if (!item) return 'NOT_FOUND'
    item.click()
    return 'OK'
  }, label)

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

const props = () => page.evaluate(() => window.api.pages.getAll().then((p) => window.api.properties.getForPage(p[0].id)))
const propValue = async (key) => (await props()).find((p) => p.key === key)?.value_text ?? null
const focusRow = (name) =>
  page.evaluate((n) => {
    const row = [...document.querySelectorAll('.nx-properties__row')].find((r) => r.textContent.includes(n))
    if (!row) return 'ROW_NOT_FOUND'
    const input = row.querySelector('input')
    input.focus()
    input.select?.()
    return 'OK'
  }, name)

// The panel is the first thing under the title now, not a footer you scroll
// the whole document to reach.
check(
  'properties render above the document body',
  await page.evaluate(() => {
    const panel = document.querySelector('.nx-properties')
    const body = document.querySelector('.bn-editor')
    if (!panel || !body) return false
    // DOCUMENT_POSITION_FOLLOWING: the body comes after the panel.
    return (panel.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  })
)

// Enter used to do nothing at all — the value only committed on blur, so
// typing one and pressing Enter looked like the app had dropped it.
check('property row focused', (await focusRow('Difficulty')) === 'OK')
await page.keyboard.type('medium', { delay: 20 })
await page.keyboard.press('Enter')
await sleep(600)
check('Enter commits a property value', (await propValue('difficulty')) === 'medium')

// ...and Escape puts the field back rather than committing the edit.
await focusRow('Difficulty')
await page.keyboard.type('scrapped', { delay: 20 })
await page.keyboard.press('Escape')
await sleep(500)
check('Escape reverts the draft', (await propValue('difficulty')) === 'medium')
check(
  'the field shows the stored value again',
  (await page.evaluate(() => {
    const row = [...document.querySelectorAll('.nx-properties__row')].find((r) => r.textContent.includes('Difficulty'))
    return row.querySelector('input').value
  })) === 'medium'
)

// Blurring a field you never touched used to write, and every write logs —
// which buried the Activity feed under rows recording no change at all.
const propEvents = () =>
  page.evaluate(() =>
    window.api.activity.getRecent(300).then((rows) => rows.filter((r) => r.message.includes('difficulty')).length)
  )
const eventsBefore = await propEvents()
await focusRow('Difficulty')
await page.evaluate(() => document.querySelector('.nx-editor__title').focus())
await sleep(600)
check('an untouched field logs nothing', (await propEvents()) === eventsBefore, `before ${eventsBefore}`)

// A second definition whose name slugifies onto an existing key used to
// silently retype the first one, stranding every stored value.
check(
  'a duplicate property name is refused',
  await page.evaluate(() =>
    window.api.types.defineProperty('note', 'Difficulty', 'number').then(
      () => false,
      () => true
    )
  )
)

// ---------------------------------------------------------------- select
log('\n— select properties —')
check('add-property control reopens', (await clickText('+ Add property')) === 'OK')
await sleep(300)
await page.evaluate(() => document.querySelector('.nx-properties__add-form .nx-input').focus())
await page.keyboard.type('Status', { delay: 20 })
await page.selectOption('.nx-properties__add-form .nx-select', 'select')
await clickText('Add')
await sleep(600)
check(
  'select definition created',
  (await page.evaluate(() => window.api.types.getPropertyDefinitions('note'))).some(
    (d) => d.key === 'status' && d.property_type === 'select'
  )
)

// A select fell through to a plain text box before, so there was no list at
// all. Empty is a control you click, not a text field.
const openSelect = () =>
  page.evaluate(() => {
    const row = [...document.querySelectorAll('.nx-properties__row')].find((r) => r.textContent.includes('Status'))
    if (!row) return 'ROW_NOT_FOUND'
    const trigger = row.querySelector('.nx-properties__select-empty, .nx-tag-chip__label')
    if (!trigger) return 'TRIGGER_NOT_FOUND'
    trigger.click()
    return 'OK'
  })
check('select opens an editor, not a text input', (await openSelect()) === 'OK')
await sleep(300)
await page.keyboard.type('active', { delay: 20 })
await page.keyboard.press('Enter')
await sleep(600)
check('select value saved', (await propValue('status')) === 'active')
check(
  'the chosen value shows as a chip',
  (await page.evaluate(() => {
    const row = [...document.querySelectorAll('.nx-properties__row')].find((r) => r.textContent.includes('Status'))
    return row.querySelector('.nx-tag-chip .nx-tag-chip__label')?.textContent.trim()
  })) === 'active'
)

// The regression guard for the real blocker: getKnownPropertyValues dropped
// every value that wasn't a JSON array, so the option list came back empty
// and a "select" had nothing to select from.
check(
  'known values include plain (non-array) values',
  (await page.evaluate(() => window.api.properties.knownValues('status'))).includes('active'),
  JSON.stringify(await page.evaluate(() => window.api.properties.knownValues('status')))
)
check(
  'a plain text property lists its values too',
  (await page.evaluate(() => window.api.properties.knownValues('difficulty'))).includes('medium')
)

// Reopening offers what is already in use, which is what makes it a list.
check('select reopens on the chip', (await openSelect()) === 'OK')
await sleep(400)
check(
  'the option list is populated from values already in use',
  (await page.evaluate(() =>
    [...document.querySelectorAll('.nx-properties__tag-menu .nx-tagbar__option')].map((b) => b.textContent.trim())
  )).includes('active')
)
await page.keyboard.press('Escape')
await sleep(300)
check('select value survives cancelling', (await propValue('status')) === 'active')
await page.screenshot({ path: SHOT + '/06b-properties.png' })

// ------------------------------------------------- renaming and reordering
log('\n— property definitions —')
const labels = () =>
  page.evaluate(() => [...document.querySelectorAll('.nx-properties__row-label')].map((e) => e.textContent.trim()))
const defsOfNote = () => page.evaluate(() => window.api.types.getPropertyDefinitions('note'))

check('property names are rename controls', (await labels()).includes('Status'), JSON.stringify(await labels()))

// `renamePropertyDefinition` was wired all the way through preload and had no
// UI at all. The key is deliberately left alone, so the value survives.
await page.evaluate(() => {
  const label = [...document.querySelectorAll('.nx-properties__row-label')].find((e) => e.textContent.trim() === 'Status')
  label.click()
})
await sleep(300)
await page.evaluate(() => {
  const input = document.querySelector('.nx-properties__rename')
  input.focus()
  input.select()
})
await page.keyboard.type('Stage', { delay: 20 })
await page.keyboard.press('Enter')
await sleep(700)
const renamed = (await defsOfNote()).find((d) => d.key === 'status')
check('property renamed', renamed?.name === 'Stage', JSON.stringify(renamed))
check('the key is left alone so stored values survive', renamed?.key === 'status')
check('the value is still there', (await propValue('status')) === 'active')

// `reorderPropertyDefinitions` existed in repo.ts with no handler, no preload
// binding and no UI, so creation order was permanent.
const orderBefore = (await defsOfNote()).map((d) => d.key)
check('definitions start in creation order', JSON.stringify(orderBefore) === JSON.stringify(['difficulty', 'status']), JSON.stringify(orderBefore))

const dragged = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.nx-properties__row')]
  const source = rows.find((r) => r.textContent.includes('Stage'))
  const target = rows.find((r) => r.textContent.includes('Difficulty'))
  if (!source || !target) return 'MISSING'
  // Same approach as the folder-tree drag: Chromium won't synthesise a real
  // HTML5 drag from script, but the handlers are ordinary listeners.
  const dt = new DataTransfer()
  const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }))
  fire(source.querySelector('.nx-properties__grip'), 'dragstart')
  fire(target, 'dragover')
  fire(target, 'drop')
  return 'OK'
})
check('dragged one property onto another', dragged === 'OK', dragged)
await sleep(800)
check(
  'the new order is persisted',
  JSON.stringify((await defsOfNote()).map((d) => d.key)) === JSON.stringify(['status', 'difficulty']),
  JSON.stringify((await defsOfNote()).map((d) => d.key))
)
check('the panel shows the new order', JSON.stringify(await labels()) === JSON.stringify(['Stage', 'Difficulty']), JSON.stringify(await labels()))


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

// The link graph is projected in the main process, from repo.updatePage — the
// same place the search index is rebuilt. It used to be projected in the
// renderer, after the save round-tripped, which meant a React component was
// its only writer.
const backlinksOf = (title) =>
  page.evaluate(async (t) => {
    const target = (await window.api.pages.getAll()).find((p) => p.title === t)
    return window.api.links.getBacklinks(target.id)
  }, title)
const kineticsBacklinks = await backlinksOf('Reaction kinetics')
check('typing a mention records a backlink', kineticsBacklinks.some((b) => b.sourcePageTitle === 'Catalysis'),
  JSON.stringify(kineticsBacklinks.map((b) => b.sourcePageTitle)))
check('the backlink carries the surrounding text', /See/.test(kineticsBacklinks[0]?.context ?? ''),
  JSON.stringify(kineticsBacklinks[0]?.context))
check('the renderer cannot write the link graph itself',
  await page.evaluate(() => typeof window.api.links.syncLinks === 'undefined'))

// A page created by import never mounts the editor. While link extraction ran
// in that component, such a page contributed no backlinks at all and nothing
// else in the app could fix it.
const imported = await page.evaluate(async () => {
  const mentioned = (await window.api.pages.getAll()).find((p) => p.title === 'Reaction kinetics')
  const doc = [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Imported note about ', styles: {} },
        { type: 'pageMention', props: { pageId: mentioned.id, pageTitle: mentioned.title } }
      ]
    }
  ]
  return window.api.io.importJSON(JSON.stringify({ title: 'Imported reference', content: doc }))
})
check('an imported page exists', imported.title === 'Imported reference')
const afterImport = await backlinksOf('Reaction kinetics')
check('an imported page contributes backlinks too',
  afterImport.some((b) => b.sourcePageTitle === 'Imported reference'),
  JSON.stringify(afterImport.map((b) => b.sourcePageTitle)))

// Removing the mention has to remove the backlink — the projection is a
// replace, not an append.
await page.evaluate(async (id) => window.api.pages.update(id, { content: '[]' }), imported.id)
const afterClearing = await backlinksOf('Reaction kinetics')
check('clearing the body drops its backlink',
  !afterClearing.some((b) => b.sourcePageTitle === 'Imported reference'),
  JSON.stringify(afterClearing.map((b) => b.sourcePageTitle)))
await page.evaluate((id) => window.api.pages.hardDelete(id), imported.id)

// ---------------------------------------------------------------- relations
// The active page here is the second one, Catalysis, and the first page now
// exists to point at.
log('\n— relation properties —')

const pageIdByTitle = (title) =>
  page.evaluate((t) => window.api.pages.getAll().then((all) => all.find((p) => p.title === t)?.id ?? null), title)
const propsOf = (pageId) => page.evaluate((id) => window.api.properties.getForPage(id), pageId)
const catalysisId = await pageIdByTitle('Catalysis')
const kineticsId = await pageIdByTitle('Reaction kinetics')

check('add-property control opens on the second page', (await clickText('+ Add property')) === 'OK')
await sleep(300)
await page.evaluate(() => document.querySelector('.nx-properties__add-form .nx-input').focus())
await page.keyboard.type('Related', { delay: 20 })
await page.selectOption('.nx-properties__add-form .nx-select', 'relation')
await clickText('Add')
await sleep(600)

const openRelation = () =>
  page.evaluate(() => {
    const row = [...document.querySelectorAll('.nx-properties__row')].find((r) => r.textContent.includes('Related'))
    if (!row) return 'ROW_NOT_FOUND'
    const trigger = row.querySelector('.nx-properties__select-empty, .nx-tag-chip__label')
    if (!trigger) return 'TRIGGER_NOT_FOUND'
    trigger.click()
    return 'OK'
  })
const relationChip = () =>
  page.evaluate(() => {
    const row = [...document.querySelectorAll('.nx-properties__row')].find((r) => r.textContent.includes('Related'))
    return row?.querySelector('.nx-tag-chip__label')?.textContent.trim() ?? null
  })

// A relation used to fall through to a plain text box expecting a uuid.
check('relation opens a page picker', (await openRelation()) === 'OK')
await sleep(400)
await page.keyboard.type('Reaction', { delay: 30 })
await sleep(600)
const relationOptions = await page.evaluate(() =>
  [...document.querySelectorAll('.nx-properties__tag-menu .nx-tagbar__option')].map((b) => b.textContent.trim())
)
check('the picker searches pages', relationOptions.includes('Reaction kinetics'), JSON.stringify(relationOptions))
check('the picker excludes the page being edited', !relationOptions.includes('Catalysis'), JSON.stringify(relationOptions))
await page.keyboard.press('Enter')
await sleep(700)

// The whole point: it has to land in value_relation, which is the column every
// reader looks at. It used to go to value_text and read back as empty.
const relationProp = (await propsOf(catalysisId)).find((p) => p.key === 'related')
check('relation stored in value_relation', relationProp?.value_relation === kineticsId, JSON.stringify(relationProp))
check('relation does not leak into value_text', relationProp?.value_text === null, JSON.stringify(relationProp))
check('the chip resolves the target title', (await relationChip()) === 'Reaction kinetics')

// The bug this feature reads as working right up until you hit: leave the page
// and come back, and see whether the value is still there.
const openInTree = (title) =>
  page.evaluate((t) => {
    const row = [...document.querySelectorAll('.nx-tree-row--page')].find(
      (r) => r.querySelector('.nx-tree-row__title')?.textContent.trim() === t
    )
    if (!row) return 'ROW_NOT_FOUND'
    row.click()
    return 'OK'
  }, title)
check('navigated away', (await openInTree('Reaction kinetics')) === 'OK')
await sleep(900)
check('navigated back', (await openInTree('Catalysis')) === 'OK')
await sleep(1200)
check('the relation is still set after reopening the page', (await relationChip()) === 'Reaction kinetics')
await page.screenshot({ path: SHOT + '/05b-relation.png' })

// Clearing it writes a real null rather than leaving the old id behind.
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.nx-properties__row')].find((r) => r.textContent.includes('Related'))
  row.querySelector('.nx-tag-chip__x').click()
})
await sleep(700)
check(
  'clearing a relation empties the column',
  (await propsOf(catalysisId)).find((p) => p.key === 'related')?.value_relation === null
)

// Put it back — the rest of the run reads it from Tables and the mirror.
await openRelation()
await sleep(400)
await page.keyboard.type('Reaction', { delay: 30 })
await sleep(600)
await page.keyboard.press('Enter')
await sleep(700)
check(
  'relation set again',
  (await propsOf(catalysisId)).find((p) => p.key === 'related')?.value_relation === kineticsId
)

// Every copier in repo.ts had its own idea of how to read a property's value,
// and each one forgot value_relation — so a relation was the one thing that
// did not survive being copied.
const dupe = await page.evaluate((id) => window.api.pages.duplicate(id), catalysisId)
check(
  'duplicating a page carries its relation over',
  (await propsOf(dupe.id)).find((p) => p.key === 'related')?.value_relation === kineticsId,
  JSON.stringify(await propsOf(dupe.id))
)
// Removed again so the page counts the later sections assert on hold.
await page.evaluate((id) => window.api.pages.hardDelete(id), dupe.id)
await sleep(400)

// The same reader backs creating a page from a type's template, so a template
// carrying a relation has to pass it on too.
const fromTemplate = await page.evaluate(async (templateId) => {
  await window.api.types.setTemplate('note', templateId)
  const created = await window.api.pages.create('note')
  const props = await window.api.properties.getForPage(created.id)
  // Cleared straight away: a lingering template would silently seed every
  // page the rest of this run creates.
  await window.api.types.setTemplate('note', null)
  await window.api.pages.hardDelete(created.id)
  return props
}, catalysisId)
check(
  'a template passes its relation to a new page',
  fromTemplate.find((p) => p.key === 'related')?.value_relation === kineticsId,
  JSON.stringify(fromTemplate)
)
check(
  'the template is cleared again',
  (await page.evaluate(() => window.api.types.getTemplate('note'))) === null
)
await sleep(400)

// ---------------------------------------------------------------- tasks
log('\n— tasks projected from checkbox blocks —')

// Dated relative to the machine's clock rather than to fixed dates, so these
// keep working next year. Local time throughout: the tracker's windows and the
// `date` property agree on YYYY-MM-DD in the user's own timezone, and a UTC day
// boundary would file an evening's work under tomorrow.
const localISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dayFromToday = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return localISO(d)
}
const TOMORROW = dayFromToday(1)


// The capture surface is the checkbox block BlockNote already ships, reached
// from the slash menu. Writing a todo must never mean leaving the page.
await page.evaluate(() => document.querySelectorAll('.nx-notes__create .nx-button')[0].click())
await sleep(1000)
await page.click('.nx-editor__title')
await page.keyboard.type('Task capture', { delay: 20 })
await sleep(700)
await page.click('.bn-editor .bn-block-content')
await page.keyboard.type('/check', { delay: 30 })
await sleep(700)
const checkItems = await page.evaluate(() =>
  [...document.querySelectorAll('.bn-ak-menu-item, [role="option"]')].map((e) => e.innerText.split('\n')[0].trim())
)
check('a checkbox block is reachable from the slash menu', checkItems.some((t) => /check/i.test(t)),
  JSON.stringify(checkItems))
await page.keyboard.press('Enter')
await sleep(600)
await page.keyboard.type(`draft the outline @${TOMORROW}`, { delay: 15 })
await sleep(400)
await page.keyboard.press('Enter')
await page.keyboard.type('no date on this one', { delay: 15 })
await sleep(1300)

const pageIdOf = (title) =>
  page.evaluate((t) => window.api.pages.getAll().then((p) => p.find((x) => x.title === t)?.id), title)
const tasksOf = (id) => page.evaluate((id) => window.api.tasks.forPage(id), id)
const captureId = await pageIdOf('Task capture')
let captured = await tasksOf(captureId)

check('a checkbox block projects a task row', captured.length === 2,
  JSON.stringify(captured.map((t) => t.text)))
check('the due date is parsed out of the block text', captured[0]?.dueDate === TOMORROW,
  JSON.stringify(captured[0]))
check('the @token is stripped from the projected text', captured[0]?.text === 'draft the outline',
  JSON.stringify(captured[0]?.text))
check('a dated task says where its date came from', captured[0]?.dueDateSource === 'block')
check('a task with no date anywhere has none', captured[1]?.dueDate === null && captured[1]?.dueDateSource === null,
  JSON.stringify(captured[1]))
check('tasks start open', captured.every((t) => t.isDone === false && t.completedAt === null))
await page.screenshot({ path: SHOT + '/10-tasks.png' })

const inRange = (from, to) => page.evaluate(([f, t]) => window.api.tasks.inRange(f, t), [from, to])
check('a dated task falls inside its window',
  (await inRange(dayFromToday(0), dayFromToday(6))).some((t) => t.text === 'draft the outline'))
check('and outside a window it does not belong to',
  !(await inRange(dayFromToday(30), dayFromToday(37))).some((t) => t.text === 'draft the outline'))
check('an undated open task is still reachable',
  (await page.evaluate(() => window.api.tasks.undated())).some((t) => t.text === 'no date on this one'))

// Ticking the box in the editor is the ordinary path, and it has to reach the
// projection through the save like any other edit.
await page.evaluate(() => document.querySelector('.bn-editor input[type="checkbox"]').click())
await sleep(1300)
captured = await tasksOf(captureId)
check('ticking the box in the editor marks the task done', captured[0]?.isDone === true,
  JSON.stringify(captured[0]))
check('and stamps when it was completed', !!captured[0]?.completedAt, JSON.stringify(captured[0]?.completedAt))
const completedFirstAt = captured[0]?.completedAt

// Ticking from the tracker writes back into the block — the projected row is
// an index, so setting it alone would be reverted by the next reprojection.
await page.evaluate((id) =>
  window.api.tasks.forPage(id).then((t) => window.api.tasks.setDone(id, t[1].blockId, true)), captureId)
await sleep(600)
const captureDoc = await page.evaluate((id) => window.api.pages.getById(id).then((p) => JSON.parse(p.content)), captureId)
const boxes = captureDoc.filter((b) => b.type === 'checkListItem')
check('ticking a task off the page writes back into the block',
  boxes.every((b) => b.props.checked === true),
  JSON.stringify(boxes.map((b) => b.props.checked)))
check('an unchanged completed_at is carried across the reprojection',
  (await tasksOf(captureId))[0]?.completedAt === completedFirstAt)

// The relation bug looked like it worked until you left the page and came
// back: assert the reopen, and against the database, not the DOM alone.
await nav('Home')
await sleep(600)
await nav('Notes')
await sleep(600)
check('reopened the page', (await openInTree('Task capture')) === 'OK')
await sleep(1000)
check('the box is still ticked in the editor after a reopen',
  await page.evaluate(() => document.querySelector('.bn-editor input[type="checkbox"]')?.checked === true))
check('and still done in the database',
  (await tasksOf(captureId)).every((t) => t.isDone === true))

// Unticking clears the completion rather than leaving a stale timestamp.
await page.evaluate((id) =>
  window.api.tasks.forPage(id).then((t) => window.api.tasks.setDone(id, t[0].blockId, false)), captureId)
await sleep(600)
check('unticking clears completed_at',
  (await tasksOf(captureId))[0]?.completedAt === null && (await tasksOf(captureId))[0]?.isDone === false)

// A page that never mounts the editor — the projector has to be reached by
// every write, not just the ones a component happens to make.
const projected = await page.evaluate(async (PAGE_DATE) => {
  const created = await window.api.pages.create()
  const doc = [
    { id: 'blk-keep', type: 'checkListItem', props: { checked: true }, content: [{ type: 'text', text: 'kept', styles: {} }] },
    { id: 'blk-drop', type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: 'dropped', styles: {} }] },
    {
      id: 'blk-nested',
      type: 'bulletListItem',
      content: [{ type: 'text', text: 'group', styles: {} }],
      children: [
        { id: 'blk-child', type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: 'nested task', styles: {} }] }
      ]
    }
  ]
  await window.api.pages.update(created.id, { title: 'Projection scratch', content: JSON.stringify(doc) })
  await window.api.properties.set(created.id, 'date', 'date', PAGE_DATE)
  return created.id
}, dayFromToday(0))
let scratch = await tasksOf(projected)
check('a page written without the editor still projects', scratch.length === 3,
  JSON.stringify(scratch.map((t) => t.text)))
check('a checkbox nested under another block is found too',
  scratch.some((t) => t.text === 'nested task'))
check("a task with no date of its own inherits its page's",
  scratch.every((t) => t.dueDate === dayFromToday(0) && t.dueDateSource === 'page'),
  JSON.stringify(scratch.map((t) => [t.text, t.dueDate, t.dueDateSource])))
check('an inherited date puts the task in that window',
  (await inRange(dayFromToday(0), dayFromToday(0))).filter((t) => t.pageTitle === 'Projection scratch').length === 3)
check('the page shows up as a dated page as well',
  (await page.evaluate((d) => window.api.tasks.datedPages(d, d), dayFromToday(0))).some(
    (d) => d.pageTitle === 'Projection scratch'))

// Editing the page's date property must move its tasks, which is why the
// fallback is resolved at query time instead of copied into the row.
await page.evaluate(([id, next]) => window.api.properties.set(id, 'date', 'date', next), [projected, dayFromToday(7)])
check('changing the page date moves the tasks that inherited it',
  (await tasksOf(projected)).every((t) => t.dueDate === dayFromToday(7)))

// A block that has gone from the document has no row afterwards.
await page.evaluate((id) =>
  window.api.pages.update(id, {
    content: JSON.stringify([
      { id: 'blk-keep', type: 'checkListItem', props: { checked: true }, content: [{ type: 'text', text: 'kept', styles: {} }] }
    ])
  }), projected)
scratch = await tasksOf(projected)
check('a deleted checkbox drops its row', scratch.length === 1 && scratch[0].text === 'kept',
  JSON.stringify(scratch.map((t) => t.text)))

await page.evaluate((id) => window.api.pages.hardDelete(id), projected)
check('deleting a page for good takes its tasks with it',
  (await inRange(dayFromToday(-90), dayFromToday(90))).every((t) => t.pageTitle !== 'Projection scratch'))

// The fixture goes too. It is a page of type Note, and the Tables section
// below asserts on how many rows that type has — a test that leaves its
// fixtures lying around fails the section after it, not itself.
await page.evaluate((id) => window.api.pages.hardDelete(id), captureId)
await sleep(400)

// ---------------------------------------------------------------- graph
log('\n— graph —')
await nav('Home')
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
await nav('Tables')
await sleep(900)
check(
  'Tables shows a column for the new property',
  // innerText reflects CSS text-transform, so headers come back uppercased.
  (await page.evaluate(() => [...document.querySelectorAll('.nx-table th')].map((e) => e.innerText))).some((h) =>
    /difficulty/i.test(h)
  )
)
check(
  'Tables resolves a relation to the target title',
  (await page.evaluate(() =>
    [...document.querySelectorAll('.nx-table tbody tr')]
      .map((r) => r.innerText)
      .join(' | ')
  )).includes('Reaction kinetics'),
  await page.evaluate(() => [...document.querySelectorAll('.nx-table tbody tr')].map((r) => r.innerText).join(' | '))
)
await page.screenshot({ path: SHOT + '/07-tables.png' })

// Sorting: the view was a static dump ordered by last-modified, with no way to
// ask it anything.
const tableTitles = () =>
  page.evaluate(() => [...document.querySelectorAll('.nx-table tbody tr')].map((r) => r.querySelector('td').innerText.trim()))
const clickHeader = (name) =>
  page.evaluate((n) => {
    const th = [...document.querySelectorAll('.nx-table th')].find((e) => new RegExp('^' + n, 'i').test(e.innerText))
    if (!th) return 'HEADER_NOT_FOUND'
    th.click()
    return 'OK'
  }, name)

const defaultOrder = await tableTitles()
check('rows start newest-first', defaultOrder.length === 2, JSON.stringify(defaultOrder))

check('name header is a sort control', (await clickHeader('name')) === 'OK')
await sleep(400)
// The default order happens to start with Catalysis too, so assert the header
// state as well rather than trusting a coincidence.
check('sorted by name ascending', (await tableTitles())[0] === 'Catalysis', JSON.stringify(await tableTitles()))
check(
  'the name column reports ascending',
  (await page.evaluate(() => document.querySelector('.nx-table th.nx-th--sorted')?.getAttribute('aria-sort'))) ===
    'ascending'
)

await clickHeader('name')
await sleep(400)
check('clicking again reverses it', (await tableTitles())[0] === 'Reaction kinetics', JSON.stringify(await tableTitles()))
check(
  'the sorted column is marked',
  (await page.evaluate(() => document.querySelector('.nx-table th.nx-th--sorted')?.getAttribute('aria-sort'))) ===
    'descending'
)

await clickHeader('name')
await sleep(400)
check('a third click returns to the default order', JSON.stringify(await tableTitles()) === JSON.stringify(defaultOrder))
check('no column is marked sorted', (await page.evaluate(() => !document.querySelector('.nx-table th.nx-th--sorted'))))

// Only one of the two pages has a Difficulty, so this is the blanks-last rule:
// the filled row leads in both directions.
await clickHeader('difficulty')
await sleep(400)
check('ascending puts the filled cell first', (await tableTitles())[0] === 'Reaction kinetics', JSON.stringify(await tableTitles()))
await clickHeader('difficulty')
await sleep(400)
check('descending keeps blanks last', (await tableTitles())[0] === 'Reaction kinetics', JSON.stringify(await tableTitles()))
await clickHeader('difficulty')
await sleep(400)

// Filtering matches what the cells show, not just the title — so a relation's
// target or a property value finds its row.
const typeFilter = async (text) => {
  await page.evaluate(() => {
    const input = document.querySelector('.nx-tables__filter')
    input.focus()
    input.select()
  })
  await page.keyboard.press('Backspace')
  if (text) await page.keyboard.type(text, { delay: 25 })
  await sleep(500)
}
await typeFilter('catal')
check('filtering by title', JSON.stringify(await tableTitles()) === JSON.stringify(['Catalysis']), JSON.stringify(await tableTitles()))
await typeFilter('medium')
check('filtering by a property value', JSON.stringify(await tableTitles()) === JSON.stringify(['Reaction kinetics']), JSON.stringify(await tableTitles()))
await typeFilter('nothing here')
check('a filter that matches nothing says so', (await page.evaluate(() => document.body.innerText)).includes('Nothing matches that filter'))
await typeFilter('')
check('clearing the filter restores every row', (await tableTitles()).length === 2)
await page.screenshot({ path: SHOT + '/07b-tables-sorted.png' })


await nav('Activity')
await sleep(900)
check('Activity has rows', (await page.evaluate(() => document.querySelectorAll('.nx-table tbody tr').length)) > 0)
const editRows = await page.evaluate(
  () => [...document.querySelectorAll('.nx-table tbody tr')].filter((r) => r.innerText.includes('Edited')).length
)
// One row per page per editing session, not one per debounced save.
check('edit events are coalesced', editRows <= 3, `${editRows} "Edited" rows`)
await page.screenshot({ path: SHOT + '/08-activity.png' })

await nav('Settings')
await sleep(600)
await page.screenshot({ path: SHOT + '/09-settings.png' })

await page.keyboard.press('Control+k')
await sleep(500)
check('command palette opens', await page.evaluate(() => !!document.querySelector('.nx-palette')))
await page.screenshot({ path: SHOT + '/10-palette.png' })
await page.keyboard.press('Escape')

// ---------------------------------------------------------------- journal
log('\n— journal —')
// The previous section left the app on Settings.
await nav('Notes')
await sleep(700)
check("Today's entry button present", await page.evaluate(() => !!document.querySelector('.nx-notes__today')))

await page.evaluate(() => document.querySelector('.nx-notes__today').click())
await sleep(1400)

const entry = await page.evaluate(() => {
  const id = window.__lastEntryId
  return window.api.pages.getAll().then((ps) => ps.find((p) => p.title.startsWith('Entry —')) ?? null)
})
check('entry created with a worded title', !!entry && /^Entry — \w{3} \d{1,2} \w{3} \d{4}$/.test(entry.title),
  JSON.stringify(entry?.title))

const journalType = (await page.evaluate(() => window.api.types.list())).find((t) => t.name === 'Journal')
check('Journal type created', !!journalType)
check('entry is of the Journal type', entry?.type_id === journalType?.id)

const folders = await page.evaluate(() => window.api.folders.list())
check('entry filed in the Journal folder',
  folders.find((f) => f.id === entry?.folder_id)?.name === 'Journal',
  JSON.stringify(folders.map((f) => f.name)))

const entryProps = await page.evaluate((id) => window.api.properties.getForPage(id), entry?.id)
const dateProp = entryProps.find((p) => p.key === 'date')
const today = await page.evaluate(() => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
})
check('date property set to today, in local time', dateProp?.value_date === today,
  `${dateProp?.value_date} vs ${today}`)

check('template applied to the new entry', JSON.stringify(JSON.parse(entry.content)).includes('Today'),
  JSON.stringify(entry.content).slice(0, 120))
check('template body renders in the editor',
  (await page.evaluate(() => document.querySelector('.bn-editor')?.innerText ?? '')).includes('Today'))

// Pressing it again must reopen the same entry, never make a second one.
await page.evaluate(() => document.querySelector('.nx-notes__today').click())
await sleep(1200)
const entries = (await page.evaluate(() => window.api.pages.getAll())).filter((p) =>
  p.title.startsWith('Entry —')
)
check('pressing it again reopens rather than duplicating', entries.length === 1, `${entries.length} entries`)

// Renaming an entry must not produce a duplicate — matching is on the date
// property, not the title.
await page.evaluate((id) => window.api.pages.update(id, { title: 'Renamed by hand' }), entry.id)
await page.evaluate(() => document.querySelector('.nx-notes__today').click())
await sleep(1200)
const afterRename = await page.evaluate(() => window.api.pages.getAll())
check('a renamed entry is still found for today',
  afterRename.filter((p) => p.type_id === journalType.id && p.title !== 'Journal template').length === 1,
  JSON.stringify(afterRename.filter((p) => p.type_id === journalType.id).map((p) => p.title)))

// ---------------------------------------------------------------- vault mirror
log('\n— vault mirror —')
const mirrorDir = join(tmpdir(), `nexus-mirror-${Date.now()}`)

// A file the user put there themselves. The mirror must never remove it.
mkdirSync(mirrorDir, { recursive: true })
writeFileSync(join(mirrorDir, 'MY OWN FILE.md'), 'do not delete me')

const synced = await page.evaluate(async (dir) => {
  await window.api.mirror.setFolder(dir)
  return window.api.mirror.syncNow()
}, mirrorDir)
check('mirror wrote files', synced.written >= 2, JSON.stringify(synced))

const tree = () => {
  const walk = (d, pre = '') =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name), pre + e.name + '/') : [pre + e.name]
    )
  return walk(mirrorDir).sort()
}
const files = tree()
check('index file written', files.includes('_nexus-index.md'), JSON.stringify(files))
check('folder tree mirrored as directories', files.some((f) => f.includes('/')), JSON.stringify(files))

const kinetics = files.find((f) => f.includes('Reaction kinetics'))
check('page written under a readable name', !!kinetics, JSON.stringify(files))
const md = readFileSync(join(mirrorDir, kinetics), 'utf-8')
check('frontmatter present', md.startsWith('---\n'), md.slice(0, 40))
check('body carried over', md.includes('Rate depends on temperature'))
check('tags in frontmatter', md.includes('tags: ["kinetics"]'), md.split('---')[1]?.trim().slice(0, 160))
check('properties in frontmatter', md.includes('difficulty:'), md.split('---')[1]?.trim().slice(0, 160))
check(
  'frontmatter follows the type\'s property order',
  md.indexOf('status:') < md.indexOf('difficulty:'),
  md.split('---')[1]?.trim().slice(0, 240)
)
// The [[ link was made on the second page, so that is the file to look in.
const linker = readFileSync(join(mirrorDir, files.find((f) => f.includes('Catalysis'))), 'utf-8')
check('wiki-link preserved as [[Title]]', linker.includes('[[Reaction kinetics]]'),
  JSON.stringify(linker.slice(-160)))
check('relation mirrored as a wiki-link, not a uuid', linker.includes('related: "[[Reaction kinetics]]"'),
  linker.split('---')[1]?.trim().slice(0, 240))

// An unchanged vault must be a true no-op, or the folder churns mtimes every
// couple of seconds while typing.
const again = await page.evaluate(() => window.api.mirror.syncNow())
check('re-syncing an unchanged vault writes nothing', again.written === 0, JSON.stringify(again))

// Renaming moves the file and leaves nothing behind.
await page.evaluate(async () => {
  const pages = await window.api.pages.getAll()
  const p = pages.find((x) => x.title === 'Reaction kinetics')
  await window.api.pages.update(p.id, { title: 'Renamed kinetics' })
  return window.api.mirror.syncNow()
})
const after = tree()
check('rename moved the file', after.some((f) => f.includes('Renamed kinetics')), JSON.stringify(after))
check('no leftover under the old name', !after.some((f) => f.includes('Reaction kinetics')), JSON.stringify(after))
check('a file the user added is untouched',
  readFileSync(join(mirrorDir, 'MY OWN FILE.md'), 'utf-8') === 'do not delete me')

// A page title cannot escape the mirror root.
await page.evaluate(async () => {
  const p = await window.api.pages.create('note')
  await window.api.pages.update(p.id, { title: '../../escaped' })
  return window.api.mirror.syncNow()
})
check('path traversal refused', !existsSync(join(mirrorDir, '..', '..', 'escaped.md')))
check('sanitised inside the root', tree().some((f) => f.includes('escaped')), JSON.stringify(tree()))

await page.evaluate(() => window.api.mirror.setFolder(null))
rmSync(mirrorDir, { recursive: true, force: true })

// ---------------------------------------------------------------- persistence
// Last, because it types into a page and would otherwise skew the activity
// counts above.
log('\n— persistence across an editor remount —')

// The editor is keyed by page id and seeded from the store's copy of
// `page.content`. A content save that reached the database but not the store
// left the next remount showing an empty document — and the following
// keystroke then saved that empty document over the real one.
await nav('Notes')
await sleep(700)
const reopen = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.nx-tree-row--page')].find(
    (r) => r.querySelector('.nx-tree-row__title')?.textContent.trim() === 'Reaction kinetics'
  )
  if (!row) return 'ROW_NOT_FOUND'
  row.click()
  return 'OK'
})
await sleep(1200)
check('reopened the first page', reopen === 'OK', reopen)

const shown = await page.evaluate(() => document.querySelector('.bn-editor')?.innerText ?? 'NO_EDITOR')
check('body survives the remount', shown.includes('Rate depends on temperature'), JSON.stringify(shown.slice(0, 60)))

// The destructive half: if the remount started empty, this save wipes the page.
await page.click('.bn-editor .bn-block-content')
await page.keyboard.press('End')
await page.keyboard.type(' Checked.', { delay: 20 })
await sleep(1400)
const persisted = JSON.stringify(await firstDoc())
check('earlier text is not overwritten by the next edit', persisted.includes('Rate depends on temperature'))
check('the new edit saved as well', persisted.includes('Checked.'))

// ------------------------------------------- clearing versus removing
// The × on a property row used to delete the definition from the whole type,
// wiping the value from every page of it — a schema edit behind a control that
// reads as "clear this field".
log('\n— clearing a value against removing a property —')

const openPageId = await page.evaluate(() => window.api.pages.getAll().then((p) => p[0].id))
const scratchDef = async () => (await page.evaluate(() => window.api.types.getPropertyDefinitions('note'))).find((d) => d.key === 'scratch')
const scratchValue = async () =>
  (await page.evaluate((id) => window.api.properties.getForPage(id), openPageId)).find((p) => p.key === 'scratch') ?? null

check('add-property control', (await clickText('+ Add property')) === 'OK')
await sleep(300)
await page.evaluate(() => document.querySelector('.nx-properties__add-form .nx-input').focus())
await page.keyboard.type('Scratch', { delay: 20 })
await clickText('Add')
await sleep(600)
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.nx-properties__row')].find((r) => r.textContent.includes('Scratch'))
  row.querySelector('input').focus()
})
await page.keyboard.type('temporary', { delay: 20 })
await page.keyboard.press('Enter')
await sleep(600)
check('scratch value set', (await scratchValue())?.value_text === 'temporary')

await page.evaluate(() => {
  const row = [...document.querySelectorAll('.nx-properties__row')].find((r) => r.textContent.includes('Scratch'))
  row.querySelector('.nx-properties__remove').click()
})
await sleep(600)
check('× clears this page\'s value', (await scratchValue()) === null)
check('× leaves the property on the type', (await scratchDef()) !== undefined)

// Removing from the type lives behind the rename state, and behind a dialog
// this test can actually drive — Playwright dismisses `window.confirm`, so the
// destructive paths behind one were never exercised at all.
const startRenaming = () =>
  page.evaluate(() => {
    const label = [...document.querySelectorAll('.nx-properties__row-label')].find((e) => e.textContent.trim() === 'Scratch')
    if (!label) return 'LABEL_NOT_FOUND'
    label.click()
    return 'OK'
  })
const clickUnset = () =>
  page.evaluate(() => {
    const row = [...document.querySelectorAll('.nx-properties__row')].find((r) => r.querySelector('.nx-properties__unset'))
    if (!row) return 'NOT_FOUND'
    row.querySelector('.nx-properties__unset').click()
    return 'OK'
  })
const clickInDialog = (label) =>
  page.evaluate((l) => {
    const btn = [...document.querySelectorAll('.nx-confirm button')].find((b) => b.textContent.trim() === l)
    if (!btn) return 'NOT_FOUND'
    btn.click()
    return 'OK'
  }, label)

check('renaming exposes the schema-level remove', (await startRenaming()) === 'OK')
await sleep(300)
check('the remove control is there', (await clickUnset()) === 'OK')
await sleep(400)
check('a styled dialog opens, not a native one', (await page.evaluate(() => !!document.querySelector('.nx-confirm'))))
await page.screenshot({ path: SHOT + '/09-confirm.png' })
check('cancelling', (await clickInDialog('Cancel')) === 'OK')
await sleep(400)
check('cancelling leaves the property alone', (await scratchDef()) !== undefined)

await startRenaming()
await sleep(300)
await clickUnset()
await sleep(400)
check('confirming', (await clickInDialog('Remove property')) === 'OK')
await sleep(700)
check('the property is gone from the type', (await scratchDef()) === undefined)

check('no uncaught renderer errors', errors.length === 0, errors.slice(0, 5).join(' | '))

await app.close()
rmSync(userDataDir, { recursive: true, force: true })
log(fails === 0 ? '\nall checks passed' : `\n${fails} check(s) failed`)
process.exit(fails === 0 ? 0 : 1)
