import { v4 as uuidv4 } from 'uuid'
import * as repo from './repo'
import { parseDocument } from '../shared/document'
import { ATTACHMENT_URL_PREFIX, attachmentName } from '../shared/attachments'
import type { Page, PropertyType } from '../shared/types'

interface BlockNoteBlock {
  id?: string
  type: string
  props?: Record<string, unknown>
  content?: unknown
  children?: BlockNoteBlock[]
}

function inlineToText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((node) => {
      if (typeof node !== 'object' || !node) return ''
      // A page mention carries its label in props, not as `text` — without
      // this branch every [[link]] vanished from exported markdown.
      const n = node as { type?: string; text?: unknown; props?: { pageTitle?: unknown } }
      if (n.type === 'pageMention') {
        const label = String(n.props?.pageTitle ?? '').trim()
        return label ? `[[${label}]]` : ''
      }
      return 'text' in n ? String(n.text) : ''
    })
    .join('')
}

/**
 * Where a Markdown reader should look for an attachment.
 *
 * The mirror hands in a path relative to the page's own file, because the
 * folder it writes is meant to be readable on its own. Nothing passed means
 * the `nexus-file://` URL is written verbatim: it names the file
 * unambiguously, so the reference survives even where the bytes do not
 * travel with it.
 */
export type AttachmentHref = (name: string) => string

/** `![caption](href)` for an image, a plain link for anything else. */
function attachmentLines(block: BlockNoteBlock, href: AttachmentHref): string[] {
  const url = typeof block.props?.url === 'string' ? block.props.url : ''
  if (!url) return []

  const name = attachmentName(url)
  const target = name ? href(name) : url
  const caption =
    String(block.props?.caption ?? '').trim() ||
    String(block.props?.name ?? '').trim() ||
    (block.type === 'image' ? 'image' : block.type)

  // Spaces in a Markdown target break the link; a stored name cannot contain
  // one, but a pasted web URL can.
  const safeTarget = target.includes(' ') ? `<${target}>` : target
  return [`${block.type === 'image' ? '!' : ''}[${caption}](${safeTarget})`]
}

function blockToMarkdownLines(
  block: BlockNoteBlock,
  depth = 0,
  href: AttachmentHref = (name) => `${ATTACHMENT_URL_PREFIX}${name}`
): string[] {
  const indent = '  '.repeat(depth)
  const text = inlineToText(block.content)
  const lines: string[] = []

  switch (block.type) {
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
      lines.push(...attachmentLines(block, href))
      break
    case 'heading': {
      const level = (block.props?.level as number) ?? 1
      lines.push(`${'#'.repeat(level)} ${text}`)
      break
    }
    case 'bulletListItem':
      lines.push(`${indent}- ${text}`)
      break
    case 'numberedListItem':
      lines.push(`${indent}1. ${text}`)
      break
    case 'checkListItem': {
      const checked = block.props?.checked ? 'x' : ' '
      lines.push(`${indent}- [${checked}] ${text}`)
      break
    }
    case 'quote':
      lines.push(`> ${text}`)
      break
    case 'codeBlock':
      lines.push('```', text, '```')
      break
    default:
      lines.push(text)
  }

  for (const child of block.children ?? []) {
    lines.push(...blockToMarkdownLines(child, depth + 1, href))
  }

  return lines
}

/** Best-effort markdown export. Lossy for callouts/toggles/tables — documented, not this round's concern. */
export function exportPageMarkdown(pageId: string, href?: AttachmentHref): string {
  const page = repo.getPageById(pageId)
  if (!page) throw new Error(`Page not found: ${pageId}`)

  // `parseDocument` rather than a bare JSON.parse: one unparseable body used
  // to throw and take the whole vault's export down with it. Every other
  // reader of a document already tolerates this.
  const blocks = parseDocument(page.content) as BlockNoteBlock[]
  const body = blocks.flatMap((b) => blockToMarkdownLines(b, 0, href)).join('\n\n')
  return `# ${page.title || 'Untitled'}\n\n${body}\n`
}

