/**
 * Exercises the rotating launch snapshots against a throwaway directory.
 *
 *   npm run check:backup
 *
 * Runs outside Electron on purpose: `src/main/backup.ts` has no electron
 * import, so the rotation can be checked without launching the app. What is
 * under test is the policy — that a snapshot is taken when the vault has moved
 * on, skipped when it has not, and that rotation drops the oldest rather than
 * the newest.
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, utimesSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { build } from 'esbuild'
import { pathToFileURL } from 'url'

const dir = mkdtempSync(join(tmpdir(), 'nexus-backup-'))
const dataDir = join(dir, 'data')
mkdirSync(dataDir, { recursive: true })
const dbPath = join(dataDir, 'nexus.db')
const bundlePath = join(dir, 'backup.mjs')

let failures = 0
function check(label, ok, extra = '') {
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${extra ? ' — ' + extra : ''}`)
}

await build({
  entryPoints: ['src/main/backup.ts'],
  bundle: true,
  outfile: bundlePath,
  format: 'esm',
  platform: 'node'
})
const { rotateBackups, listBackups } = await import(pathToFileURL(bundlePath).href)

// A vault that does not exist yet has nothing to copy.
check('no database yet is not an error', rotateBackups(dataDir, dbPath).created === null)

// Nudge mtime forward by hand: two writes in the same millisecond are
// indistinguishable, and the whole policy is built on that comparison.
let clock = Date.now()
const writeVault = (contents) => {
  writeFileSync(dbPath, contents)
  clock += 60_000
  utimesSync(dbPath, new Date(clock), new Date(clock))
}

writeVault('vault v1')
const first = rotateBackups(dataDir, dbPath)
check('first launch takes a snapshot', first.created !== null)
check('the snapshot is a copy of the vault', readFileSync(first.created, 'utf-8') === 'vault v1')

// Launching again without having written anything must not churn the rotation.
const second = rotateBackups(dataDir, dbPath)
check('an unchanged vault is not snapshotted again', second.created === null)
check('and nothing was pruned for it', listBackups(dataDir).length === 1)

writeVault('vault v2')
const third = rotateBackups(dataDir, dbPath)
check('a changed vault is snapshotted again', third.created !== null)
check('both snapshots are kept', listBackups(dataDir).length === 2)
check('the newest snapshot is the newest vault',
  readFileSync(listBackups(dataDir)[0], 'utf-8') === 'vault v2')
check('the older one still holds what it held',
  readFileSync(listBackups(dataDir)[1], 'utf-8') === 'vault v1')

// Rotation drops the oldest, and only past the limit.
const KEEP = 3
rmSync(join(dataDir, 'backups'), { recursive: true, force: true })
const written = []
for (let i = 0; i < KEEP + 2; i++) {
  writeVault(`vault gen ${i}`)
  written.push(rotateBackups(dataDir, dbPath, KEEP).created)
}
const kept = listBackups(dataDir)
check(`rotation keeps exactly ${KEEP}`, kept.length === KEEP, `${kept.length}`)
check('rotation drops the oldest, not the newest',
  readFileSync(kept[0], 'utf-8') === `vault gen ${KEEP + 1}`,
  readFileSync(kept[0], 'utf-8'))
check('the dropped snapshots are the earliest ones',
  written.slice(0, 2).every((p) => !existsSync(p)))
check('every surviving snapshot is a distinct generation',
  new Set(kept.map((p) => readFileSync(p, 'utf-8'))).size === KEEP)

rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
