/**
 * Import / Export logic — runs in the main (Node) process.
 */
import { v4 as uuidv4 } from 'uuid'
import type { Page, Block } from '../shared/types'
import * as db from './database'
import { blocksToMarkdown, markdownToBlocks, slugifyFilename } from './md-convert'

const now = () => new Date().toISOString().replace('T', ' ').split('.')[0]

// ============================================================
// Export
// ============================================================

export function exportPageMarkdown(pageId: string): string {
  const page = db.getPageById(pageId)
  if (!page) throw new Error(`Page not found: ${pageId}`)
  const blocks = db.getBlocksByPageId(pageId)
  return blocksToMarkdown(blocks, page.title)
}

export function exportPageJSON(pageId: string): string {
  const page = db.getPageById(pageId)
  if (!page) throw new Error(`Page not found: ${pageId}`)
  const blocks = db.getBlocksByPageId(pageId)
  const backlinks = db.getBacklinks(pageId)

  const data = {
    nexus_version: '1.0',
    exported_at: new Date().toISOString(),
    page: {
      id: page.id,
      title: page.title,
      icon: page.icon,
      type_id: page.type_id,
      page_width: page.page_width,
      created_at: page.created_at,
      updated_at: page.updated_at,
    },
    blocks: blocks.map((b) => ({
      id: b.id,
      block_type: b.block_type,
      content: b.content ? JSON.parse(b.content) : null,
      sort_order: b.sort_order,
      parent_block_id: b.parent_block_id,
    })),
    links: backlinks.map((bl) => ({
      target_page_id: bl.sourcePageId, // Note: these are pages linking TO this page
      target_page_title: bl.sourcePageTitle,
      context: bl.context,
    })),
  }

  return JSON.stringify(data, null, 2)
}

export function exportAllMarkdown(): { filename: string; content: string }[] {
  const pages = db.getAllPages()
  const usedFilenames = new Set<string>()
  const results: { filename: string; content: string }[] = []

  for (const page of pages) {
    const blocks = db.getBlocksByPageId(page.id)
    const md = blocksToMarkdown(blocks, page.title)
    let slug = slugifyFilename(page.title)

    // Handle duplicate filenames
    let filename = `${slug}.md`
    let counter = 1
    while (usedFilenames.has(filename)) {
      filename = `${slug}-${counter}.md`
      counter++
    }
    usedFilenames.add(filename)

    results.push({ filename, content: md })
  }

  return results
}

export function exportAllJSON(): string {
  const pages = db.getAllPages()
  const allBlocks: Block[] = []
  const allLinks: unknown[] = []

  for (const page of pages) {
    const blocks = db.getBlocksByPageId(page.id)
    allBlocks.push(...blocks)
  }

  const data = {
    nexus_version: '1.0',
    exported_at: new Date().toISOString(),
    types: [{ id: 'note', name: 'Note', icon: '\u{1F4DD}' }],
    pages: pages.map((p) => ({ ...p })),
    blocks: allBlocks.map((b) => ({
      id: b.id,
      page_id: b.page_id,
      block_type: b.block_type,
      content: b.content ? JSON.parse(b.content) : null,
      sort_order: b.sort_order,
      parent_block_id: b.parent_block_id,
    })),
    links: allLinks,
    property_definitions: [],
    property_values: [],
  }

  return JSON.stringify(data, null, 2)
}

// ============================================================
// Import
// ============================================================

export function importMarkdown(content: string, filename: string): Page {
  const tempId = uuidv4()
  const result = markdownToBlocks(content, tempId)

  // Create page
  const page = db.createPage()
  const title = result.title || filename.replace(/\.md$/i, '').replace(/\.txt$/i, '')
  db.updatePage(page.id, { title })

  // Remap block page_ids to the actual new page
  const blocks = result.blocks.map((b) => ({ ...b, page_id: page.id }))
  if (blocks.length > 0) {
    db.saveBlocks(page.id, blocks)
  }

  // Resolve wiki-links: find existing pages or create new ones
  if (result.wikiLinks.length > 0) {
    const linkTargets = result.wikiLinks.map((linkTitle) => {
      const existing = db.searchPagesForLink(linkTitle).find(
        (p) => p.title.toLowerCase() === linkTitle.toLowerCase(),
      )
      if (existing) {
        return { targetPageId: existing.id, context: null }
      }
      // Create stub page
      const stub = db.createPage()
      db.updatePage(stub.id, { title: linkTitle })
      return { targetPageId: stub.id, context: null }
    })
    db.syncLinks(page.id, linkTargets)
  }

  return db.getPageById(page.id)!
}

export function importPlainText(content: string, filename: string): Page {
  const page = db.createPage()
  const title = filename.replace(/\.txt$/i, '').replace(/\.md$/i, '')
  db.updatePage(page.id, { title })

  const block: Block = {
    id: uuidv4(),
    page_id: page.id,
    parent_block_id: null,
    block_type: 'paragraph',
    content: JSON.stringify({
      id: uuidv4(),
      type: 'paragraph',
      props: {},
      content: [{ type: 'text', text: content, styles: {} }],
      children: [],
    }),
    sort_order: 0,
    created_at: '',
    updated_at: '',
  }

  db.saveBlocks(page.id, [block])
  return db.getPageById(page.id)!
}

export function importJSON(content: string): Page | { imported: number } {
  const data = JSON.parse(content)

  // Single-page JSON
  if (data.page && data.blocks) {
    const page = db.createPage()
    const title = data.page.title || 'Imported'
    db.updatePage(page.id, { title, icon: data.page.icon || null })

    if (data.page.page_width) {
      db.updatePage(page.id, { page_width: data.page.page_width })
    }

    const blocks: Block[] = data.blocks.map((b: any, index: number) => ({
      id: uuidv4(),
      page_id: page.id,
      parent_block_id: null,
      block_type: b.block_type || 'paragraph',
      content: JSON.stringify(b.content || b),
      sort_order: b.sort_order ?? index,
      created_at: '',
      updated_at: '',
    }))

    if (blocks.length > 0) {
      db.saveBlocks(page.id, blocks)
    }

    return db.getPageById(page.id)!
  }

  // Full database JSON
  if (data.pages && Array.isArray(data.pages)) {
    let imported = 0

    for (const pageData of data.pages) {
      const page = db.createPage()
      db.updatePage(page.id, {
        title: pageData.title || '',
        icon: pageData.icon || null,
      })

      const pageBlocks = (data.blocks || [])
        .filter((b: any) => b.page_id === pageData.id)
        .map((b: any, index: number) => ({
          id: uuidv4(),
          page_id: page.id,
          parent_block_id: null,
          block_type: b.block_type || 'paragraph',
          content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content || b),
          sort_order: b.sort_order ?? index,
          created_at: '',
          updated_at: '',
        }))

      if (pageBlocks.length > 0) {
        db.saveBlocks(page.id, pageBlocks)
      }

      imported++
    }

    return { imported }
  }

  throw new Error('Unrecognized JSON format')
}
