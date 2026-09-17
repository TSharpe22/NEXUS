/**
 * App lock: does Nexus stay shut until it is given its password — through a
 * reload, through the IPC surface, after walking away — and does nothing typed
 * before it locked get lost?
 *
 *     npm run build
 *     APP_DIR=$PWD xvfb-run -a node scripts/probes/app-lock.mjs
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const APP = process.env.APP_DIR
const SHOT = process.env.SCREENSHOT_DIR || '/tmp/shots-app-lock'
mkdirSync(SHOT, { recursive: true })
const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const userDataDir = mkdtempSync(join(tmpdir(), 'nexus-applock-'))
const launch = () =>
  electron.launch({
    executablePath: join(APP, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`, APP],
    cwd: APP,
    env: { ...process.env, NODE_ENV: 'production' },
    timeout: 45_000
  })

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const PASSWORD = 'correct horse'
const isLockScreen = (page) => page.evaluate(() => !!document.querySelector('.nx-applock__panel') && !document.querySelector('.nx-app'))
const isApp = (page) => page.evaluate(() => !!document.querySelector('.nx-app') && !document.querySelector('.nx-applock'))
const unlockWith = async (page, password) => {
  await page.fill('.nx-applock__input', password)
  await page.keyboard.press('Enter')
  await sleep(700)
}
const nav = (page, label) =>
  page.evaluate((label) => [...document.querySelectorAll('.nx-nav-item')].find((el) => el.textContent.trim() === label)?.click(), label)

let app = await launch()
let page = await app.firstWindow()
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await page.setViewportSize({ width: 1400, height: 900 })

// ---------------------------------------------------------------- off by default
log('— off by default —')
check('a vault with no password opens straight to the app', await isApp(page))
await nav(page, 'Settings')
await sleep(500)
check('Settings says so', await page.evaluate(() => /Nexus opens without a password/.test(document.body.innerText)))
await page.keyboard.press(`${MOD}+Shift+L`)
await sleep(500)
check('the lock shortcut does nothing without a password', await isApp(page))

// ---------------------------------------------------------------- setting it
log('— setting it —')
const pageId = await page.evaluate(async () => {
  const uid = () => crypto.randomUUID()
  const p = await window.api.pages.create()
  await window.api.pages.update(p.id, {
    title: 'Private thoughts',
    content: JSON.stringify([{ id: uid(), type: 'paragraph', props: {}, content: [{ type: 'text', text: 'first line', styles: {} }], children: [] }])
  })
  return p.id
})
await page.click('.nx-settings button:text-is("Set password")')
await sleep(300)
const fields = await page.$$('.nx-pwd input[type="password"]')
await fields[0].fill(PASSWORD)
await fields[1].fill(PASSWORD)
await page.click('.nx-pwd button[type="submit"]')
await sleep(900)
check('Set password in Settings turns the lock on', (await page.evaluate(() => window.api.appLock.status())).enabled)
check('and the panel offers idle and sleep options', await page.evaluate(() => /Lock when idle/.test(document.body.innerText) && /Lock when the computer sleeps/.test(document.body.innerText)))
check('the app stays open until it locks', await isApp(page))
// Read the database files as bytes: the password must not be in them, and a
// scrypt hash must be.
const dbBytes = ['nexus.db', 'nexus.db-wal']
  .map((f) => join(userDataDir, 'data', f))
  .filter((f) => existsSync(f))
  .map((f) => readFileSync(f).toString('latin1'))
  .join('')
check('the password itself is not stored, a scrypt hash is', !dbBytes.includes(PASSWORD) && dbBytes.includes('scrypt$32768$8$1$'))

// ---------------------------------------------------------------- locking
log('— locking —')
await page.keyboard.press(`${MOD}+Shift+L`)
await sleep(900)
check('Cmd/Ctrl+Shift+L locks', await isLockScreen(page))
await page.screenshot({ path: SHOT + '/1-locked.png' })
check('nothing from the vault is left in the page', await page.evaluate(() => !/Private thoughts/.test(document.body.innerText)))
const refused = await page.evaluate(() => window.api.pages.list().then(() => 'answered', (e) => String(e.message)))
check('data IPC is refused while locked', /locked/i.test(refused), refused)
const status = await page.evaluate(() => window.api.appLock.status())
check('the lock status itself still answers', status.locked === true)

await page.evaluate(() => window.location.reload())
await page.waitForSelector('.nx-applock__panel', { timeout: 20_000 })
await sleep(500)
check('a reload does not get past it', await isLockScreen(page))

// ---------------------------------------------------------------- unlocking
log('— unlocking —')
await unlockWith(page, 'wrong one')
check('a wrong password is refused', await isLockScreen(page))
check('and says so', await page.evaluate(() => /Wrong password/.test(document.querySelector('.nx-applock__message')?.textContent ?? '')))
await unlockWith(page, 'wrong two')
await unlockWith(page, 'wrong three')
await unlockWith(page, PASSWORD)
check('after three wrong guesses, even the right one has to wait', await isLockScreen(page))
check('and it says how long', await page.evaluate(() => /Too many attempts/.test(document.querySelector('.nx-applock__message')?.textContent ?? '')))
await sleep(2200)
await unlockWith(page, PASSWORD)
await page.waitForSelector('.nx-app', { timeout: 10_000 }).catch(() => {})
check('the right password, after the wait, opens the app', await isApp(page))
check('and the vault is readable again', (await page.evaluate(() => window.api.pages.list())).some((p) => p.title === 'Private thoughts'))

// ---------------------------------------------------------------- idle
log('— idle —')
await page.evaluate(() => window.api.appLock.setIdleSeconds(5))
await page.evaluate((id) => window.nexus.store.getState().openPage(id), pageId)
await page.waitForSelector('.bn-inline-content', { timeout: 10_000 })
await sleep(600)
await page.click('.bn-inline-content')
await page.keyboard.press('End')
await page.keyboard.type(' typed just before walking away')
const typedAt = Date.now()
// Stay active for a while: moving the mouse must hold the lock off.
for (let i = 0; i < 4; i++) {
  await page.mouse.move(300 + i * 20, 300)
  await sleep(1500)
}
check('input holds the idle lock off', await isApp(page), `${Math.round((Date.now() - typedAt) / 1000)}s after typing`)
await sleep(8000)
check('five seconds without input locks it', await isLockScreen(page))
await page.screenshot({ path: SHOT + '/2-idle.png' })
await sleep(2500)
await unlockWith(page, PASSWORD)
await page.waitForSelector('.nx-app', { timeout: 10_000 }).catch(() => {})
const body = await page.evaluate((id) => window.api.pages.getById(id).then((p) => p.content), pageId)
check('what was typed inside the autosave delay was saved before locking', body.includes('typed just before walking away'))
await page.evaluate(() => window.api.appLock.setIdleSeconds(0))

// The sharper case: lock inside the editor's 600ms autosave delay, so the only
// thing that can save the text is the flush the lock does first.
await page.click('.bn-inline-content')
await page.keyboard.press('End')
await page.keyboard.type(' and locked mid-sentence')
await page.keyboard.press(`${MOD}+Shift+L`)
await sleep(1200)
check('locking inside the autosave delay', await isLockScreen(page))
await unlockWith(page, PASSWORD)
await page.waitForSelector('.nx-app', { timeout: 10_000 }).catch(() => {})
const body2 = await page.evaluate((id) => window.api.pages.getById(id).then((p) => p.content), pageId)
check('still saves what was just typed', body2.includes('and locked mid-sentence'))

// ---------------------------------------------------------------- page passwords
log('— page passwords —')
await page.evaluate(async () => {
  const p = await window.api.pages.create()
  await window.api.pages.update(p.id, { title: 'Doubly private' })
  await window.api.lock.set(p.id, 'page-secret')
  await window.api.lock.unlock(p.id, 'page-secret')
})
check('a page unlocked with its own password is open', (await page.evaluate(() => window.api.lock.unlockedIds())).length === 1)
await page.evaluate(() => window.api.appLock.lock())
await sleep(800)
await sleep(2500)
await unlockWith(page, PASSWORD)
await page.waitForSelector('.nx-app', { timeout: 10_000 }).catch(() => {})
check('is shut again after the app locks and unlocks', (await page.evaluate(() => window.api.lock.unlockedIds())).length === 0)

// ---------------------------------------------------------------- changing and removing
log('— changing and removing —')
const wrongChange = await page.evaluate(() => window.api.appLock.setPassword('not it', 'new').then(() => 'changed', (e) => e.message))
check('changing it needs the current password', /Wrong password/.test(wrongChange), wrongChange)
await page.evaluate((pw) => window.api.appLock.setPassword(pw, 'second secret'), PASSWORD)
await page.evaluate(() => window.api.appLock.lock())
await sleep(800)
await sleep(2500)
await unlockWith(page, PASSWORD)
check('the old password stops working', await isLockScreen(page))
await sleep(2500)
await unlockWith(page, 'second secret')
await page.waitForSelector('.nx-app', { timeout: 10_000 }).catch(() => {})
check('the new one works', await isApp(page))

// The lock button beside the wordmark.
await page.click('.nx-sidebar__lock')
await sleep(900)
check('the lock button in the sidebar locks', await isLockScreen(page))
await unlockWith(page, 'second secret')
await page.waitForSelector('.nx-app', { timeout: 10_000 }).catch(() => {})

// Quitting while locked should not wait out the renderer flush timeout.
await page.evaluate(() => window.api.appLock.lock())
await sleep(800)
const closeStart = Date.now()
await app.close()
const closeMs = Date.now() - closeStart
check('quitting while locked is not held up', closeMs < 1800, `${closeMs}ms`)

app = await launch()
page = await app.firstWindow()
await page.waitForSelector('.nx-applock__panel, .nx-app', { timeout: 20_000 })
await sleep(500)
check('a fresh launch starts locked', await isLockScreen(page))
await unlockWith(page, 'second secret')
await page.waitForSelector('.nx-app', { timeout: 10_000 }).catch(() => {})
const wrongRemove = await page.evaluate(() => window.api.appLock.removePassword('nope').then(() => 'removed', (e) => e.message))
check('removing it needs the password', /Wrong password/.test(wrongRemove))
await page.evaluate(() => window.api.appLock.removePassword('second secret'))
await app.close()

app = await launch()
page = await app.firstWindow()
await page.waitForSelector('.nx-applock__panel, .nx-app', { timeout: 20_000 })
await sleep(500)
check('once removed, Nexus opens without asking', await isApp(page))
await page.click('.nx-sidebar__lock')
await sleep(700)
check('without a password, the lock button goes to Settings instead', await isApp(page) && (await page.evaluate(() => /App lock/.test(document.body.innerText))))

await app.close()
log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
