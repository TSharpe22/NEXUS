/**
 * Vault mirror — writes the database out as a plain Markdown tree on disk.
 *
 * Deliberately ONE-WAY (database to disk). Two-way sync is a genuinely hard
 * problem and is not what this is for: the point is that any assistant, any
 * editor, and any backup tool can read the vault as ordinary files.
 *
 * Safety contract, in priority order:
 *   1. Every path written is verified to resolve inside the chosen root.
 *   2. Only files recorded in the `mirror_files` manifest are ever deleted, so
 *      a file the user put in the folder themselves is never touched.
 *   3. Directories are removed only when already empty.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  unlinkSync,
  rmdirSync,
  readdirSync
} from 'fs'
import { dirname, join, resolve, sep } from 'path'
import * as repo from './repo'
import { exportPageMarkdown } from './io'
import { attachmentPath } from './files'
import { getDataDir } from './database'
import { extractAttachmentNames, parseDocument } from '../shared/document'
import type { Page, PageLocation, Folder } from '../shared/types'

const SETTING_ENABLED = 'mirror.enabled'
const SETTING_FOLDER = 'mirror.folder'
const SETTING_LAST_SYNC = 'mirror.lastSyncAt'

/** Manifest key for the generated index. The space keeps it out of UUID space. */
const INDEX_KEY = ' index'
const INDEX_FILENAME = '_nexus-index.md'

/**
 * Attachments are copied in, not linked to.
 *
 * The mirror exists so that any assistant, editor or backup tool can read the
 * vault as ordinary files, and a folder whose pictures are absolute paths into
 * `~/.config/nexus` stops being that the moment it is moved, synced to another
 * machine or committed to git. Copying costs a second set of bytes on disk and
 * buys a tree that is complete on its own.
 *
 * The manifest keys them under a prefix that cannot collide with a page's
 * UUID, for the same reason the index does — the mirror only ever deletes
 * files it recorded writing, and an attachment copy has to be one of them.
 */
const FILES_DIRNAME = '_files'
const FILE_KEY_PREFIX = ' file:'

const DEBOUNCE_MS = 1500

export interface MirrorConfig {
  enabled: boolean
  folder: string | null
  lastSyncAt: string | null
}

export interface MirrorResult {
  written: number
  deleted: number
  unchanged: number
  total: number
}

// ============================================================
// Configuration
// ============================================================

export function getConfig(): MirrorConfig {
  return {
    enabled: repo.getSetting(SETTING_ENABLED) === '1',
    folder: repo.getSetting(SETTING_FOLDER),
    lastSyncAt: repo.getSetting(SETTING_LAST_SYNC)
  }
}

export function setFolder(folder: string | null): MirrorConfig {
  repo.setSetting(SETTING_FOLDER, folder)
  // Choosing a folder is the act of turning the mirror on; clearing it turns
  // the mirror off rather than leaving it enabled with nowhere to write.
  repo.setSetting(SETTING_ENABLED, folder ? '1' : '0')
  return getConfig()
}

export function setEnabled(enabled: boolean): MirrorConfig {
  if (enabled && !repo.getSetting(SETTING_FOLDER)) {
    throw new Error('Choose a folder for the vault mirror first')
  }
  repo.setSetting(SETTING_ENABLED, enabled ? '1' : '0')
  return getConfig()
}

// ============================================================
// Filenames and paths
// ============================================================

// Reserved on Windows regardless of extension.
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

// Path separators, characters illegal on Windows, and C0 control codes.
const ILLEGAL_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

/**
 * Turn a title or folder name into one path segment.
 *
 * Unlike the slug used by `exportAllMarkdown`, this keeps the name readable —
 * the whole point of the mirror is that a person or an assistant can browse
 * the folder and recognise what they are looking at.
 */
export function safeFileName(name: string): string {
  let out = (name || 'Untitled')
    .replace(ILLEGAL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Leading dots hide the file; trailing dots and spaces are silently
    // stripped by Windows, which would change the name out from under the
    // manifest and orphan the file. Spaces go with dots at both ends so a
    // title like "../../etc" cannot leave a leading space behind.
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '')

  if (!out) out = 'Untitled'
  if (RESERVED_NAMES.test(out)) out = `${out}_`

  // Leave room for a disambiguating suffix and the .md extension.
  if (out.length > 120) out = out.slice(0, 120).trimEnd()
  return out || 'Untitled'
}

/** Reject any path that escapes the mirror root, however it was constructed. */
function assertInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = resolve(root)
  const resolved = resolve(candidate)
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + sep)) {
    throw new Error(`Refusing to touch a path outside the mirror folder: ${resolved}`)
  }
  return resolved
}

