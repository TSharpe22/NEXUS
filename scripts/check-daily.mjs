/**
 * The daily loop, against a vault with a month in it.
 *
 *   npm run build && npm run check:daily
 *
 * On headless Linux this needs an X server: `xvfb-run -a npm run check:daily`.
 *
 * `check-app.mjs` asks whether each feature works. This asks a different
 * question: whether the app is still usable on day thirty. Almost everything
 * here was written after a build that passed every smoke test produced 58
 * overdue tasks, a capture box that made an orphan page per thought, and a
 * board whose columns were uuids — none of which any per-feature test could
 * have caught, because each feature was working exactly as written.
 *
 * So the vault is seeded to look like a month of ordinary use — a journal
 * entry a day with a top three, habits with realistic gaps, a trade log, some
 * projects — and then the assertions are about proportion. Not "does overdue
 * return rows" but "does it return a number a person would still read".
 *
 * Runs against a scratch userData directory and a scratch mirror folder, so it
 * never touches real notes.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

const APP = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const userDataDir = mkdtempSync(join(tmpdir(), 'nexus-daily-'))
const mirrorDir = mkdtempSync(join(tmpdir(), 'nexus-daily-mirror-'))
const SHOT = process.env.SCREENSHOT_DIR || '/tmp/shots'
mkdirSync(SHOT, { recursive: true })

let fails = 0
const log = (...a) => console.log(...a)
const check = (label, ok, extra = '') => {
  if (!ok) fails++
  log(`${ok ? ' ok  ' : 'FAIL '} ${label}${extra ? ' — ' + extra : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
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

// ------------------------------------------------------------------
// A month of use.
// ------------------------------------------------------------------
const seeded = await page.evaluate(SEED())
log(`seeded: ${JSON.stringify(seeded.counts)}`)

await page.evaluate(async (folder) => {
  await window.api.mirror.setFolder(folder)
  await window.api.mirror.setEnabled(true)
  return window.api.mirror.syncNow()
}, mirrorDir)

await page.reload()
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await sleep(1200)

const text = (sel) => page.evaluate((s) => document.querySelector(s)?.innerText ?? '', sel)

// ------------------------------------------------------------------
// 1. What a month of unticked boxes does to the morning screen.
// ------------------------------------------------------------------
log('\nthe morning screen after thirty days:')
const debt = await page.evaluate(async () => {
  const today = new Date().toISOString().slice(0, 10)
  const [overdue, loose, dueToday] = await Promise.all([
    window.api.tasks.overdue(today),
    window.api.tasks.looseEnds(today, 200),
    window.api.tasks.inRange(today, today)
  ])
  return {
    overdue: overdue.length,
    overdueSources: [...new Set(overdue.map((t) => t.dueDateSource))],
    loose: loose.length,
    looseSources: [...new Set(loose.map((t) => t.dueDateSource))],
    dueToday: dueToday.length
  }
})
// The seed writes six carried tasks with an explicit @date in the past. Every
// other unticked line is dated only by the entry it sits in, and is therefore
// not late — it was never scheduled. If this starts counting those again the
// number goes back over fifty and the bar becomes wallpaper.
check('overdue counts only tasks with a date of their own', debt.overdue < 15, `${debt.overdue} overdue`)
check('and nothing dated only by its page', JSON.stringify(debt.overdueSources), JSON.stringify(['block']) === JSON.stringify(debt.overdueSources) || debt.overdue === 0)
check('the page-dated ones are still reachable', debt.loose > 20, `${debt.loose} left open on days that have passed`)
check('and they are all page-dated', debt.looseSources.every((s) => s === 'page'), JSON.stringify(debt.looseSources))
check("today's list is a day's worth of work", debt.dueToday > 0 && debt.dueToday < 12, `${debt.dueToday} due today`)

// ------------------------------------------------------------------
// 2. Capture: the fast path lands somewhere you will look again.
// ------------------------------------------------------------------
log('\ncapture:')
const captureDefault = await page.evaluate(() => window.api.prefs.get().then((p) => p.captureTarget))
check('the box opens on a target that gets reread', captureDefault !== 'page', `default is "${captureDefault}"`)

const captured = await page.evaluate(async () => {
  const target = (await window.api.prefs.get()).captureTarget
  await window.api.capture.line('Email the prop firm about the reset @2026-01-02', target)
  const entry = await window.api.journal.peek()
  const tasks = entry ? await window.api.tasks.forPage(entry.id) : []
  const hit = tasks.find((t) => t.text.includes('prop firm about the reset'))
  return { landed: !!hit, due: hit?.dueDate, source: hit?.dueDateSource }
})
check('a captured line arrives as a task on today\'s entry', captured.landed)
check('with the date written into it', captured.due === '2026-01-02' && captured.source === 'block', `due=${captured.due}`)

// ------------------------------------------------------------------
// 3. The question a trade log exists to answer.
// ------------------------------------------------------------------
log('\ntotals:')
const totals = await page.evaluate(async (ids) => {
  const [sum, mean, count, min, max] = await Promise.all([
    window.api.views.aggregate(ids.losing, [{ key: 'pnl', fn: 'sum' }]),
    window.api.views.aggregate(ids.all, [{ key: 'pnl', fn: 'mean' }]),
    window.api.views.aggregate(ids.all, [{ key: 'pnl', fn: 'count' }]),
    window.api.views.aggregate(ids.all, [{ key: 'pnl', fn: 'min' }]),
    window.api.views.aggregate(ids.all, [{ key: 'pnl', fn: 'max' }])
  ])
  // The same sum done by hand over the rows, to prove the SQL is answering
  // about the view rather than about a page of it.
  const rows = await window.api.views.run(ids.all, 500)
  const byHand = rows.reduce((a, r) => {
    const p = r.properties.find((x) => x.key === 'pnl')
    return p && p.value_number !== null ? a + p.value_number : a
  }, 0)
  return { sum: sum[0], mean: mean[0], count: count[0], min: min[0], max: max[0], byHand }
}, seeded.views)

check('a numeric column can be summed', totals.sum.value === -2725, `sum of losing pnl = ${totals.sum.value}`)
check('the mean is over everything the view matches',
  Math.abs(totals.mean.value * totals.count.value - totals.byHand) < 0.01,
  `mean ${totals.mean.value.toFixed(2)} × ${totals.count.value} = ${totals.byHand}`)
check('min and max come back', totals.min.value === -750 && totals.max.value === 1075,
  `min ${totals.min.value}, max ${totals.max.value}`)
check('a total says how much of the column it speaks for', totals.count.value === 11,
  `${totals.count.value} of 12 trades carry a pnl — the open one does not`)

// ------------------------------------------------------------------
// 4. A relation is a page, not a uuid.
// ------------------------------------------------------------------
log('\nviews on screen:')
await page.evaluate(() => {
  ;[...document.querySelectorAll('.nx-sidebar button, .nx-sidebar a')]
    .find((b) => b.textContent?.trim() === 'Views')
    ?.click()
})
await sleep(700)
await page.evaluate(() => {
  ;[...document.querySelectorAll('.nx-views__rail-item')]
    .find((b) => b.textContent?.includes('Trades by setup'))
    ?.click()
})
await sleep(1200)
await page.screenshot({ path: join(SHOT, 'daily-board.png') })
const boardText = await text('.nx-views__main')
const uuids = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(boardText)
check('a board grouped by a relation names its columns', !uuids && /Mean Reversion/i.test(boardText),
  uuids ? 'columns are raw uuids' : '')

// ------------------------------------------------------------------
// 5. Home can be built out of your own questions.
// ------------------------------------------------------------------
log('\nhome:')
await page.evaluate(async (ids) => {
  await window.api.dashboard.set(
    JSON.stringify({
      version: 1,
      widgets: [
        { id: 'w1', kind: 'capture', span: 12 },
        { id: 'w2', kind: 'today', span: 5 },
        { id: 'w3', kind: 'habits', span: 4 },
        { id: 'w4', kind: 'view', span: 3, config: { viewId: ids.projects } }
      ]
    })
  )
  const view = await window.api.views.get(ids.open)
  await window.api.views.update(ids.open, { ...view, is_pinned: 1 })
}, seeded.views)
await page.reload()
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await sleep(1500)
await page.screenshot({ path: join(SHOT, 'daily-home.png') })
const homeText = await text('.nx-content')
const sidebarText = await text('.nx-sidebar')
check('a saved view draws on Home under its own name',
  /Active projects/i.test(homeText) && /Project Nocturne/.test(homeText))
check('a pinned view is reachable from the sidebar', /Open trades/.test(sidebarText))
check('the overdue bar shows a number worth reading', /\b\d+ overdue/.test(homeText) && !/\b\d{2,} overdue/.test(homeText),
  homeText.match(/\d+ overdue/)?.[0] ?? 'no bar')

// ------------------------------------------------------------------
// 6. The mirror, in both directions.
// ------------------------------------------------------------------
log('\nmirror:')
await page.evaluate(() => window.api.mirror.syncNow())
await sleep(1200)
const mirror = await page.evaluate(async (dir) => {
  const list = await window.api.pages.list()
  const trade = list.find((p) => p.title.startsWith('ES 2026') || p.title.startsWith('NQ 2026'))
  const file = await window.fs.readFile(`${dir}/${trade.title}.md`).catch(() => null)
  const project = await window.fs.readFile(`${dir}/Trading Revival.md`).catch(() => null)
  if (!project) return { file: String(file ?? '') }
  const back = await window.api.io.importMarkdown(String(project), 'Trading Revival (again).md')
  const [props, tags, types] = await Promise.all([
    window.api.properties.getForPage(back.id),
    window.api.tags.getForPage(back.id),
    window.api.types.list()
  ])
  return {
    file: String(file ?? ''),
    title: back.title,
    type: types.find((t) => t.id === back.type_id)?.name,
    props: props.map((p) => p.key).sort().join(','),
    tags: tags.length
  }
}, mirrorDir)

check('numbers are written as numbers', /^entry: \d/m.test(mirror.file) && !/^entry: "/m.test(mirror.file),
  mirror.file.match(/^entry: .*/m)?.[0] ?? 'no entry key')
