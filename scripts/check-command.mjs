/**
 * Command pages and Back / Forward: Nexus opens on Exec, Home is the hub with
 * a tile per command page, a page can be made, renamed and removed, each keeps
 * its own layout, and Back / Forward walk the places you went.
 *
 *   npm run check:command     (builds, then runs under xvfb)
 *
 * Runs against a scratch userData directory, so it never touches real notes.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync, readdirSync, statSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

const APP = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const userDataDir = mkdtempSync(join(tmpdir(), 'nexus-command-'))

let fails = 0
const check = (label, ok, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? ' ok  ' : 'FAIL '} ${label}${extra ? ' — ' + extra : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ELECTRON = join(APP, 'node_modules/electron/dist/electron')
const launch = (dir = userDataDir) =>
  electron.launch({
    executablePath: ELECTRON,
    args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${dir}`, APP],
    cwd: APP,
    env: { ...process.env, NODE_ENV: 'production' },
    timeout: 45_000
  })

let app = await launch()
let page = await app.firstWindow()
const errors = []
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
}
watch(page)
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await sleep(800)

const title = () => page.evaluate(() => document.querySelector('.nx-topbar__title')?.textContent.trim())
const navLabels = () => page.evaluate(() => [...document.querySelectorAll('.nx-nav-item')].map((el) => el.textContent.trim()))
const nav = (label) =>
  page.evaluate((label) => {
    const item = [...document.querySelectorAll('.nx-nav-item')].find((el) => el.textContent.trim() === label)
    item?.click()
    return !!item
  }, label)
const kinds = () => page.evaluate(async () => {
  const id = window.nexus.store.getState().activeCommandId
  const raw = await window.api.dashboard.get(id)
  return raw ? JSON.parse(raw).widgets.map((w) => w.kind) : null
})

// ---------------------------------------------------------------- start
check('Nexus opens on Exec', (await title()) === 'Exec', await title())
const labels = await navLabels()
check('the sidebar lists Home, then Exec, Trading and Learning',
  labels.slice(0, 4).join(',') === 'Home,Exec,Trading,Learning', labels.join(','))
check('an empty vault is invited to start, on the page it opens on',
  await page.evaluate(() => /Nothing here yet/.test(document.querySelector('.nx-content').innerText)))

// A page, so the command pages draw their layouts.
await page.evaluate(async () => {
  const p = await window.api.pages.create()
  await window.api.pages.update(p.id, { title: 'Back target' })
  await window.nexus.store.getState().refresh()
})
await sleep(600)
check('Exec is the old Home layout, all eight widgets',
  (await page.evaluate(() => document.querySelectorAll('.nx-home__slot').length)) === 8)

await nav('Home')
await sleep(800)
check('Home is the hub', (await title()) === 'Home')
const tiles = await page.evaluate(() => [...document.querySelectorAll('.nx-cmdnav__name')].map((t) => t.textContent.trim()))
check('with Command navigation listing each other command page', tiles.join(',') === 'Exec,Trading,Learning', tiles.join(','))
check('and the quote and next task', await page.evaluate(() => !!document.querySelector('.nx-quote') &&
  /Next task/i.test(document.querySelector('.nx-home__grid').innerText)))
check('Home stores the hub, not the old layout', (await kinds())?.includes('tiles'))

// ---------------------------------------------------------------- tiles, Back, Forward
await page.locator('.nx-cmdnav__row', { hasText: 'Trading' }).click()
await sleep(600)
check('a row opens its command page', (await title()) === 'Trading')

await page.evaluate(() => window.nexus.store.getState().openPage(
  window.nexus.store.getState().pages.find((p) => p.title === 'Back target').id))
await sleep(600)
check('a page opens in Notes', (await title()) === 'Notes')

await page.locator('.nx-topbar__step[aria-label="Back"]').click()
await sleep(500)
check('Back returns to Trading', (await title()) === 'Trading', await title())
await page.locator('.nx-topbar__step[aria-label="Back"]').click()
await sleep(500)
check('Back again returns to Home', (await title()) === 'Home', await title())
await page.locator('.nx-topbar__step[aria-label="Forward"]').click()
await sleep(500)
check('Forward goes to Trading again', (await title()) === 'Trading', await title())
await page.mouse.click(5, 5)
await page.keyboard.press('Alt+ArrowRight')
await sleep(500)
const back = await page.evaluate(() => window.nexus.store.getState())
check('Alt + → goes forward to the page', back.activeView === 'notes' && (await title()) === 'Notes')
await page.keyboard.press('Alt+ArrowLeft')
await sleep(500)
check('Alt + ← goes back', (await title()) === 'Trading')
check('Forward is offered, and going somewhere new drops it', await page.evaluate(() => window.nexus.store.getState().canGoForward))
await nav('Tracker')
await sleep(500)
check('…dropped', !(await page.evaluate(() => window.nexus.store.getState().canGoForward)))

// ---------------------------------------------------------------- colour
await page.locator('.nx-nav-item', { hasText: 'Trading' }).click({ button: 'right' })
await sleep(200)
await page.getByText('Colour: blue', { exact: true }).click()
await sleep(500)
check('a command page takes a colour, in the sidebar',
  await page.evaluate(() => !!document.querySelector('.nx-sidebar__mark--info')))
check('and it is stored with the page',
  await page.evaluate(async () => JSON.parse(await window.api.commands.get()).pages.find((p) => p.id === 'trading').color === 'info'))

// ---------------------------------------------------------------- make, rename, lay out, remove
await page.locator('.nx-sidebar__add').click()
await page.keyboard.type('Fight camp')
await page.keyboard.press('Enter')
await sleep(600)
check('+ makes a command page and opens it', (await title()) === 'Fight camp')
check('it starts empty', /Nothing on this page yet/.test(await page.evaluate(() => document.querySelector('.nx-home').innerText)))
await page.evaluate(() => window.api.dashboard.set(JSON.stringify({
  version: 1, widgets: [{ id: 'w-p', kind: 'pinned', config: {}, span: 6 }]
}), 'fight-camp'))
await nav('Exec')
await sleep(400)
await nav('Fight camp')
await sleep(600)
check('it keeps a layout of its own', (await page.evaluate(() => document.querySelectorAll('.nx-home__slot').length)) === 1)
check('Exec is untouched by it', await page.evaluate(async () => !(await window.api.dashboard.get('exec') ?? '').includes('w-p')))

await page.locator('.nx-nav-item', { hasText: 'Fight camp' }).click({ button: 'right' })
await sleep(200)
await page.getByText('Rename', { exact: true }).click()
await page.keyboard.press('Control+a')
await page.keyboard.type('Camp')
await page.keyboard.press('Enter')
await sleep(500)
check('rename shows in the sidebar and the title', (await navLabels()).includes('Camp') && (await title()) === 'Camp')

// The palette reaches every command page.
await page.keyboard.press('Control+k')
await page.waitForSelector('.nx-palette')
const palette = await page.evaluate(() => [...document.querySelectorAll('[cmdk-item]')].map((el) => el.textContent.trim()))
check('⌘K lists the command pages', ['Home', 'Exec', 'Trading', 'Learning', 'Camp'].every((n) => palette.includes(n)))
await page.keyboard.press('Escape')

await page.locator('.nx-nav-item', { hasText: 'Camp' }).click({ button: 'right' })
await sleep(200)
await page.getByText('Remove', { exact: true }).click()
await sleep(300)
await page.locator('.nx-confirm .nx-button', { hasText: 'Remove' }).click()
await sleep(600)
check('remove takes it out of the sidebar', !(await navLabels()).includes('Camp'))
check('and forgets its layout', (await page.evaluate(() => window.api.dashboard.get('fight-camp'))) === null)
check('and lands on Home', (await title()) === 'Home')

// ---------------------------------------------------------------- start page survives a restart
await page.locator('.nx-nav-item', { hasText: 'Learning' }).click({ button: 'right' })
await sleep(200)
await page.getByText('Open Nexus on this page', { exact: true }).click()
await sleep(400)
await app.close()
app = await launch()
page = await app.firstWindow()
watch(page)
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await sleep(1200)
check('the start page is kept across a restart', (await title()) === 'Learning', await title())

await app.close()

// ---------------------------------------------------------------- an existing vault
// A vault from before command pages: a Home layout of its own and no list.
// Made by launching, saving a layout, then deleting the list straight from
// the database (better-sqlite3 is built for Electron, so Electron runs it).
const oldDir = mkdtempSync(join(tmpdir(), 'nexus-command-old-'))
const MINE = { version: 1, widgets: [
  { id: 'w-mine', kind: 'calendar', config: {}, span: 7 },
  { id: 'w-pin', kind: 'pinned', config: {}, span: 5, stack: true }
] }
app = await launch(oldDir)
page = await app.firstWindow()
watch(page)
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await page.evaluate((json) => window.api.dashboard.set(json), JSON.stringify(MINE))
// A page, so Exec draws its layout rather than the empty-vault invitation.
await page.evaluate(() => window.api.pages.create())
await app.close()
const findDb = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === 'nexus.db') return p
    if (statSync(p).isDirectory()) {
      const hit = findDb(p)
      if (hit) return hit
    }
  }
  return null
}
const dbPath = findDb(oldDir)
const sql = join(oldDir, 'unseed.cjs')
writeFileSync(sql, `const D = require(${JSON.stringify(join(APP, 'node_modules/better-sqlite3'))});
const db = new D(process.argv[2]);
db.prepare("DELETE FROM settings WHERE key IN ('command.pages', 'dashboard.exec', 'dashboard.learning')").run();
db.close();`)
execFileSync(ELECTRON, [sql, dbPath], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })

app = await launch(oldDir)
page = await app.firstWindow()
watch(page)
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await sleep(1200)
const moved = await page.evaluate(async () => ({
  exec: await window.api.dashboard.get('exec'),
  home: await window.api.dashboard.get('home')
}))
check('an existing Home layout moves to Exec exactly', moved.exec === JSON.stringify(MINE), moved.exec)
check('and Home becomes the hub', JSON.parse(moved.home ?? '{}').widgets?.some((w) => w.kind === 'tiles'))
check('and Nexus opens on it', (await title()) === 'Exec' &&
  (await page.evaluate(() => document.querySelectorAll('.nx-home__slot').length)) === 1)

check('no renderer errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await app.close()
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
