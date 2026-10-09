/**
 * The Trading command page on the simulated ledger, with the trading notes
 * set up, for looking at.
 * W and H set the window size (default 1920 x 1100).
 *
 *   npm run build && node scripts/probes/trading-look.mjs
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

const APP = process.env.APP_DIR || fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')
const SHOT = process.env.SCREENSHOT_DIR || '/tmp/shots'
mkdirSync(SHOT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nexus-trading-'))}`, APP],
  cwd: APP,
  env: { ...process.env, NODE_ENV: 'production' },
  timeout: 45_000
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.setViewportSize({ width: Number(process.env.W || 1920), height: Number(process.env.H || 1100) })
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await page.evaluate(async () => {
  await window.api.pages.create()
  await window.nexus.store.getState().refresh()
  window.nexus.store.getState().openCommand('trading')
  // "Set up trading notes", as ⌘K runs it.
  await window.nexus.store.getState().setupTradingNotes()
})
await sleep(2000)
await page.screenshot({ path: `${SHOT}/trading.png` })
await page.evaluate(() => { const m = document.querySelector('.nx-home')?.parentElement; if (m) m.scrollTop = 99999 })
await sleep(400)
await page.screenshot({ path: `${SHOT}/trading-bottom.png` })
console.log(errors.length ? `errors: ${errors.join(' | ')}` : 'no errors', `· shots in ${SHOT}`)
await app.close()
