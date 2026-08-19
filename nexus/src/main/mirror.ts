/**
 * Vault mirror — writes the database out as a plain Markdown tree on disk.
 *
 * The mirror is deliberately ONE-WAY (database to disk). Two-way sync is a hard
 * problem and is not needed for what this exists to do: give any assistant, any
 * editor, and any backup tool direct access to the vault as ordinary files.
 *
 * Safety contract, in order of importance:
 *   1. Every path written is verified to resolve inside the chosen root.
 *   2. Only files recorded in the `mirror_files` manifest are ever deleted, so
 *      a file the user put in the folder themselves is never touched.
 *   3. Directories are removed only when already empty.
 */
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, readdirSync,
} from 'fs'
import { dirname, join, resolve, sep } from 'path'
import * as db from './database'
import { blocksToMarkdown } from './md-convert'
import type { Page } from '../shared/types'

const SETTING_ENABLED = 'mirror.enabled'
const SETTING_FOLDER = 'mirror.folder'
const SETTING_LAST_SYNC = 'mirror.lastSyncAt'

/** Manifest key for the generated index. The space keeps it out of UUID space. */
const INDEX_KEY = ' index'
const INDEX_FILENAME = '_nexus-index.md'

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
    enabled: db.getSetting(SETTING_ENABLED) === '1',
    folder: db.getSetting(SETTING_FOLDER),
    lastSyncAt: db.getSetting(SETTING_LAST_SYNC),
  }
}

export function setFolder(folder: string | null): MirrorConfig {
  db.setSetting(SETTING_FOLDER, folder)
  // Choosing a folder is the act of turning the mirror on; clearing it turns
  // the mirror off rather than leaving it enabled with nowhere to write.
  db.setSetting(SETTING_ENABLED, folder ? '1' : '0')
  return getConfig()
}

