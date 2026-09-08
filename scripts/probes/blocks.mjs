/**
 * Blocks: does the block menu open where you are typing?
 *
 * "Blocks respond poorly" was reported from daily use and stayed on the
 * roadmap undiagnosed for want of a reproduction. This is it. Typing "/" is
 * asked for in every block type, twice — once while the block is empty and
 * once after a word has been typed into it — and the answer is printed as a
 * table, because the failure is a *pair* of answers: the two custom React
 * block specs, `callout` and `toggle`, opened the menu on an empty block and
 * stopped opening it the moment there was anything to write around.
 *
 * ProseMirror routes a typed character through `handleTextInput`, which is the
 * only thing BlockNote's suggestion plugin listens to. For the built-in blocks
 * it always does; for a custom React block spec it stops once the block has
 * content, and the character lands as a literal "/" with no menu, no error and
 * nothing logged. The same goes for "[", so a `[[link]]` could not be written
 * from inside a callout either.
 *
 *     npm run build
 *     APP_DIR=$PWD xvfb-run -a node scripts/probes/blocks.mjs
 *
 * Every row should read `true / true`. Before the fix in `Editor.tsx`, callout
 * and toggle read `true / false`.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const APP = process.env.APP_DIR
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nexus-bl-'))}`, APP],
  cwd: APP,
  env: { ...process.env, NODE_ENV: 'production' },
  timeout: 45_000
})
const page = await app.firstWindow()
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await page.setViewportSize({ width: 1280, height: 820 })

const fresh = async (title) => {
  await page.evaluate(async (title) => {
    const p = await window.api.pages.create()
    await window.api.pages.update(p.id, { title })
    await window.nexus.store.getState().refresh()
    window.nexus.store.getState().openPage(p.id)
  }, title)
  await page.waitForSelector('.bn-editor', { timeout: 20_000 })
  await sleep(1300)
  await page.click('.bn-editor')
}

const menuVisible = () =>
  page.evaluate(() => !!document.querySelector('[class*="bn-suggestion-menu"], [role="listbox"]'))

// Each block type, and the slash-menu entry that makes one. A paragraph is
// what a page starts as, so it needs no entry.
const BLOCKS = [
  ['paragraph', null],
  ['heading', 'heading'],
  ['bulletListItem', 'bullet'],
  ['numberedListItem', 'numbered'],
  ['checkListItem', 'check'],
  ['callout', 'callout'],
  ['toggle', 'toggle']
]

log('block type        "/" on an empty block   "/" after a word')
let bad = 0

for (const [label, entry] of BLOCKS) {
  await fresh(`slash in ${label}`)

  if (entry) {
    await page.keyboard.type('/' + entry, { delay: 40 })
    await sleep(700)
    if (!(await menuVisible())) {
      log(`${label.padEnd(18)} could not be inserted — the menu did not open in a paragraph`)
      bad++
      continue
    }
    await page.keyboard.press('Enter')
    await sleep(500)
  }

  await page.keyboard.type('/', { delay: 40 })
  await sleep(700)
  const empty = await menuVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Backspace')
  await sleep(250)

  await page.keyboard.type('word ', { delay: 30 })
  await sleep(250)
  await page.keyboard.type('/', { delay: 40 })
  await sleep(700)
  const written = await menuVisible()
  await page.keyboard.press('Escape')

  if (!empty || !written) bad++
  log(`${label.padEnd(18)} ${String(empty).padEnd(22)} ${written}`)
}

// The link menu rides the same plugin, so it fails and is fixed together with
// the block menu. A callout you cannot link out of is the sharper half.
await fresh('link out of a callout')
await page.keyboard.type('/callout', { delay: 40 })
await sleep(700)
await page.keyboard.press('Enter')
await sleep(500)
await page.keyboard.type('see also ', { delay: 30 })
await sleep(250)
await page.keyboard.type('[[', { delay: 60 })
await sleep(800)
const linkMenu = await page.evaluate(() => !!document.querySelector('.nx-link-menu'))
log('')
log(`"[[" inside a callout with text: ${linkMenu}`)
if (!linkMenu) bad++

log('')
log(bad === 0 ? 'every block type reaches its menus' : `${bad} block type(s) cannot reach a menu`)

await app.close()
process.exit(bad === 0 ? 0 : 1)
