/**
 * The lock screen's backdrop: lock a scratch vault, screenshot it twice a
 * second apart (it should move), unlock. For looking at.
 *
 *   npm run build && node scripts/probes/lock-look.mjs
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

const APP = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')
const SHOT = process.env.SCREENSHOT_DIR || '/tmp/shots'
mkdirSync(SHOT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nexus-lock-'))}`, APP],
  cwd: APP,
  env: { ...process.env, NODE_ENV: 'production' },
  timeout: 45_000
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.setViewportSize({ width: Number(process.env.W || 1920), height: Number(process.env.H || 1100) })
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await page.evaluate(() => window.api.appLock.setPassword(null, 'probe-only-pass'))
await page.evaluate(() => window.api.appLock.lock())
await page.waitForSelector('.nx-applock__backdrop', { timeout: 10_000 })
await sleep(2500)
await page.screenshot({ path: `${SHOT}/lock-1.png` })
// Frame time over two seconds of drawing.
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0
      const start = performance.now()
      const tick = () => {
        frames++
        if (performance.now() - start < 2000) requestAnimationFrame(tick)
        else resolve(Math.round((frames / (performance.now() - start)) * 1000))
      }
      requestAnimationFrame(tick)
    })
)
await page.screenshot({ path: `${SHOT}/lock-2.png` })
const same = readFileSync(`${SHOT}/lock-1.png`).equals(readFileSync(`${SHOT}/lock-2.png`))
await page.fill('.nx-applock__input', 'probe-only-pass')
await page.keyboard.press('Enter')
await page.waitForSelector('.nx-app', { timeout: 10_000 })
console.log(`moving: ${!same} · browser fps while drawing: ${fps} · unlocked: yes · errors: ${errors.length ? errors.join(' | ') : 'none'}`)
console.log(`shots in ${SHOT}`)
await app.close()