export function exportPageJSON(pageId: string): string {
  const page = repo.getPageById(pageId)
  if (!page) throw new Error(`Page not found: ${pageId}`)
  // `parseDocument` rather than a bare JSON.parse, for the same reason the
  // markdown export uses it: one unparseable body threw and took the export of
  // that page down with it, when an empty document is a better answer than no
  // file at all.
  return JSON.stringify(
    { title: page.title, icon: page.icon, content: parseDocument(page.content) },
    null,
    2
  )
}

export function exportAllMarkdown(): { filename: string; content: string }[] {
  // Two pages sharing a title used to produce one filename, and the writer
  // overwrites — so exporting a vault with two "Untitled" pages silently wrote
  // one file and reported both. Disambiguated the way the mirror does it, by
  // whichever page is seen first.
  const used = new Set<string>()

  return repo.getAllPages().map((page) => {
    const base = (page.title || 'untitled').replace(/[/\\?%*:|"<>]/g, '-').trim() || 'untitled'
    let filename = `${base}.md`
    for (let n = 2; used.has(filename.toLowerCase()); n++) {
      filename = `${base} (${n}).md`
    }
    used.add(filename.toLowerCase())
    return { filename, content: exportPageMarkdown(page.id) }
  })
}

/**
 * One block, in the shape the projections read.
 *
 * The `id` is not decoration. `extractTasks` skips any block without one, so
 * an imported checkbox with no id is a task that never reaches the tracker or
 * Home — invisible until the page is opened and re-saved through the editor,
 * which is exactly the sort of silence this codebase keeps paying for.
 */
function importedBlock(
  type: string,
  text: string,
  props: Record<string, unknown> = {}
): BlockNoteBlock {
  return {
    id: uuidv4(),
    type,
    props,
    content: text ? [{ type: 'text', text, styles: {} }] : [],
    children: []
  }
}

/**
 * Markdown import. Title is the first H1 (or the filename), and the body is
 * parsed into the block types the editor actually has.
 *
 * This used to map every line to a paragraph, which meant a heading arrived as
 * the literal text `## Heading` and a checkbox as `- [ ] thing` — so a Nexus
 * export did not survive being imported back, and neither did anything written
 * in another editor. It is still deliberately a *subset*: what round-trips is
 * what `blockToMarkdownLines` writes. Callouts, toggles and tables have no
 * markdown spelling here and come back as prose, the same lossiness the mirror
 * documents on the way out.
 */
/**
 * The frontmatter block at the top of a file, if there is one.
 *
 * A deliberately small YAML reader: flat `key: value` pairs, double-quoted
 * strings, flow lists, and bare scalars. That is exactly the subset
 * `mirror.ts` writes, and reading more than is written would be pretending to
 * support documents this cannot round-trip. Anything it does not understand
 * is left in `rest` as body text rather than dropped.
 */
function splitFrontmatter(content: string): { front: Map<string, string>; rest: string } {
  const front = new Map<string, string>()
  if (!/^---\r?\n/.test(content)) return { front, rest: content }

  const lines = content.split('\n')
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  // An opening fence with no closing one is not frontmatter, it is a document
  // that happens to start with a rule.
  if (end === -1) return { front, rest: content }

  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    front.set(match[1], match[2].trim())
  }
  return { front, rest: lines.slice(end + 1).join('\n') }
}

/** A double-quoted YAML scalar back to its text. Bare scalars pass through. */
function yamlScalar(raw: string): string {
  if (raw.startsWith('"')) {
    try {
      return String(JSON.parse(raw))
    } catch {
      return raw.slice(1, -1)
    }
  }
  return raw
}

/** A flow list — `[a, "b c"]` — as its members, or null when it is not one. */
function yamlList(raw: string): string[] | null {
  if (!raw.startsWith('[') || !raw.endsWith(']')) return null
  const inner = raw.slice(1, -1).trim()
  if (!inner) return []
  // Split on commas that are not inside quotes. Good enough for what the
  // mirror writes, which never nests.
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === '"' && inner[i - 1] !== '\\') quoted = !quoted
    if (c === ',' && !quoted) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += c
  }
  parts.push(current.trim())
  return parts.filter(Boolean).map(yamlScalar)
}

