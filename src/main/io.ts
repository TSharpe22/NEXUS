import * as repo from './repo'
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
    .map((node) => (typeof node === 'object' && node && 'text' in node ? String((node as { text: unknown }).text) : ''))
    .join('')
}

function blockToMarkdownLines(block: BlockNoteBlock, depth = 0): string[] {
  const indent = '  '.repeat(depth)
  const text = inlineToText(block.content)
  const lines: string[] = []

  switch (block.type) {
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
    lines.push(...blockToMarkdownLines(child, depth + 1))
  }

  return lines
}

/** Best-effort markdown export. Lossy for callouts/toggles/tables — documented, not this round's concern. */
export function exportPageMarkdown(pageId: string): string {
  const page = repo.getPageById(pageId)
  if (!page) throw new Error(`Page not found: ${pageId}`)

  const blocks: BlockNoteBlock[] = JSON.parse(page.content || '[]')
  const body = blocks.flatMap((b) => blockToMarkdownLines(b)).join('\n\n')
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
  return repo.getAllPages().map((page) => ({
    filename: `${(page.title || 'untitled').replace(/[/\\?%*:|"<>]/g, '-')}.md`,
    content: exportPageMarkdown(page.id)
  }))
}

/** Naive markdown import: title = first H1, everything else becomes paragraphs. */
export function importMarkdown(content: string, filename: string): Page {
  const lines = content.split('\n')
  const titleLine = lines.find((l) => l.startsWith('# '))
  const title = titleLine ? titleLine.slice(2).trim() : filename.replace(/\.md$/, '')
  const bodyLines = lines.filter((l) => l !== titleLine && l.trim().length > 0)

  const blocks = bodyLines.map((line) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: line, styles: {} }]
  }))

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