/**
 * Relative path for every page, mirroring the Notes folder tree as
 * directories. Pages at the folder root land at the top level.
 */
export function computePaths(pages: PageLocation[], folders: Folder[]): Map<string, string> {
  const folderById = new Map(folders.map((f) => [f.id, f]))

  // Directory path for a folder, deduplicated per parent so two folders that
  // share a name under the same parent cannot collide on disk.
  const dirCache = new Map<string, string[]>()
  const usedPerParent = new Map<string, Set<string>>()

  const segmentsFor = (folderId: string | null): string[] => {
    if (!folderId) return []
    const cached = dirCache.get(folderId)
    if (cached) return cached

    const folder = folderById.get(folderId)
    if (!folder) return []

    // Guard against a parent cycle rather than recursing forever.
    const seen = new Set<string>()
    let cursor: Folder | undefined = folder
    const chain: Folder[] = []
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      chain.unshift(cursor)
      cursor = cursor.parent_folder_id ? folderById.get(cursor.parent_folder_id) : undefined
    }

    const segments: string[] = []
    for (const node of chain) {
      const parentKey = node.parent_folder_id ?? ''
      const used = usedPerParent.get(parentKey) ?? new Set<string>()
      usedPerParent.set(parentKey, used)

      const existing = dirCache.get(node.id)
      if (existing) {
        segments.length = 0
        segments.push(...existing)
        continue
      }

      const base = safeFileName(node.name)
      let candidate = base
      let counter = 2
      while (used.has(candidate.toLowerCase())) candidate = `${base} (${counter++})`
      used.add(candidate.toLowerCase())

      segments.push(candidate)
      dirCache.set(node.id, [...segments])
    }
    return dirCache.get(folderId) ?? segments
  }

  // File names are unique per directory, and stable run to run because pages
  // arrive in the database's own order. Compared case-insensitively, since
  // macOS and Windows filesystems are.
  const usedPerDir = new Map<string, Set<string>>()
  const paths = new Map<string, string>()

  for (const page of pages) {
    const segments = segmentsFor(page.folder_id)
    const dirKey = segments.join('/')
    const used = usedPerDir.get(dirKey) ?? new Set<string>()
    usedPerDir.set(dirKey, used)

    const base = safeFileName(page.title)
    let name = base
    let counter = 2
    while (used.has(name.toLowerCase())) name = `${base} (${counter++})`
    used.add(name.toLowerCase())

    paths.set(page.id, [...segments, `${name}.md`].join('/'))
  }

  return paths
}

// ============================================================
// File contents
// ============================================================

/** Quote a value as a YAML double-quoted scalar. JSON escaping is a valid subset. */
function yamlString(value: string): string {
  return JSON.stringify(value ?? '')
}

function renderPage(page: Page, relPath: string, typeName: string): string {
  const front = [
    '---',
    `id: ${yamlString(page.id)}`,
    `title: ${yamlString(page.title || 'Untitled')}`,
    `type: ${yamlString(typeName)}`,
    `created: ${yamlString(page.created_at)}`,
    `updated: ${yamlString(page.updated_at)}`
  ]

  const tags = repo.getTagsForPage(page.id)
  if (tags.length > 0) {
    front.push(`tags: [${tags.map((t) => yamlString(t.name)).join(', ')}]`)
  }

  // A typed page's properties are the structured half of the note; an
  // assistant reading the folder should see them without opening the app.
  // Ordered by the type's own property order rather than however SQLite
  // returns the rows: it is what reordering in the panel is for, and it keeps
  // the file byte-identical between syncs so an unchanged page is never
  // rewritten.
  const order = new Map(repo.getPropertyDefinitions(page.type_id).map((d, i) => [d.key, i]))
  const ordered = [...repo.getPropertiesForPage(page.id)].sort(
    (a, b) => (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER)
  )

  for (const prop of ordered) {
    // A relation stores the target's id. Writing that into the frontmatter
    // gives a reader a uuid to resolve by hand; the wiki-link form is what the
    // body already uses for the same reference, so relations mirror the same
    // way. A target deleted for good leaves nothing worth writing.
    if (prop.type === 'relation') {
      const target = prop.value_relation ? repo.getPageById(prop.value_relation) : null
      if (target) front.push(`${prop.key}: ${yamlString(`[[${target.title || 'Untitled'}]]`)}`)
      continue
    }

    const value =
      prop.value_text ??
      (prop.value_number !== null ? String(prop.value_number) : null) ??
      prop.value_date
    if (value === null || value === undefined || value === '') continue
    front.push(`${prop.key}: ${yamlString(String(value))}`)
  }

  front.push(`path: ${yamlString(relPath)}`)
  front.push('---', '')

  // Relative to this page's own file, not to the mirror root: a page nested
  // two folders deep needs `../../_files/…`, and a reader that resolves links
  // relative to the document — every Markdown viewer — would otherwise look
  // for the picture in the wrong directory.
  const up = '../'.repeat(relPath.split('/').length - 1)
  return (
    front.join('\n') + '\n' + exportPageMarkdown(page.id, (name) => `${up}${FILES_DIRNAME}/${name}`)
  )
}

