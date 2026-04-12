/**
 * Markdown <-> Nexus Block conversion utilities.
 * Used by the import/export system in the main process.
 */
import { v4 as uuidv4 } from 'uuid'
import type { Block } from '../shared/types'

// ============================================================
// Export: Blocks → Markdown
// ============================================================

interface InlineNode {
  type: string
  text?: string
  content?: InlineNode[] | string
  styles?: Record<string, string | boolean>
  props?: Record<string, string>
}

interface BlockContent {
  type: string
  id?: string
  props?: Record<string, unknown>
  content?: InlineNode[] | string
  children?: BlockContent[]
}

function inlineToMarkdown(content: InlineNode[] | string | undefined): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((node) => {
      if (typeof node === 'string') return node

      // pageMention → [[Page Title]]
      if (node.type === 'pageMention') {
        return `[[${node.props?.pageTitle || ''}]]`
      }

      // Link
      if (node.type === 'link') {
        const text = inlineToMarkdown(node.content)
        const href = node.props?.href || ''
        return `[${text}](${href})`
      }

      // Styled text
      let text = node.text || inlineToMarkdown(node.content)
      const styles = node.styles || {}
      if (styles.bold) text = `**${text}**`
      if (styles.italic) text = `*${text}*`
      if (styles.strikethrough) text = `~~${text}~~`
      if (styles.code) text = `\`${text}\``
      if (styles.underline) text = `<u>${text}</u>`
      return text
    })
    .join('')
}

function blockToMarkdown(block: BlockContent, indent = ''): string {
  const type = block.type
  const props = block.props || {}
  const text = inlineToMarkdown(block.content)

  switch (type) {
    case 'paragraph':
      return `${indent}${text}`

    case 'heading': {
      const level = (props.level as number) || 1
      return `${indent}${'#'.repeat(level)} ${text}`
    }

    case 'bulletListItem': {
      const childMd = (block.children || [])
        .map((c) => blockToMarkdown(c, indent + '  '))
        .join('\n')
      return `${indent}- ${text}${childMd ? '\n' + childMd : ''}`
    }

    case 'numberedListItem': {
      const childMd = (block.children || [])
        .map((c) => blockToMarkdown(c, indent + '   '))
        .join('\n')
      return `${indent}1. ${text}${childMd ? '\n' + childMd : ''}`
    }

    case 'checkListItem': {
      const checked = props.checked ? 'x' : ' '
      return `${indent}- [${checked}] ${text}`
    }

    case 'codeBlock': {
      const lang = (props.language as string) || ''
      return `${indent}\`\`\`${lang}\n${text}\n${indent}\`\`\``
    }

    case 'quote':
      return `${indent}> ${text}`

    case 'divider':
      return `${indent}---`

    case 'callout': {
      const icon = (props.icon as string) || ''
      return `${indent}> **${icon}** ${text}`
    }

    case 'toggle': {
      const childMd = (block.children || [])
        .map((c) => blockToMarkdown(c, ''))
        .join('\n\n')
      return `${indent}<details><summary>${text}</summary>\n\n${childMd}\n\n</details>`
    }

    case 'table': {
      // Table blocks have a special structure in BlockNote
      const tableContent = props.content as { rows?: { cells?: string[][] }[] } | undefined
      if (!tableContent?.rows?.length) return text
      // Simplified — just output text
      return `${indent}${text}`
    }

    case 'columnList':
    case 'column':
      // Flatten columns to sequential blocks
      return (block.children || [])
        .map((c) => blockToMarkdown(c, indent))
        .join('\n\n')

    default:
      return `${indent}${text}`
  }
}