/**
 * What kind of property a frontmatter value is, when nothing has said.
 *
 * Only consulted for a key the page's type has no definition for. A type that
 * already knows `pnl` is a number is believed over anything this could work
 * out from the text — the declared schema is the answer, and guessing over the
 * top of it is how "42" typed deliberately as text becomes a number on the way
 * back in.
 */
function inferPropertyType(raw: string): { type: PropertyType; value: string } {
  const list = yamlList(raw)
  if (list) return { type: 'multi_select', value: JSON.stringify(list) }

  const text = yamlScalar(raw)
  // A quoted value was written as a string and comes back as one, whatever it
  // looks like. This is the half of the round trip that makes the mirror's
  // quoting meaningful.
  if (raw.startsWith('"')) {
    return /^\[\[.*\]\]$/.test(text) ? { type: 'relation', value: text } : { type: 'text', value: text }
  }
  if (text === 'true' || text === 'false') return { type: 'boolean', value: text }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { type: 'date', value: text }
  if (text !== '' && Number.isFinite(Number(text))) return { type: 'number', value: text }
  return { type: 'text', value: text }
}

/** Keys that identify a file rather than describe a page. Never imported. */
const IDENTITY_KEYS = new Set(['id', 'path', 'created', 'updated'])

/**
 * Put a page's frontmatter back onto it: its type, its tags, its properties.
 *
 * This did not exist, and its absence was the quiet hole in the whole
 * local-first promise. The mirror wrote type, tags, every property and
 * relations resolved to `[[Title]]`; `importMarkdown` read `# title` and the
 * body and threw the rest away. So a vault could be exported and read by
 * anything, and could not be brought back — the escape hatch only opened one
 * way, which is a weaker guarantee than it looked like from inside the app.
 */
function applyFrontmatter(pageId: string, front: Map<string, string>): void {
  const typeName = front.has('type') ? yamlScalar(front.get('type')!) : null
  if (typeName) {
    const existing = repo.getTypes().find((t) => t.name === typeName)
    const type = existing ?? repo.createType(typeName)
    repo.setPageType(pageId, type.id)
  }

  const tags = front.has('tags') ? yamlList(front.get('tags')!) : null
  for (const name of tags ?? []) repo.addTagToPage(pageId, name)

  const page = repo.getPageById(pageId)
  if (!page) return
  const defined = new Map(repo.getPropertyDefinitions(page.type_id).map((d) => [d.key, d]))

  for (const [key, raw] of front) {
    if (IDENTITY_KEYS.has(key) || key === 'title' || key === 'type' || key === 'tags') continue

    const definition = defined.get(key)
    const guess = inferPropertyType(raw)
    const type = definition?.property_type ?? guess.type
    // Declared type wins; the value still has to be re-read under it, since a
    // key the schema calls text may have been written bare.
    const value = definition ? valueFor(type, raw) : guess.value
    if (value === null) continue

    // A relation is written as `[[Title]]` and has to resolve to an id again.
    // A target that is not in this vault is not an error — the mirror is a
    // folder somebody may have copied a single file out of — so the reference
    // is kept as text rather than silently dropped.
    if (type === 'relation') {
      const target = relationTarget(value)
      if (target) repo.setProperty(pageId, key, 'relation', target)
      else repo.setProperty(pageId, key, 'text', value)
      continue
    }

    if (!definition) repo.defineProperty(page.type_id, key, type)
    repo.setProperty(pageId, key, type, type === 'number' ? Number(value) : value)
  }
}

