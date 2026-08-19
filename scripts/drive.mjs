// REPL driver for the Nexus Electron app. Run under xvfb on headless Linux.
// Wrap in tmux, send-keys commands, capture-pane output.
import { _electron as electron } from 'playwright-core'
import * as readline from 'node:readline'
import * as fs from 'node:fs'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/shots'
fs.mkdirSync(SHOT_DIR, { recursive: true })

let app = null
let page = null

const electronBin =
  process.platform === 'darwin'
    ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : path.join(APP_DIR, 'node_modules/electron/dist/electron')

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched')
    app = await electron.launch({
      executablePath: electronBin,
      args: ['--no-sandbox', '--disable-gpu', APP_DIR],
      cwd: APP_DIR,
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99', NODE_ENV: 'production' },
      timeout: 45_000
    })
    page = await app.firstWindow()
    // Forward renderer console + crashes: a blank window is usually a
    // renderer exception, and this is the only way to see it.
    page.on('console', (m) => console.log(`[renderer:${m.type()}]`, m.text()))
    page.on('pageerror', (e) => console.log('[renderer:error]', e.message))
    await page.waitForSelector('.nx-app', { timeout: 20_000 }).catch(() => {})
    console.log('launched. windows:', app.windows().length)
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first')
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png')
    await page.screenshot({ path: f })
    console.log('screenshot:', f)
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first')
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK'
    }, sel)
    console.log('click', sel, '→', r)
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first')
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, a, [role="button"], [cmdk-item]')]
      const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t))
      if (!el) return 'NOT_FOUND'
      el.click()
      return 'OK: ' + el.tagName + ' ' + JSON.stringify(el.textContent?.trim().slice(0, 40))
    }, text)
    console.log('click-text', JSON.stringify(text), '→', r)
  },

  /** contentEditable (ProseMirror/BlockNote) needs a real focus + typed keys. */
  async focus(sel) {
    if (!page) return console.log('ERROR: launch first')
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return 'NOT_FOUND'
      el.focus()
      return 'OK'
    }, sel)
    console.log('focus', sel, '→', r)
  },

  async type(text) {
    if (page) await page.keyboard.type(text, { delay: 25 })
    console.log('typed', JSON.stringify(text))
  },

  async press(key) {
    if (page) await page.keyboard.press(key)
    console.log('pressed', key)
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first')
    try {
      await page.waitForSelector(sel, { timeout: 12_000 })
      console.log('found:', sel)
    } catch {
      console.log('TIMEOUT:', sel)
    }
  },

  async sleep(ms) {
    await new Promise((r) => setTimeout(r, Number(ms) || 1000))
    console.log('slept', ms)
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first')
    try {
      console.log(JSON.stringify(await page.evaluate(expr)))
    } catch (e) {
      console.log('ERROR:', e.message)
    }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first')
    console.log(
      await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', sel || null)
    )
  },

  /** Main-process side: run a query straight against the database. */
  async main(expr) {
    if (!app) return console.log('ERROR: launch first')
    try {
      console.log(JSON.stringify(await app.evaluate(new Function('ctx', `return (${expr})`))))
    } catch (e) {
      console.log('MAIN ERROR:', e.message)
    }
  },

  async quit() {
    if (app) await app.close().catch(() => {})
    app = null
    page = null
  },

  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '))
  }
}

const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') })
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' })

rl.on('line', async (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  if (!cmd) return rl.prompt()
  const fn = COMMANDS[cmd]
  if (!fn) {
    console.log('unknown:', cmd, '— try: help')
    return rl.prompt()
  }
  try {
    await fn(rest.join(' '))
  } catch (e) {
    console.log('ERROR:', e.message)
  }
  if (cmd === 'quit') {
    rl.close()
    process.exit(0)
  }
  rl.prompt()
})
rl.on('close', async () => {
  await COMMANDS.quit()
  process.exit(0)
})

console.log('nexus driver — "help" for commands, "launch" to start')
rl.prompt()
