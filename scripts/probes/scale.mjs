/** Capture focus, and Home's responsiveness at a 1500-page vault. */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const APP = process.env.APP_DIR
const SHOT = process.env.SCREENSHOT_DIR || '/tmp/shots-after'
const N = Number(process.env.SEED_PAGES || 1500)
mkdirSync(SHOT, { recursive: true })
const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nexus-after-'))}`, APP],
  cwd: APP,
  env: { ...process.env, NODE_ENV: 'production' },
  timeout: 45_000
})
const page = await app.firstWindow()
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await page.setViewportSize({ width: 1280, height: 820 })

log(`— seeding ${N} pages —`)
await page.evaluate(async (n) => {
  const uid = () => crypto.randomUUID()
  const ids = []
  for (let i = 0; i < n; i++) ids.push((await window.api.pages.create()).id)
  for (let i = 0; i < n; i++) {
    await window.api.pages.update(ids[i], {
      title: `Page number ${i} about something`,
      content: JSON.stringify([
        { id: uid(), type: 'paragraph', props: {}, content: [{ type: 'text', text: `Body text for page ${i}. `.repeat(6), styles: {} }], children: [] },
        { id: uid(), type: 'paragraph', props: {}, content: [{ type: 'text', text: 'see ', styles: {} }, { type: 'pageMention', props: { pageId: ids[(i * 17 + 3) % n], pageTitle: 'x' } }], children: [] },
        { id: uid(), type: 'checkListItem', props: { checked: i % 3 === 0 }, content: [{ type: 'text', text: `task ${i}`, styles: {} }], children: [] }
      ])
    })
  }
}, N)
await page.evaluate(() => window.location.reload())
await page.waitForSelector('.nx-app', { timeout: 30_000 })
await sleep(1000)

const nav = (label) =>
  page.evaluate((label) => {
    ;[...document.querySelectorAll('.nx-nav-item')].find((e) => e.textContent.trim() === label)?.click()
  }, label)

await nav('Notes')
await sleep(1500)

log('\n— Home at 1500 pages —')
const r = await page.evaluate(async () => {
  const gaps = []
  let last = performance.now()
  let running = true
  const sample = () => {
    const now = performance.now()
    gaps.push(now - last)
    last = now
    if (running) requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)
  const t0 = performance.now()
  ;[...document.querySelectorAll('.nx-nav-item')].find((e) => e.textContent.trim() === 'Home').click()
  await new Promise((res) => setTimeout(res, 6000))
  running = false
  gaps.sort((a, b) => b - a)
  return {
    totalMs: Math.round(performance.now() - t0),
    worstFrameMs: Math.round(gaps[0]),
    p95FrameMs: Math.round(gaps[Math.floor(gaps.length * 0.05)]),
    frames: gaps.length
  }
})
log('  ' + JSON.stringify(r))
await page.screenshot({ path: `${SHOT}/home-1500-after.png` })

log('\n— typing into the capture box while Home is live —')
await page.click('.nx-home__capture-input')
const typeT = await page.evaluate(async () => {
  const el = document.querySelector('.nx-home__capture-input')
  const t0 = performance.now()
  for (let i = 0; i < 30; i++) {
    el.value += 'a'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((res) => requestAnimationFrame(res))
  }
  return Math.round(performance.now() - t0)
})
log(`  30 input frames in ${typeT}ms`)

log('\n— capture keeps focus —')
await page.evaluate(() => {
  const el = document.querySelector('.nx-home__capture-input')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, '')
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.click('.nx-home__capture-input')
await page.keyboard.type('first thought', { delay: 10 })
await page.keyboard.press('Enter')
await sleep(1800)
const focus = await page.evaluate(() => ({
  active: document.activeElement?.className || document.activeElement?.tagName,
  value: document.querySelector('.nx-home__capture-input')?.value
}))
log('  focus after capture:', JSON.stringify(focus))
await page.keyboard.type('second thought', { delay: 10 })
await sleep(400)
log('  typing again without clicking lands in the box:',
  JSON.stringify(await page.evaluate(() => document.querySelector('.nx-home__capture-input')?.value)))

await app.close()
process.exit(0)