export function blocksToMarkdown(blocks: Block[], title: string): string {
  const lines: string[] = []

  if (title) {
    lines.push(`# ${title}`)
    lines.push('')
  }

  for (const block of blocks) {
    try {
      const parsed: BlockContent = block.content ? JSON.parse(block.content) : { type: 'paragraph' }
      const md = blockToMarkdown(parsed)
      lines.push(md)
      lines.push('')
    } catch {
      // Skip unparseable blocks
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

// ============================================================
// Import: Markdown → Blocks
// ============================================================

function createBlock(
  type: string,
  content: string,
  props: Record<string, unknown> = {},
  sortOrder: number,
  pageId: string,
): Block {
  const blockContent: BlockContent = {
    id: uuidv4(),
    type,
    props,
    content: content ? [{ type: 'text', text: content, styles: {} }] : [],
    children: [],
  }
  return {
    id: blockContent.id!,
    page_id: pageId,
    parent_block_id: null,
    block_type: type as Block['block_type'],
    content: JSON.stringify(blockContent),
    sort_order: sortOrder,
    created_at: '',
    updated_at: '',
  }
}

export interface ImportResult {
  title: string
  blocks: Block[]
  wikiLinks: string[] // page titles referenced via [[...]]
}

// ============================================================
// Minimal synchronous Markdown tokenizer (replaces marked dependency)
// Handles: headings, paragraphs, fenced code, blockquotes, ordered/
// unordered/task lists, horizontal rules, HTML blocks, tables, spaces.
// ============================================================

type MdToken =
  | { type: 'heading'; depth: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; text: string; lang: string }
  | { type: 'blockquote'; text: string }
  | { type: 'hr' }
  | { type: 'space' }
  | { type: 'html'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'list'; ordered: boolean; items: { text: string; task: boolean; checked: boolean }[] }

function lexMarkdown(md: string): MdToken[] {
  const lines = md.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const tokens: MdToken[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Blank line
    if (/^\s*$/.test(line)) { tokens.push({ type: 'space' }); i++; continue }

    // Fenced code block
    const fenceMatch = line.match(/^(`{3,}|~{3,})\s*(\S*)/)
    if (fenceMatch) {
      const fence = fenceMatch[1]; const lang = fenceMatch[2] || ''
      const codeLines: string[] = []; i++
      while (i < lines.length && !lines[i].startsWith(fence)) { codeLines.push(lines[i]); i++ }
      i++ // consume closing fence
      tokens.push({ type: 'code', text: codeLines.join('\n'), lang })
      continue
    }

    // ATX heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/)
    if (headingMatch) {
      tokens.push({ type: 'heading', depth: headingMatch[1].length, text: headingMatch[2].trim() })
      i++; continue
    }

    // Setext heading (=== or ---)
    if (i + 1 < lines.length) {
      const next = lines[i + 1]
      if (/^={2,}\s*$/.test(next)) { tokens.push({ type: 'heading', depth: 1, text: line.trim() }); i += 2; continue }
      if (/^-{2,}\s*$/.test(next) && line.trim()) { tokens.push({ type: 'heading', depth: 2, text: line.trim() }); i += 2; continue }
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) { tokens.push({ type: 'hr' }); i++; continue }

    // Blockquote
    if (/^>/.test(line)) {
      const bqLines: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        bqLines.push(lines[i].replace(/^>\s?/, '')); i++
      }
      tokens.push({ type: 'blockquote', text: bqLines.join('\n') })
      continue
    }

    // HTML block
    if (/^<\w/.test(line)) {
      const htmlLines: string[] = []
      while (i < lines.length && !/^\s*$/.test(lines[i])) { htmlLines.push(lines[i]); i++ }
      tokens.push({ type: 'html', text: htmlLines.join('\n') })
      continue
    }

    // Table (GFM: has |---|)
    if (i + 1 < lines.length && /^\|?[-:| ]+\|[-:| ]*$/.test(lines[i + 1])) {
      const parseCells = (row: string) =>
        row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const header = parseCells(line)
      i += 2 // skip header + separator
      const rows: string[][] = []
      while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
        rows.push(parseCells(lines[i])); i++
      }
      tokens.push({ type: 'table', header, rows })
      continue
    }

    // List
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)/)
    const olMatch = line.match(/^(\s*)(\d+)[.)]\s+(.*)/)
    if (ulMatch || olMatch) {
      const ordered = Boolean(olMatch)
      const indent = (ulMatch || olMatch)![1].length
      const items: { text: string; task: boolean; checked: boolean }[] = []
      const listRe = ordered ? /^\s*\d+[.)]\s+(.*)/ : /^\s*[-*+]\s+(.*)/
      while (i < lines.length) {
        const lm = lines[i].match(listRe)
        if (!lm && /^\s*$/.test(lines[i])) { i++; break }
        if (!lm) break
        let text = lm[1]
        const taskMatch = text.match(/^\[([xX ])\]\s+(.*)/)
        const task = Boolean(taskMatch)
        const checked = task && taskMatch![1].toLowerCase() === 'x'
        if (task) text = taskMatch![2]
        items.push({ text, task, checked }); i++
      }
      tokens.push({ type: 'list', ordered, items })
      continue
    }

    // Paragraph — collect until blank line or block element
    const paraLines: string[] = []
    while (i < lines.length) {
      const l = lines[i]
      if (/^\s*$/.test(l)) break
      if (/^#{1,6}\s/.test(l) || /^[-*_]{3,}\s*$/.test(l) || /^>/.test(l) || /^(`{3,}|~{3,})/.test(l)) break
      if (/^\s*[-*+]\s/.test(l) || /^\s*\d+[.)]\s/.test(l)) break
      paraLines.push(l); i++
    }
    if (paraLines.length) tokens.push({ type: 'paragraph', text: paraLines.join(' ') })
  }

  return tokens
}

export function markdownToBlocks(md: string, pageId: string): ImportResult {
  const tokens = lexMarkdown(md)
  const blocks: Block[] = []
  let title = ''
  let sortOrder = 0
  const wikiLinks: string[] = []

  const extractWikiLinks = (text: string): string => {
    const regex = /\[\[([^\]]+)\]\]/g
    let match
    while ((match = regex.exec(text)) !== null) {
      if (!wikiLinks.includes(match[1])) wikiLinks.push(match[1])
    }
    return text
  }

  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const headingText = extractWikiLinks(token.text)
        if (token.depth === 1 && !title) { title = headingText }
        else { blocks.push(createBlock('heading', headingText, { level: token.depth }, sortOrder++, pageId)) }
        break
      }
      case 'paragraph': {
        const text = extractWikiLinks(token.text)
        if (text.startsWith('![')) {
          const altMatch = text.match(/!\[([^\]]*)\]/)
          blocks.push(createBlock('paragraph', `[Image: ${altMatch?.[1] || 'image'}]`, {}, sortOrder++, pageId))
        } else {
          blocks.push(createBlock('paragraph', text, {}, sortOrder++, pageId))
        }
        break
      }
      case 'list': {
        const listType = token.ordered ? 'numberedListItem' : 'bulletListItem'
        for (const item of token.items) {
          const text = extractWikiLinks(item.text)
          if (item.task) {
            blocks.push(createBlock('checkListItem', text, { checked: item.checked }, sortOrder++, pageId))
          } else {
            blocks.push(createBlock(listType, text, {}, sortOrder++, pageId))
          }
        }
        break
      }
      case 'code':
        blocks.push(createBlock('codeBlock', token.text, { language: token.lang }, sortOrder++, pageId))
        break
      case 'blockquote':
        blocks.push(createBlock('quote', extractWikiLinks(token.text), {}, sortOrder++, pageId))
        break
      case 'hr':
        blocks.push(createBlock('divider', '', {}, sortOrder++, pageId))
        break
      case 'html': {
        const sumMatch = token.text.match(/<summary>(.*?)<\/summary>/s)
        if (sumMatch) blocks.push(createBlock('toggle', sumMatch[1], {}, sortOrder++, pageId))
        else blocks.push(createBlock('paragraph', token.text, {}, sortOrder++, pageId))
        break
      }
      case 'table': {
        blocks.push(createBlock('paragraph', `| ${token.header.join(' | ')} |`, {}, sortOrder++, pageId))
        for (const row of token.rows) {
          blocks.push(createBlock('paragraph', `| ${row.join(' | ')} |`, {}, sortOrder++, pageId))
        }
        break
      }
      case 'space':
        break
    }
  }

  return { title, blocks, wikiLinks }
}

export function slugifyFilename(title: string): string {
  return (title || 'untitled')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'untitled'
}
