/**
 * Markdown <-> Nexus Block conversion utilities.
 * Used by the import/export system in the main process.
 */
import { marked } from 'marked'
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

export function markdownToBlocks(md: string, pageId: string): ImportResult {
  const tokens = marked.lexer(md)
  const blocks: Block[] = []
  let title = ''
  let sortOrder = 0
  const wikiLinks: string[] = []

  // Extract [[wiki-links]] from text
  const extractWikiLinks = (text: string): string => {
    const regex = /\[\[([^\]]+)\]\]/g
    let match
    while ((match = regex.exec(text)) !== null) {
      if (!wikiLinks.includes(match[1])) {
        wikiLinks.push(match[1])
      }
    }
    return text
  }

  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const headingText = extractWikiLinks(token.text)
        if (token.depth === 1 && !title) {
          title = headingText
        } else {
          blocks.push(createBlock('heading', headingText, { level: token.depth }, sortOrder++, pageId))
        }
        break
      }

      case 'paragraph': {
        const text = extractWikiLinks(token.text)
        // Check for image placeholders
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

      case 'code': {
        blocks.push(createBlock('codeBlock', token.text, { language: token.lang || '' }, sortOrder++, pageId))
        break
      }

      case 'blockquote': {
        const text = extractWikiLinks(token.text || '')
        blocks.push(createBlock('quote', text, {}, sortOrder++, pageId))
        break
      }

      case 'hr': {
        blocks.push(createBlock('divider', '', {}, sortOrder++, pageId))
        break
      }

      case 'html': {
        // Best-effort: <details>/<summary> → toggle
        const detailsMatch = token.text.match(/<summary>(.*?)<\/summary>/s)
        if (detailsMatch) {
          blocks.push(createBlock('toggle', detailsMatch[1], {}, sortOrder++, pageId))
        } else {
          blocks.push(createBlock('paragraph', token.text, {}, sortOrder++, pageId))
        }
        break
      }

      case 'table': {
        // Convert to paragraph with pipe-separated text (simplified)
        if (token.header && token.rows) {
          const headerRow = token.header.map((h: { text: string }) => h.text).join(' | ')
          blocks.push(createBlock('paragraph', `| ${headerRow} |`, {}, sortOrder++, pageId))
          for (const row of token.rows) {
            const rowText = row.map((c: { text: string }) => c.text).join(' | ')
            blocks.push(createBlock('paragraph', `| ${rowText} |`, {}, sortOrder++, pageId))
          }
        }
        break
      }

      case 'space':
        break

      default: {
        if ('text' in token && token.text) {
          const text = extractWikiLinks(token.text as string)
          blocks.push(createBlock('paragraph', text, {}, sortOrder++, pageId))
        }
        break
      }
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
