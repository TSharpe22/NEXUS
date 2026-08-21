/**
 * Exercises the attachment store against a throwaway directory.
 *
 *   npm run check:files
 *
 * Runs outside Electron on purpose: `src/main/files.ts` has no electron
 * import, so the store can be checked without a display. What is under test is
 * everything the app then trusts — that a name really is a function of the
 * bytes, that a name which is not one of ours never resolves to a path, and
 * that reclaiming deletes exactly the files nothing points at and nothing
 * else. The last one is the only code in Nexus that deletes a file the user
 * did not delete, so it gets the most assertions here.
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { build } from 'esbuild'
import { pathToFileURL } from 'url'

const dir = mkdtempSync(join(tmpdir(), 'nexus-files-'))
const dataDir = join(dir, 'data')
mkdirSync(dataDir, { recursive: true })

let failures = 0
function check(label, ok, extra = '') {
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${extra ? ' — ' + extra : ''}`)
}

async function load(entry, name) {
  const outfile = join(dir, name)
  await build({ entryPoints: [entry], bundle: true, outfile, format: 'esm', platform: 'node' })
  return import(pathToFileURL(outfile).href)
}

const store = await load('src/main/files.ts', 'files.mjs')
const grammar = await load('src/shared/attachments.ts', 'attachments.mjs')

const {
  storeAttachment,
  listAttachments,
  attachmentPath,
  filesDir,
  extensionFor,
  mimeFor,
  stats,
  reclaim
} = store
const { attachmentName, attachmentUrl, ATTACHMENT_URL_PREFIX } = grammar

const bytes = (text) => new Uint8Array(Buffer.from(text, 'utf-8'))
const sha = (text) => createHash('sha256').update(Buffer.from(text, 'utf-8')).digest('hex')

// ------------------------------------------------------------------ storing
console.log('\n— a name is a function of the bytes —')

const shot = storeAttachment(dataDir, bytes('PNG-ish bytes'), 'Screen Shot 2026.PNG')
check('stored under the digest of its own contents',
  shot.name === `${sha('PNG-ish bytes')}.png`, shot.name)
check('the extension is lowercased', shot.name.endsWith('.png'))
check('the URL is what goes into the document',
  shot.url === `${ATTACHMENT_URL_PREFIX}${shot.name}`, shot.url)
check('the bytes are on disk', existsSync(join(filesDir(dataDir), shot.name)))
check('nothing was deduplicated on the first store', shot.deduplicated === false)

const again = storeAttachment(dataDir, bytes('PNG-ish bytes'), 'other-name.png')
check('the same bytes give the same name', again.name === shot.name, again.name)
check('and are recognised as already stored', again.deduplicated === true)
check('so the same picture in ten notes is one file',
  listAttachments(dataDir).length === 1, String(listAttachments(dataDir).length))

// Same bytes under a different extension really are a second file: the
// extension decides how the protocol handler serves them, so they are not
// interchangeable even though the contents are.
const asTxt = storeAttachment(dataDir, bytes('PNG-ish bytes'), 'note.txt')
check('a different extension is a different file', asTxt.name !== shot.name, asTxt.name)
check('and both are kept', listAttachments(dataDir).length === 2)

const noExt = storeAttachment(dataDir, bytes('no extension here'), 'README')
check('a name with no extension stores the bare digest',
  noExt.name === sha('no extension here'), noExt.name)

check('a junk extension is dropped rather than guessed at',
  extensionFor('thing.p n g!!') === 'png', extensionFor('thing.p n g!!'))
check('an absurdly long extension is dropped', extensionFor(`x.${'a'.repeat(40)}`) === '')
check('a trailing dot is not an extension', extensionFor('archive.') === '')

check('an interrupted write is never offered as an attachment', (() => {
  writeFileSync(join(filesDir(dataDir), '.tmp-deadbeef-1-2'), 'half a file')
  return listAttachments(dataDir).every((f) => !f.name.startsWith('.tmp'))
})())

// ------------------------------------------------------- refusing what isn't ours
console.log('\n— a URL that is not ours never becomes a path —')

check('a stored name round-trips through its URL',
  attachmentName(attachmentUrl(shot.name)) === shot.name)
check('an ordinary web image is not an attachment',
  attachmentName('https://example.com/cat.png') === null)
check('nor is a file:// URL someone put in a document',
  attachmentName('file:///etc/passwd') === null)
check('nor is a non-string', attachmentName(undefined) === null && attachmentName(42) === null)

// The document is user data — it can be written by the JSON import or edited
// by hand — so these are the shapes an attacker gets to choose.
for (const evil of [
  '../../../../etc/passwd',
  '..%2F..%2Fetc%2Fpasswd',
  `${'a'.repeat(64)}/../../../etc/passwd`,
  `${'a'.repeat(63)}`,
  `${'A'.repeat(64)}.png`,
  `${'a'.repeat(64)}.png/../../x`,
  ''
]) {
  check(`refused as a name: ${JSON.stringify(evil).slice(0, 44)}`,
    attachmentName(`${ATTACHMENT_URL_PREFIX}${evil}`) === null)
  check(`refused as a path: ${JSON.stringify(evil).slice(0, 44)}`,
    attachmentPath(dataDir, evil) === null)
}
check('a malformed percent-escape is refused, not thrown on',
  attachmentName(`${ATTACHMENT_URL_PREFIX}%E0%A4%A`) === null)
check('a real name does resolve, inside the store',
  attachmentPath(dataDir, shot.name) === join(filesDir(dataDir), shot.name))

check('an unknown extension is served as a download, not a guess',
  mimeFor('abc.wat') === 'application/octet-stream', mimeFor('abc.wat'))
check('a known one is served as itself', mimeFor(shot.name) === 'image/png')
check('svg is served as svg', mimeFor('x.svg') === 'image/svg+xml')

// ---------------------------------------------------------------- reclaiming
console.log('\n— reclaiming deletes exactly what nothing points at —')

const all = listAttachments(dataDir).map((f) => f.name)
check('three files are stored', all.length === 3, String(all.length))

const referenced = new Set([shot.name, noExt.name])
const before = stats(dataDir, referenced)
check('stats counts every file', before.count === 3, String(before.count))
check('stats counts the unreferenced ones', before.unreferencedCount === 1,
  String(before.unreferencedCount))
check('and their bytes are a subset of the total',
  before.unreferencedBytes > 0 && before.unreferencedBytes < before.bytes,
  `${before.unreferencedBytes} of ${before.bytes}`)

const result = reclaim(dataDir, referenced)
check('reclaim deletes the unreferenced file', result.deleted.length === 1,
  JSON.stringify(result.deleted))
check('and reports what it freed', result.bytes === before.unreferencedBytes,
  `${result.bytes} vs ${before.unreferencedBytes}`)
check('the referenced files are untouched',
  existsSync(join(filesDir(dataDir), shot.name)) && existsSync(join(filesDir(dataDir), noExt.name)))
check('their contents are unchanged',
  readFileSync(join(filesDir(dataDir), shot.name), 'utf-8') === 'PNG-ish bytes')
check('the store now holds only what is referenced',
  listAttachments(dataDir).length === 2, String(listAttachments(dataDir).length))

// An empty set is the dangerous input: it is what a caller that failed to
// collect references would pass, and it would take the whole store with it.
// The guarantee here is not that this is refused — it is that the caller is
// the only thing deciding, so `repo.getReferencedAttachments` scanning every
// page including the trash is what makes it safe. This asserts the contract
// rather than a defence, so that a future change to it is a loud one.
const wipe = reclaim(dataDir, new Set())
check('an empty reference set deletes everything — the caller owns being right',
  wipe.deleted.length === 2 && listAttachments(dataDir).length === 0)

check('reclaiming an empty store is not an error', reclaim(dataDir, new Set()).deleted.length === 0)
check('nothing outside the store was touched',
  readdirSync(dataDir).every((entry) => entry === 'files'), readdirSync(dataDir).join(','))

rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