check('relations are written as links', /^setup: "\[\[/m.test(mirror.file),
  mirror.file.match(/^setup: .*/m)?.[0] ?? 'no setup key')
check('a mirrored file comes back with its type', mirror.type === 'Project', `imported as ${mirror.type}`)
check('and its tags', mirror.tags > 0, `${mirror.tags} tags`)
// Named rather than counted: a count passes when the wrong three come back,
// and the whole point of the round trip is that the page arrives with what it
// left with.
check('and every property it left with', mirror.props === 'area,next,status', mirror.props)
check('and its title', mirror.title === 'Trading Revival', mirror.title)

// ------------------------------------------------------------------
// 7. Still quick with a month in it.
// ------------------------------------------------------------------
log('\nscale:')
const timings = await page.evaluate(async () => {
  const t = {}
  let s = performance.now(); await window.api.pages.list(); t.list = Math.round(performance.now() - s)
  s = performance.now(); await window.api.search.pages('breathwork', 20); t.search = Math.round(performance.now() - s)
  s = performance.now(); await window.api.stats.getGraph(); t.graph = Math.round(performance.now() - s)
  s = performance.now(); await window.api.tasks.overdue('2026-01-01'); t.overdue = Math.round(performance.now() - s)
  return t
})
check('core queries stay interactive', Object.values(timings).every((v) => v < 250), JSON.stringify(timings) + ' ms')
check('no renderer errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await app.close()
rmSync(userDataDir, { recursive: true, force: true })
rmSync(mirrorDir, { recursive: true, force: true })
log(fails === 0 ? '\nall checks passed' : `\n${fails} check(s) failed`)
process.exit(fails === 0 ? 0 : 1)

/**
 * The seed, as a string evaluated in the renderer.
 *
 * A string rather than a function passed to `page.evaluate` because it is long
 * enough that Playwright's serialisation of it becomes the thing you debug.
 * It runs entirely through `window.api` — the same calls the UI makes — so a
 * vault it produces is one the app could have produced.
 */
function SEED() {
  return String.raw`
(async () => {
  const api = window.api
  const out = { counts: {}, views: {} }
  let n = 0
  const uid = () => 'seed-' + (++n).toString(36).padStart(6, '0')
  const txt = (t) => [{ type: 'text', text: t, styles: {} }]
  const para = (t) => ({ id: uid(), type: 'paragraph', props: {}, content: txt(t), children: [] })
  const head = (t, level) => ({ id: uid(), type: 'heading', props: { level }, content: txt(t), children: [] })
  const todo = (t, checked) => ({ id: uid(), type: 'checkListItem', props: { checked: !!checked }, content: txt(t), children: [] })
  const mention = (before, pageId, pageTitle) => ({
    id: uid(), type: 'paragraph', props: {},
    content: [{ type: 'text', text: before, styles: {} }, { type: 'pageMention', props: { pageId, pageTitle } }],
    children: []
  })
  const D = (back) => { const d = new Date(); d.setDate(d.getDate() - back); return d.toISOString().slice(0, 10) }

  const todayEntry = await api.journal.today()
  const types = await api.types.list()
  const journal = types.find(t => t.name === 'Journal')

  const mkType = async (name, props) => {
    const t = await api.types.create(name, null)
    for (const [n, k] of props) await api.types.defineProperty(t.id, n, k)
    return t
  }
  const Session = await mkType('Session', [['date','date'],['done','boolean'],['volume','number']])
  const Breathwork = await mkType('Breathwork', [['date','date'],['done','boolean']])
  const Grip = await mkType('Grip', [['date','date'],['done','boolean']])
  const Setup = await mkType('Setup', [['status','select'],['market','text']])
  const Trade = await mkType('Trade', [['symbol','text'],['direction','select'],['entry','number'],
    ['exit','number'],['size','number'],['pnl','number'],['opened','date'],['closed','date'],['setup','relation']])
  const Project = await mkType('Project', [['status','select'],['area','select'],['next','text']])

  const mkPage = async (typeId, title, content) => {
    const p = await api.pages.create(typeId)
    await api.pages.update(p.id, { title, content: JSON.stringify(content) })
    return p
  }
  const setProps = async (id, props) => {
    for (const [k, type, v] of props) await api.properties.set(id, k, type, type === 'number' ? Number(v) : String(v))
  }

  const projects = {}
  for (const [name, status, area, next, tag] of [
    ['Project Nocturne','active','personal','Draft the threat model','nocturne'],
    ['NEXUS Development','active','work','Aggregation in views','work'],
    ['Trading Revival','active','work','Pass the 50k eval','trading'],
    ['Training','active','mastery','Deload week planning','mastery'],
    ['Edge of the Abyss Media','paused','personal','Decide whether to keep it','personal']
  ]) {
    const p = await mkPage(Project.id, name, [head('Next', 2), para(next)])
    await setProps(p.id, [['status','select',status],['area','select',area],['next','text',next]])
    await api.tags.addToPage(p.id, tag)
    projects[name] = p
  }

  const setups = {}
  for (const [name, status, market] of [['Mean Reversion — ES','live','ES'],['Momentum Breakout','testing','NQ']]) {
    const p = await mkPage(Setup.id, name, [para(status)])
    await setProps(p.id, [['status','select',status],['market','text',market]])
    setups[name] = p
  }

  // Twelve trades, five of them losses summing to -2725, one still open. The
  // numbers are asserted on above, so they are deliberately fixed.
  const trades = [
    ['ES','Long',5610,5638,2,700,26,26,'Mean Reversion — ES'],
    ['ES','Short',5702,5688,2,350,24,24,'Mean Reversion — ES'],
    ['NQ','Long',19840,19710,1,-650,23,23,'Momentum Breakout'],
    ['ES','Long',5580,5560,3,-750,21,21,'Mean Reversion — ES'],
    ['NQ','Short',19980,20090,1,-550,19,19,'Momentum Breakout'],
    ['ES','Long',5601,5644,2,1075,17,17,'Mean Reversion — ES'],
    ['ES','Short',5720,5735,2,-375,14,14,'Mean Reversion — ES'],
    ['NQ','Long',19700,19860,1,800,12,12,'Momentum Breakout'],
    ['ES','Long',5650,5676,3,975,9,9,'Mean Reversion — ES'],
    ['ES','Short',5744,5760,2,-400,7,7,'Mean Reversion — ES'],
    ['NQ','Long',19910,20040,1,650,4,4,'Momentum Breakout'],
    ['ES','Long',5688,null,2,null,1,null,'Mean Reversion — ES']
  ]
  for (const [sym, dir, entry, exit, size, pnl, openedAgo, closedAgo, setup] of trades) {
    const p = await mkPage(Trade.id, sym + ' ' + D(openedAgo), [para(dir + ' ' + size + ' ' + sym)])
    const props = [['symbol','text',sym],['direction','select',dir],['entry','number',entry],
      ['size','number',size],['opened','date',D(openedAgo)],['setup','relation',setups[setup].id]]
    if (exit !== null) props.push(['exit','number',exit])
    if (pnl !== null) props.push(['pnl','number',pnl])
    if (closedAgo !== null) props.push(['closed','date',D(closedAgo)])
    await setProps(p.id, props)
    await api.tags.addToPage(p.id, 'trading')
  }
  out.counts.trades = trades.length

  for (let i = 29; i >= 0; i--) {
    const day = D(i)
    const dow = new Date(day + 'T12:00:00').getDay()
    if (i % 7 !== 3) await api.habits.checkIn(Breathwork.id, 'date', 'done', day, true)
    if (i % 3 !== 0) await api.habits.checkIn(Grip.id, 'date', 'done', day, true)
    if (dow === 1 || dow === 3 || dow === 5) await api.habits.checkIn(Session.id, 'date', 'done', day, true)
  }

  const section = (await api.prefs.get()).taskSection || 'Tasks'
  const goals = [
    ['Trade the open, no revenge entries','Train — push day','Finish the Nocturne threat model'],
    ["Review yesterday's trades",'Grip work','Ship the widget refactor'],
    ['Backtest the gap setup','Train — pull day','Clear the inbox']
  ]
  const carried = ['Call the broker about the payout','Order the new grip trainer','Book the deload week']
  const folders = await api.folders.list()
  const journalFolder = folders.find(f => f.name === 'Journal')
  let entries = 0

  for (let i = 29; i >= 0; i--) {
    const day = D(i)
    const three = goals[i % goals.length]
    const blocks = [head('Top 3', 2), todo(three[0], i % 3 !== 0), todo(three[1], i % 2 === 0), todo(three[2], false), head(section, 2)]
    // A handful of tasks with a date somebody actually wrote. These are the
    // only ones that should ever count as overdue.
    if (i % 5 === 0) blocks.push(todo(carried[(i / 5) % carried.length] + ' @' + D(i + 2), false))
    if (i % 4 === 0) blocks.push(todo('Reply to the prop firm', true))
    blocks.push(head('Log', 2), para('Woke at 05:40. Breathwork done.'))
    const project = Object.keys(projects)[i % 5]
    blocks.push(mention('Moved ', projects[project].id, project))

    let p = i === 0 ? todayEntry : await api.pages.create(journal.id)
    if (i !== 0) {
      await api.pages.update(p.id, { title: 'Entry — ' + day })
      if (journalFolder) await api.pages.move(p.id, journalFolder.id)
    }
    await api.pages.update(p.id, { content: JSON.stringify(blocks) })
    await api.properties.set(p.id, 'date', 'date', day)
    entries++
  }
  out.counts.entries = entries

  const mk = async (draft) => (await api.views.create(draft)).id
  out.views.projects = await mk({
    name: 'Active projects', layout: 'table',
    filter: { op: 'and', of: [{ field: { kind: 'type' }, cmp: 'is', value: Project.id },
                              { field: { kind: 'property', key: 'status' }, cmp: 'is', value: 'active' }] }
  })
  out.views.losing = await mk({
    name: 'Losing trades', layout: 'table',
    filter: { op: 'and', of: [{ field: { kind: 'type' }, cmp: 'is', value: Trade.id },
                              { field: { kind: 'property', key: 'pnl' }, cmp: 'lt', value: 0 }] },
    sort: [{ field: { kind: 'property', key: 'pnl' }, direction: 'asc' }]
  })
  out.views.open = await mk({
    name: 'Open trades', layout: 'table',
    filter: { op: 'and', of: [{ field: { kind: 'type' }, cmp: 'is', value: Trade.id },
                              { field: { kind: 'property', key: 'closed' }, cmp: 'empty' }] }
  })
  out.views.all = await mk({
    name: 'Every trade', layout: 'table',
    filter: { op: 'and', of: [{ field: { kind: 'type' }, cmp: 'is', value: Trade.id }] }
  })
  out.views.board = await mk({
    name: 'Trades by setup', layout: 'board',
    filter: { op: 'and', of: [{ field: { kind: 'type' }, cmp: 'is', value: Trade.id }] },
    grouping: { kind: 'property', key: 'setup' }
  })

  await api.search.rebuildIndex()
  return out
})()
`
}