/**
 * A flat table of contents at the root. Pointing an assistant at the folder is
 * the main reason the mirror exists, and one file listing everything saves it
 * from having to crawl the tree first.
 *
 * Deliberately carries no generation timestamp: that would make this file
 * differ on every sync, so an otherwise-unchanged vault would churn its mtime
 * every couple of seconds while typing. The last sync time is in settings.
 */
function renderIndex(pages: PageLocation[], paths: Map<string, string>): string {
  const lines = [
    '# Nexus vault index',
    '',
    `${pages.length} page(s).`,
    'Written by Nexus. Edits to this file are overwritten on the next sync.',
    ''
  ]
  const ordered = [...pages].sort((a, b) =>
    (paths.get(a.id) ?? '').localeCompare(paths.get(b.id) ?? '')
  )
  for (const page of ordered) {
    const relPath = paths.get(page.id)
    if (!relPath) continue
    lines.push(`- [${page.title || 'Untitled'}](${encodeURI(relPath)})`)
  }
  return lines.join('\n') + '\n'
}

// ============================================================
// Sync
// ============================================================

/** Remove now-empty directories from `startDir` upwards, stopping at the root. */
function pruneEmptyDirs(root: string, startDir: string): void {
  const resolvedRoot = resolve(root)
  let current = resolve(startDir)

  while (current !== resolvedRoot && current.startsWith(resolvedRoot + sep)) {
    try {
      if (readdirSync(current).length > 0) return
      rmdirSync(current)
    } catch {
      return // Not empty, already gone, or not ours to remove.
    }
    current = dirname(current)
  }
}

/**
 * Write the vault out to disk.
 *
 * `only` names the pages known to have changed; omitting it re-renders
 * everything. The distinction is the difference between a keystroke costing a
 * couple of milliseconds and costing a pass over the whole vault — rendering
 * one page means four queries and a markdown build, and doing that for every
 * page every 1.5s blocks the main process, which is also the process serving
 * autosave.
 *
 * Paths are always recomputed for every page regardless, because they are not
 * independent: one page's title decides whether another needs a "(2)" suffix.
 * That is cheap — three columns, no document blobs — and it means a page whose
 * *path* moved is rewritten even when the page itself was never marked.
 */
