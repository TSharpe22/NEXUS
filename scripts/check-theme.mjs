/**
 * Themes: Nexus opens in the original look; Settings → Appearance switches
 * to Miami at once; the choice survives a restart; and in Miami no element
 * on the main screens is still painted in one of the original theme's
 * greens (a colour hard-coded somewhere instead of taken from a token).
 *
 *   npm run check:theme     (builds, then runs under xvfb)
 *
 * Scratch userData and a copy of the fixture ledger; SCREENSHOT_DIR=... saves
 * each screen in Miami for a look by eye.
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

const APP = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const userDataDir = mkdtempSync(join(tmpdir(), 'nexus-theme-'))
const ledger = join(mkdtempSync(join(tmpdir(), 'nexus-ledger-')), 'trading.db')
copyFileSync(join(APP, 'test-fixtures/trading-practice.db'), ledger)

let fails = 0
const check = (label, ok, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? ' ok  ' : 'FAIL '} ${label}${extra ? ' — ' + extra : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const launch = () =>
  electron.launch({
    executablePath: join(APP, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`, APP],
    cwd: APP,
    env: { ...process.env, NODE_ENV: 'production', TRADING_DB: ledger },
    timeout: 45_000
  })

// The original theme's greens; none should survive into Miami.
const ORIGINAL = ['105, 180, 138', '130, 197, 158', '80, 154, 114', '15, 17, 15', '21, 25, 23', '28, 32, 29', '105, 147, 101', '5, 16, 10']

let app = await launch()
let page = await app.firstWindow()
const errors = []
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
}
watch(page)
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await sleep(800)

const theme = () => page.evaluate(() => document.documentElement.dataset.theme ?? 'default')
const token = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)
const nav = (label) =>
  page.evaluate((label) => {
    const item = [...document.querySelectorAll('.nx-nav-item')].find((el) => el.textContent.trim() === label)
    item?.click()
    return !!item
  }, label)

check('Nexus opens in the original look', (await theme()) === 'default' && (await token('--nx-accent')) === '#69b48a')

// A vault with something in it, so the command pages draw their panels.
await page.locator('button', { hasText: 'New page' }).first().click()
await sleep(500)

const leftovers = () =>
  page.evaluate((original) => {
    const hits = new Set()
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none') continue
      for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor', 'outlineColor', 'fill', 'stroke']) {
        const v = cs[prop]
        if (original.some((rgb) => v.includes(rgb))) hits.add(`${el.className || el.tagName}:${prop}=${v}`)
      }
    }
    return [...hits].slice(0, 8)
  }, ORIGINAL)

// The scan below has to be able to see green, or it proves nothing.
check('control: the scan finds the greens in the original look', (await leftovers()).length > 0)

check('Settings is in the sidebar', await nav('Settings'))
await sleep(600)
const select = page.locator('.nx-settings__row', { hasText: 'Theme' }).locator('select')
check('Settings → Appearance offers the theme', (await select.count()) === 1)
await select.selectOption('miami')
await sleep(500)
check('choosing Miami applies it at once', (await theme()) === 'miami' && (await token('--nx-accent')) === '#38e1ff')
check('and stores it in the vault', (await page.evaluate(() => window.api.prefs.get())).theme === 'miami')

await app.close()
app = await launch()
page = await app.firstWindow()
watch(page)
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await sleep(800)
check('Miami survives a restart', (await theme()) === 'miami')

const shot = async (name) => process.env.SCREENSHOT_DIR && page.screenshot({ path: join(process.env.SCREENSHOT_DIR, name) })
for (const screen of ['Home', 'Trading', 'Notes', 'Settings']) {
  await nav(screen)
  await sleep(1200)
  if (screen === 'Trading') {
    await page.locator('.nx-tr-session__main').first().click().catch(() => {})
    await sleep(400)
  }
  const hits = await leftovers()
  check(`${screen}: nothing still painted in the original greens`, hits.length === 0, hits.join(' | '))
  await shot(`miami-${screen.toLowerCase()}.png`)
}

await nav('Settings')
await sleep(500)
await page.locator('.nx-settings__row', { hasText: 'Theme' }).locator('select').selectOption('default')
await sleep(400)
check('switching back restores the original look', (await theme()) === 'default' && (await token('--nx-accent')) === '#69b48a')
check('no errors in the renderer', errors.length === 0, errors.join(' | '))

await app.close()
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