export function setEnabled(enabled: boolean): MirrorConfig {
  if (enabled && !db.getSetting(SETTING_FOLDER)) {
    throw new Error('Choose a folder for the vault mirror first')
  }
  db.setSetting(SETTING_ENABLED, enabled ? '1' : '0')
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
 * Turn a page title into one path segment.
 *
 * Unlike `slugifyFilename` (used by export, which lowercases and hyphenates),
 * this keeps the title readable — the whole point of the mirror is that a human
 * or an assistant can browse the folder and recognise what they are looking at.
 */
export function safeFileName(title: string): string {
  let name = (title || 'Untitled')
    .replace(ILLEGAL_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Leading dots hide the file; trailing dots and spaces are silently
    // stripped by Windows, which would change the name out from under the
    // manifest and orphan the file. Spaces are stripped alongside dots at
    // both ends so a title like "../../etc" cannot leave a leading space.
    .replace(/^[. ]+/, '')
    .replace(/[. ]+$/, '')

  if (!name) name = 'Untitled'
  if (RESERVED_NAMES.test(name)) name = `${name}_`

  // Leave room for a disambiguating suffix and the .md extension.
  if (name.length > 120) name = name.slice(0, 120).trimEnd()
  return name || 'Untitled'
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
 * Compute the relative path for every page, mirroring the sidebar tree as
 * directories. A page with children gets both a file and a sibling folder
 * holding them — the layout Notion and Obsidian exports both use.
 */
export function computePaths(pages: Page[]): Map<string, string> {
  const byId = new Map(pages.map((p) => [p.id, p]))
  const childrenOf = new Map<string | null, Page[]>()

  for (const page of pages) {
    const parentId =
      page.parent_page_id && byId.has(page.parent_page_id) ? page.parent_page_id : null
    const bucket = childrenOf.get(parentId)
    if (bucket) bucket.push(page)
    else childrenOf.set(parentId, [page])
  }

  const paths = new Map<string, string>()

  const walk = (parentId: string | null, dirSegments: string[]): void => {
    const siblings = childrenOf.get(parentId) ?? []
    // Names must be unique per directory, and stable: siblings arrive in the
    // database's tree order, so a page keeps the same suffix from run to run.
    // Compared case-insensitively because macOS and Windows filesystems are.
    const used = new Set<string>()

    for (const page of siblings) {
      const base = safeFileName(page.title)
      let name = base
      let counter = 2
      while (used.has(name.toLowerCase())) {
        name = `${base} (${counter++})`
      }
      used.add(name.toLowerCase())

      paths.set(page.id, [...dirSegments, `${name}.md`].join('/'))

      if ((childrenOf.get(page.id) ?? []).length > 0) {
        walk(page.id, [...dirSegments, name])
      }
    }
  }

  walk(null, [])
  return paths
}

// ============================================================
// File contents
// ============================================================

/** Quote a value as a YAML double-quoted scalar. JSON escaping is a valid subset. */
function yamlString(value: string): string {
  return JSON.stringify(value ?? '')
}

function renderPage(page: Page, relPath: string): string {
  const front = [
    '---',
    `id: ${yamlString(page.id)}`,
    `title: ${yamlString(page.title || 'Untitled')}`,
    `type: ${yamlString(page.type_id)}`,
    `created: ${yamlString(page.created_at)}`,
    `updated: ${yamlString(page.updated_at)}`,
    `favorite: ${page.is_favorite ? 'true' : 'false'}`,
  ]
  if (page.parent_page_id) front.push(`parent: ${yamlString(page.parent_page_id)}`)
  if (page.icon) front.push(`icon: ${yamlString(page.icon)}`)
  front.push(`path: ${yamlString(relPath)}`)
  front.push('---', '')

  const blocks = db.getBlocksByPageId(page.id)
  return front.join('\n') + '\n' + blocksToMarkdown(blocks, page.title || 'Untitled')
}

/**
 * A flat table of contents at the root. Pointing an assistant at the folder is
 * the main reason the mirror exists, and one file listing everything saves it
 * from having to crawl the tree first.
 */
function renderIndex(pages: Page[], paths: Map<string, string>): string {
  // Deliberately no generation timestamp: it would make this file differ on
  // every sync, so an otherwise-unchanged vault would still churn its mtime
  // every couple of seconds while typing. The last sync time lives in
  // settings and is shown in the status bar instead.
  const lines = [
    '# Nexus vault index',
    '',
    `${pages.length} page(s).`,
    'Written by Nexus. Edits to this file are overwritten on the next sync.',
    '',
  ]
  const ordered = [...pages].sort((a, b) =>
    (paths.get(a.id) ?? '').localeCompare(paths.get(b.id) ?? ''),
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

export function syncNow(): MirrorResult {
  const { enabled, folder } = getConfig()
  if (!enabled || !folder) {
    return { written: 0, deleted: 0, unchanged: 0, total: 0 }
  }

  const root = resolve(folder)
  mkdirSync(root, { recursive: true })

  const pages = db.getAllPages()
  const paths = computePaths(pages)

  const desired = new Map<string, string>(paths)
  desired.set(INDEX_KEY, INDEX_FILENAME)

  let written = 0
  let unchanged = 0

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

  for (const page of pages) {
    const relPath = paths.get(page.id)
    if (!relPath) continue
    writeIfChanged(relPath, renderPage(page, relPath))
  }
  writeIfChanged(INDEX_FILENAME, renderIndex(pages, paths))

  // Remove files this mirror previously wrote that are no longer wanted —
  // pages deleted, renamed, or moved elsewhere in the tree.
  const previous = db.getMirrorManifest()
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

  db.replaceMirrorManifest(desired)
  db.setSetting(SETTING_LAST_SYNC, new Date().toISOString())

  return { written, deleted, unchanged, total: pages.length }
}

// ============================================================
// Debounced scheduling
// ============================================================

let timer: ReturnType<typeof setTimeout> | null = null

/**
 * Request a sync soon. Called after every mutation; the debounce collapses the
 * burst of block saves during typing into a single pass over the vault.
 */
export function scheduleSync(): void {
  if (!getConfig().enabled) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    try {
      syncNow()
    } catch (err) {
      console.error('[nexus] vault mirror sync failed:', err)
    }
  }, DEBOUNCE_MS)
}

/** Run any pending sync immediately, so quitting never drops a pending write. */
export function flushPending(): void {
  if (!timer) return
  clearTimeout(timer)
  timer = null
  try {
    syncNow()
  } catch (err) {
    console.error('[nexus] vault mirror flush failed:', err)
  }
}
