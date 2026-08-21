import { v4 as uuidv4 } from 'uuid'
import * as repo from './repo'
import { parseDocument } from '../shared/document'
import { ATTACHMENT_URL_PREFIX, attachmentName } from '../shared/attachments'
import type { Page } from '../shared/types'

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
  return JSON.stringify(
    { title: page.title, icon: page.icon, content: JSON.parse(page.content || '[]') },
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
export function importMarkdown(content: string, filename: string): Page {
  const lines = content.split('\n')
  const titleLine = lines.find((l) => l.startsWith('# '))
  const title = titleLine ? titleLine.slice(2).trim() : filename.replace(/\.md$/, '')

  const blocks: BlockNoteBlock[] = []
  let fence: string[] | null = null

  for (const raw of lines) {
    if (raw === titleLine) continue
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
