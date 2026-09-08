/**
 * The attachment store.
 *
 * Every file pasted or dropped into a page is written once, named by the
 * SHA-256 of its own bytes, and referenced from the document by URL. Three
 * things follow from content addressing, and all three are the reason for it:
 *
 * - **The same screenshot pasted into ten pages is one file.** Deduplication
 *   is not an optimisation here, it is what makes a vault of a thousand notes
 *   stay a reasonable size when a third of them quote the same diagram.
 * - **A stored file is never rewritten.** The name is a function of the
 *   contents, so writing it twice writes identical bytes. Nothing can be
 *   editing a file while a backup copies it, and no snapshot can be internally
 *   inconsistent.
 * - **Nothing is ever deleted automatically.** Not on trashing a page, not on
 *   emptying the trash. Reclaiming space is a deliberate act in Settings, for
 *   the same reason `restoreBackup` keeps the vault it replaces: a snapshot
 *   taken last week refers to attachments a sweep run today would consider
 *   unreferenced, and putting that snapshot back has to find its pictures
 *   still there. See `stats()` and `reclaim()` at the bottom.
 *
 * **`nexus.db` is no longer the whole vault.** It was, and the backup module
 * still says so about itself, correctly — it snapshots the database, which is
 * the only copy of every word you have written. The complete vault is now that
 * file *plus* this directory. `NEXUS.md` says which is which; a full backup
 * means copying the `data/` folder, not the database inside it.
 *
 * Imports no `electron`, so the store is exercised against a throwaway
 * directory without a display: `npm run check:files`.
 */
import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  renameSync
} from 'fs'
import { join, resolve, sep } from 'path'
import { ATTACHMENT_NAME_RE, attachmentUrl } from '../shared/attachments'

/** Directory under `data/` holding every attachment. */
export const FILES_DIRNAME = 'files'

export interface StoredAttachment {
  /** `<sha256>.<ext>` — the file's name on disk and in its URL. */
  name: string
  /** `nexus-file://vault/<name>`, which is what goes into the document. */
  url: string
  size: number
  /** True when these exact bytes were already stored, so nothing was written. */
  deduplicated: boolean
}

export function filesDir(dataDir: string): string {
  return join(dataDir, FILES_DIRNAME)
}

/**
 * The extension to store a file under, from the name it arrived with.
 *
 * Lowercased and stripped to alphanumerics: the extension ends up in a URL, in
 * a Markdown link and in a filename on someone else's filesystem, and the
 * bytes are identified by the digest regardless, so nothing is lost by being
 * strict here. An unrecognisable extension is dropped rather than guessed at.
 */
export function extensionFor(originalName: string): string {
  const dot = originalName.lastIndexOf('.')
  if (dot === -1 || dot === originalName.length - 1) return ''
  const ext = originalName
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  return ext.length > 0 && ext.length <= 12 ? ext : ''
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  zip: 'application/zip'
}

/**
 * The type to serve a stored file as.
 *
 * From the extension, because the digest says nothing about the format. An
 * unknown extension is served as a download rather than guessed at — a wrong
 * `image/*` on something that is not an image is how a renderer ends up
 * executing what it was handed.
 */
export function mimeFor(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return 'application/octet-stream'
  return MIME[name.slice(dot + 1).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Resolve a stored name to an absolute path, or null if it is not ours.
 *
 * The second half of the traversal defence: even a name that passed the shape
 * check has to resolve inside the store, which is the check that survives
 * someone loosening `ATTACHMENT_NAME_RE` later. Does not require the file to
 * exist — callers that need it to are the ones that report a missing file.
 */
export function attachmentPath(dataDir: string, name: string): string | null {
  if (!ATTACHMENT_NAME_RE.test(name)) return null
  const root = resolve(filesDir(dataDir))
  const candidate = resolve(join(root, name))
  if (candidate !== root && !candidate.startsWith(root + sep)) return null
  return candidate
}

/**
 * Write bytes into the store and return how to reference them.
 *
 * Written to a temporary name and renamed into place, so a crash or a full
 * disk mid-write cannot leave a truncated file sitting under a digest that
 * promises different contents — the one way a content-addressed store can lie.
 * `rename` within a directory is atomic on every filesystem this runs on.
 */
export function storeAttachment(
  dataDir: string,
  bytes: Uint8Array,
  originalName = ''
): StoredAttachment {
  const digest = createHash('sha256').update(bytes).digest('hex')
  const ext = extensionFor(originalName)
  const name = ext ? `${digest}.${ext}` : digest

  const dir = filesDir(dataDir)
  mkdirSync(dir, { recursive: true })
  const target = join(dir, name)

  if (existsSync(target)) {
    return { name, url: attachmentUrl(name), size: statSync(target).size, deduplicated: true }
  }

  const temp = join(dir, `.tmp-${digest.slice(0, 16)}-${process.pid}-${Date.now()}`)
  try {
    writeFileSync(temp, bytes)
    renameSync(temp, target)
  } catch (err) {
    try {
      if (existsSync(temp)) unlinkSync(temp)
    } catch {
      // The write is the failure worth reporting; a leftover temp file is not.
    }
    throw err
  }

  return { name, url: attachmentUrl(name), size: bytes.byteLength, deduplicated: false }
}

export interface StoredFile {
  name: string
  size: number
}

/**
 * Every attachment on disk. Temporary files from an interrupted write are
 * skipped — they are not attachments and must never be offered as ones.
 */
export function listAttachments(dataDir: string): StoredFile[] {
  const dir = filesDir(dataDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => ATTACHMENT_NAME_RE.test(f))
    .map((name) => ({ name, size: statSync(join(dir, name)).size }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface StoreStats {
  folder: string
  count: number
  bytes: number
  unreferencedCount: number
  unreferencedBytes: number
}

/**
 * What is on disk, and how much of it nothing points at any more.
 *
 * `referenced` is every name still named by a document — the caller collects
 * it, because this module knows nothing about pages. An attachment goes
 * unreferenced by ordinary means: the block quoting it was deleted, or the
 * page was. It is still not removed until asked.
 */
export function stats(dataDir: string, referenced: Set<string>): StoreStats {
  const files = listAttachments(dataDir)
  const orphans = files.filter((f) => !referenced.has(f.name))
  return {
    folder: filesDir(dataDir),
    count: files.length,
    bytes: files.reduce((sum, f) => sum + f.size, 0),
    unreferencedCount: orphans.length,
    unreferencedBytes: orphans.reduce((sum, f) => sum + f.size, 0)
  }
}

export interface ReclaimResult {
  deleted: string[]
  bytes: number
}

/**
 * Delete every attachment nothing references. Only ever called on request.
 *
 * The caller owns being sure `referenced` is complete — it is derived from
 * every page in the database including trashed ones, and a set that is missing
 * a page is a set that deletes its pictures. That is why this is not wired to
 * `emptyTrash`: the sweep is correct only against a full scan, and a full scan
 * on every delete is both slow and a great deal of trust to place in a
 * background task nobody asked for.
 */
export function reclaim(dataDir: string, referenced: Set<string>): ReclaimResult {
  const deleted: string[] = []
  let bytes = 0

  for (const file of listAttachments(dataDir)) {
    if (referenced.has(file.name)) continue
    const path = attachmentPath(dataDir, file.name)
    if (!path) continue
    try {
      unlinkSync(path)
      deleted.push(file.name)
      bytes += file.size
    } catch {
      // Locked or already gone. Reclaiming space is best-effort by nature.
    }
  }

  return { deleted, bytes }
}
