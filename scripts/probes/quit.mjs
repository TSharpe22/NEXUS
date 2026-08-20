/**
 * Does an edit typed inside the autosave debounce survive (a) closing the
 * window, (b) app.quit()? And does a second launch get its own window?
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const APP = process.env.APP_DIR
const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const launcher = (dir) => async () => {
  const app = await electron.launch({
    executablePath: join(APP, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${dir}`, APP],
    cwd: APP,
    env: { ...process.env, NODE_ENV: 'production' },
    timeout: 45_000
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.nx-app', { timeout: 20_000 })
  await page.setViewportSize({ width: 1280, height: 820 })
  return { app, page }
}

async function quitRun(label, quitFn) {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-quit-'))
  const launch = launcher(dir)
  let { app, page } = await launch()

  const id = await page.evaluate(async () => {
    const uid = () => crypto.randomUUID()
    const p = await window.api.pages.create()
    await window.api.pages.update(p.id, {
      title: 'Quit probe',
      content: JSON.stringify([
        { id: uid(), type: 'paragraph', props: {}, content: [{ type: 'text', text: 'seed body', styles: {} }], children: [] }
      ])
    })
    return p.id
  })
  await page.evaluate(() => window.location.reload())
  await page.waitForSelector('.nx-app', { timeout: 20_000 })
  await sleep(1500)

  await page.evaluate(() =>
    [...document.querySelectorAll('.nx-nav-item')].find((r) => r.textContent.trim() === 'Notes')?.click()
  )
  await sleep(1000)
  await page.evaluate(() => document.querySelector('.nx-tree-row')?.click())
  await sleep(1800)
  if (!(await page.evaluate(() => !!document.querySelector('.bn-editor')))) {
    log(`${label}: editor never mounted, skipping`)
    await app.close()
    return
  }

  await page.click('.bn-editor .bn-block-content')
  await page.keyboard.press('End')
  await page.keyboard.type(' BODYEDIT', { delay: 3 })
  await page.click('.nx-editor__title')
  await page.keyboard.press('End')
  await page.keyboard.type(' TITLEEDIT', { delay: 3 })
  await sleep(80)

  await quitFn(app, page)
  await sleep(2500)

  ;({ app, page } = await launch())
  await sleep(1500)
  const saved = await page.evaluate((id) => window.api.pages.getById(id), id)
  log(`${label}:`)
  log(`   body edit survived:  ${!!(saved && saved.content.includes('BODYEDIT'))}`)
  log(`   title edit survived: ${!!(saved && saved.title.includes('TITLEEDIT'))}  (title: ${JSON.stringify(saved?.title)})`)
  await app.close()
}

await quitRun('window close (X)', async (app) => {
  await app.close()
})
await quitRun('app.quit() — Ctrl+Q / menu Quit', async (app) => {
  await app.evaluate(({ app }) => app.quit()).catch(() => {})
})

// ------------------------------------------------------------- second instance
const dir = mkdtempSync(join(tmpdir(), 'nexus-single-'))
const launch = launcher(dir)
const a = await launch()
const pid = await a.page.evaluate(async () => {
  const p = await window.api.pages.create()
  await window.api.pages.update(p.id, { title: 'instance A' })
  return p.id
})
log('\nsecond instance:')
let b = null
try {
  b = await launch()
  log('   FAIL — a second window opened on the same vault')
} catch (e) {
  log('   ok — second launch got no window (' + e.message.split('\n')[0].slice(0, 60) + ')')
}
if (b) await b.app.close()
const stillAlive = await a.page.evaluate((id) => window.api.pages.getById(id).then((p) => p && p.title), pid)
log('   first instance still usable:', JSON.stringify(stillAlive))
await a.app.close()
process.exit(0)