export function syncNow(only?: string[]): MirrorResult {
  const { enabled, folder } = getConfig()
  if (!enabled || !folder) return { written: 0, deleted: 0, unchanged: 0, total: 0 }

  const root = resolve(folder)
  mkdirSync(root, { recursive: true })

  const locations = repo.getPageLocations()
  const paths = computePaths(locations, repo.getFolders())
  const previous = repo.getMirrorManifest()
  const typeNames = new Map(repo.getTypes().map((t) => [t.id, t.name]))

  const desired = new Map<string, string>(paths)
  desired.set(INDEX_KEY, INDEX_FILENAME)

  // Which pages need their file written.
  const dirty = new Set<string>()
  if (only) {
    for (const id of only) if (paths.has(id)) dirty.add(id)
    // A page that moved has to be written at its new path even if nothing
    // about the page itself changed, and one the manifest has never seen has
    // no file on disk yet.
    for (const [id, relPath] of paths) if (previous.get(id) !== relPath) dirty.add(id)
  } else {
    for (const id of paths.keys()) dirty.add(id)
  }

  // Attachment copies live in the same manifest as pages, under keys a UUID
  // cannot produce. On a full pass this is rebuilt from what the documents
  // actually reference; on a scoped one the previous set is carried forward
  // untouched, because the pages that were not re-read might still be using
  // any of it. So a picture removed from a note is copied until the next full
  // pass — wasted bytes for a while, never a missing image.
  const desiredFiles = new Map<string, string>()
  if (only) {
    for (const [key, relPath] of previous) {
      if (key.startsWith(FILE_KEY_PREFIX)) desiredFiles.set(key, relPath)
    }
  }

  let written = 0
  // Every page not in `dirty` is one this sync deliberately left alone.
  let unchanged = paths.size - dirty.size

  const writeIfChanged = (relPath: string, contents: string): void => {
    const absolute = assertInsideRoot(root, join(root, relPath))
    // Comparing first avoids touching mtimes on every keystroke-triggered
    // sync, which matters if the folder is under git or a file watcher.
    if (existsSync(absolute)) {
      try {
        if (readFileSync(absolute, 'utf-8') === contents) {
          unchanged++
          return
        }
      } catch {
        // Unreadable — fall through and overwrite.
      }
    }
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, contents, 'utf-8')
    written++
  }

  const dataDir = getDataDir()
  // Copy an attachment beside the notes, once. Content-addressed, so a file
  // already there is byte-identical by construction and there is nothing to
  // compare — unlike a page, whose contents change under a stable name.
  const copyAttachment = (name: string): void => {
    const relPath = `${FILES_DIRNAME}/${name}`
    desiredFiles.set(`${FILE_KEY_PREFIX}${name}`, relPath)

    const source = attachmentPath(dataDir, name)
    if (!source || !existsSync(source)) return // Reclaimed, or never stored.
    try {
      const absolute = assertInsideRoot(root, join(root, relPath))
      if (existsSync(absolute)) return
      mkdirSync(dirname(absolute), { recursive: true })
      copyFileSync(source, absolute)
      written++
    } catch {
      // One unreadable attachment is not a reason to abandon the sync.
    }
  }

  for (const pageId of dirty) {
    const relPath = paths.get(pageId)
    if (!relPath) continue
    // Only now is the document blob worth reading.
    const page = repo.getPageById(pageId)
    if (!page) continue
    writeIfChanged(relPath, renderPage(page, relPath, typeNames.get(page.type_id) ?? 'Note'))
    for (const name of extractAttachmentNames(parseDocument(page.content))) copyAttachment(name)
  }

  // The index names every page and its path, so any title or path change
  // rewrites it. Rendering it costs nothing beyond what is already in hand.
  writeIfChanged(INDEX_FILENAME, renderIndex(locations, paths))

  // Remove files this mirror previously wrote that are no longer wanted —
  // pages deleted, renamed, or moved elsewhere in the tree.
  for (const [key, relPath] of desiredFiles) desired.set(key, relPath)

  const desiredPaths = new Set(desired.values())
  let deleted = 0

  for (const [pageId, oldRelPath] of previous) {
    if (desired.get(pageId) === oldRelPath) continue
    if (desiredPaths.has(oldRelPath)) continue // Now owned by another page.
    try {
      const absolute = assertInsideRoot(root, join(root, oldRelPath))
      if (existsSync(absolute)) {
        unlinkSync(absolute)
        deleted++
      }
      pruneEmptyDirs(root, dirname(absolute))
    } catch {
      // A path outside the root, or an unlink race — skip this one rather
      // than aborting the whole sync.
    }
  }

  repo.replaceMirrorManifest(desired)
  repo.setSetting(SETTING_LAST_SYNC, new Date().toISOString())

  return { written, deleted, unchanged, total: paths.size }
}

// ============================================================
// Debounced scheduling
// ============================================================

let timer: ReturnType<typeof setTimeout> | null = null

/** Pages changed since the last sync. A full pass is requested with `null`. */
let pendingPages: Set<string> | null = new Set()

function markPending(pageId?: string): void {
  if (pendingPages === null) return // Already going to rewrite everything.
  if (pageId) pendingPages.add(pageId)
  else pendingPages = null
}

/**
 * Request a sync soon. `pageId` names the one page a mutation touched; leaving
 * it off asks for a full pass, which is what anything cross-cutting needs —
 * renaming a type or a tag changes the frontmatter of every page carrying it,
 * and none of those pages is itself modified.
 *
 * The debounce collapses the burst of content saves during typing into one
 * pass, and the pending set collapses *which* pages that pass has to touch.
 */
export function scheduleSync(pageId?: string): void {
  if (!getConfig().enabled) return
  markPending(pageId)
  if (timer) clearTimeout(timer)
  timer = setTimeout(runPending, DEBOUNCE_MS)
}

function runPending(): void {
  timer = null
  const scope = pendingPages
  pendingPages = new Set()
  try {
    syncNow(scope === null ? undefined : [...scope])
  } catch (err) {
    console.error('[nexus] vault mirror sync failed:', err)
    // The pages that failed are no longer in the pending set, so anything less
    // than a full pass next time would leave them stale forever.
    pendingPages = null
  }
}

/** Run any pending sync immediately, so quitting never drops a pending write. */
export function flushPending(): void {
  if (!timer) return
  clearTimeout(timer)
  runPending()
}