/** One frontmatter value read under a type the schema already declared. */
function valueFor(type: PropertyType, raw: string): string | null {
  if (type === 'multi_select') {
    const list = yamlList(raw)
    return list ? JSON.stringify(list) : JSON.stringify([yamlScalar(raw)])
  }
  const text = yamlScalar(raw)
  if (text === '') return null
  if (type === 'number' && !Number.isFinite(Number(text))) return null
  return text
}

/** The page a `[[Title]]` names, by title, or null when nothing here matches. */
function relationTarget(value: string): string | null {
  const match = /^\[\[(.*)\]\]$/.exec(value)
  if (!match) return null
  const title = match[1].trim()
  return repo.getPageList().find((p) => p.title === title)?.id ?? null
}

export function importMarkdown(content: string, filename: string): Page {
  const { front, rest } = splitFrontmatter(content)
  const lines = rest.split('\n')
  // By position, not by value. Skipping every line equal to the title dropped
  // any line in the body that repeated it — a note whose H1 is "Notes" lost
  // each "# Notes" heading further down, silently, on the way in.
  const titleIndex = lines.findIndex((l) => l.startsWith('# '))
  // Frontmatter wins over the H1, which wins over the filename. A mirrored
  // file carries both and they agree; a file edited outside Nexus may have
  // been retitled in only one of them, and the structured half is the one that
  // was written on purpose.
  const title =
    (front.has('title') ? yamlScalar(front.get('title')!) : '') ||
    (titleIndex >= 0 ? lines[titleIndex].slice(2).trim() : filename.replace(/\.md$/, ''))

  const blocks: BlockNoteBlock[] = []
  let fence: string[] | null = null

  for (let i = 0; i < lines.length; i++) {
    if (i === titleIndex) continue
    const raw = lines[i]
    const line = raw.replace(/\s+$/, '')

    // A fenced code block runs until its closing fence; blank lines and
    // anything that looks like markup inside it are content, not markup.
    if (line.trim().startsWith('```')) {
      if (fence === null) fence = []
      else {
        blocks.push(importedBlock('codeBlock', fence.join('\n')))
        fence = null
      }
      continue
    }
    if (fence !== null) {
      fence.push(raw)
      continue
    }

    if (!line.trim()) continue

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      // BlockNote's heading spec tops out at 3; deeper markdown headings land
      // there rather than being dropped.
      blocks.push(importedBlock('heading', heading[2].trim(), { level: Math.min(heading[1].length, 3) }))
      continue
    }

    const checkbox = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line)
    if (checkbox) {
      blocks.push(importedBlock('checkListItem', checkbox[2].trim(), { checked: checkbox[1] !== ' ' }))
      continue
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      blocks.push(importedBlock('bulletListItem', bullet[1].trim()))
      continue
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      blocks.push(importedBlock('numberedListItem', numbered[1].trim()))
      continue
    }

    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      blocks.push(importedBlock('quote', quote[1].trim()))
      continue
    }

    blocks.push(importedBlock('paragraph', line.trim()))
  }

  // An unterminated fence is still text somebody wrote; keep it.
  if (fence !== null && fence.length) blocks.push(importedBlock('codeBlock', fence.join('\n')))

  const page = repo.createPage()
  repo.updatePage(page.id, { title, content: JSON.stringify(blocks) })
  applyFrontmatter(page.id, front)
  return repo.getPageById(page.id)!
}

export function importJSON(content: string): Page {
  const parsed = JSON.parse(content) as { title?: string; icon?: string; content?: unknown }
  const page = repo.createPage()
  repo.updatePage(page.id, {
    title: parsed.title ?? 'Untitled',
    icon: parsed.icon ?? null,
    content: JSON.stringify(parsed.content ?? [])
  })
  return repo.getPageById(page.id)!
}
