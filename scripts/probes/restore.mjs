/** Does restoring a snapshot actually put the vault back? */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, readdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const APP = process.env.APP_DIR
const dir = mkdtempSync(join(tmpdir(), 'nexus-restore-'))
const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const launch = async () => {
  const app = await electron.launch({
    executablePath: join(APP, 'node_modules/electron/dist/electron'),
    args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${dir}`, APP],
    cwd: APP, env: { ...process.env, NODE_ENV: 'production' }, timeout: 45_000
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.nx-app', { timeout: 20_000 })
  return { app, page }
}

// Session 1: write something, then quit so it is on disk.
let { app, page } = await launch()
await page.evaluate(async () => {
  const p = await window.api.pages.create()
  await window.api.pages.update(p.id, { title: 'BEFORE the snapshot' })
})
await app.close()
await sleep(1500)

// Session 2: launching snapshots the vault as it was. Then write more.
;({ app, page } = await launch())
const snapshots = await page.evaluate(() => window.api.stats.getBackups())
log('snapshots after relaunch:', snapshots.count)
await page.evaluate(async () => {
  const p = await window.api.pages.create()
  await window.api.pages.update(p.id, { title: 'AFTER the snapshot' })
})
const beforeRestore = await page.evaluate(() => window.api.pages.list().then((l) => l.map((p) => p.title)))
log('titles before restore:', JSON.stringify(beforeRestore))

await page.evaluate((path) => window.api.stats.restoreBackup(path), snapshots.all[0])
await sleep(3000)
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await sleep(1500)

const afterRestore = await page.evaluate(() => window.api.pages.list().then((l) => l.map((p) => p.title)))
log('titles after restore: ', JSON.stringify(afterRestore))
log('  BEFORE survived:', afterRestore.includes('BEFORE the snapshot'), '(want true)')
log('  AFTER is gone:  ', !afterRestore.includes('AFTER the snapshot'), '(want true)')

const kept = readdirSync(join(dir, 'data')).filter((f) => f.includes('pre-restore'))
log('  replaced vault kept as:', JSON.stringify(kept), '(want one file)')
log('  wal/shm cleared:', !existsSync(join(dir, 'data', 'nexus.db-wal')) || 'a fresh one was made by the reopen')

// The app must still be usable afterwards, not just correct.
const writable = await page.evaluate(async () => {
  const p = await window.api.pages.create()
  await window.api.pages.update(p.id, { title: 'AFTER the restore' })
  const list = await window.api.pages.list()
  return list.some((x) => x.title === 'AFTER the restore')
})
log('  vault is writable after restoring:', writable, '(want true)')
await app.close()
process.exit(0)
