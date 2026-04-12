// ============================================================
// Core domain types — shared between main and renderer
// ============================================================

// Numeric pixel width for page content (0 = full / unconstrained).
// Legacy string presets are converted on read: narrow→640, default→720, wide→900, full→0.
export type PageWidth = number

export interface Page {
  id: string
  type_id: string
  title: string
  icon: string | null
  cover: string | null
  page_width: PageWidth
  is_archived: number
  is_deleted: number
  created_at: string
  updated_at: string
}

export interface Block {
  id: string
  page_id: string
  parent_block_id: string | null
  block_type: BlockType
  content: string | null // JSON string of editor content
  sort_order: number
  created_at: string
  updated_at: string
}

// Free-text in the DB (SQLite CHECK allows any string), but we enumerate the
// shapes the renderer actually produces. BlockNote's own type names live
// alongside our legacy names so we stay source-of-truth for both.
export type BlockType =
  // Legacy names from Phase 01
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'numberedList'
  | 'checkList'
  | 'toggle'
  | 'code'
  | 'image'
  | 'file'
  | 'embed'
  | 'divider'
  | 'callout'
  | 'table'
  | 'quote'
  // BlockNote v0.24 canonical type names (Phase 02)
  | 'heading'
  | 'bulletListItem'
  | 'numberedListItem'
  | 'checkListItem'
  | 'codeBlock'
  | 'columnList'
  | 'column'

export interface NexusType {
  id: string
  name: string
  icon: string | null
  created_at: string
  updated_at: string
}

export interface PropertyDefinition {
  id: string
  type_id: string
  name: string
  property_type: PropertyType
  config: string | null
  sort_order: number
  created_at: string
}

export type PropertyType =
  | 'text'
  | 'number'
  | 'date'
  | 'boolean'
  | 'select'
  | 'multi_select'
  | 'relation'
  | 'url'
  | 'file'

export interface PropertyValue {
  id: string
  page_id: string
  property_def_id: string
  value_text: string | null
  value_number: number | null
  value_date: string | null
  value_boolean: number | null
  value_json: string | null
}

export interface Link {
  id: string
  source_page_id: string
  target_page_id: string
  context: string | null
  created_at: string
}

export interface BacklinkResult {
  sourcePageId: string
  sourcePageTitle: string
  sourcePageIcon: string | null
  context: string | null
}

export interface LinkTarget {
  targetPageId: string
  context: string | null
}

// ============================================================
// IPC API contract
// ============================================================

export interface NexusAPI {
  pages: {
    create(): Promise<Page>
    getAll(): Promise<Page[]>
    getById(id: string): Promise<Page | null>
    update(id: string, data: Partial<Pick<Page, 'title' | 'icon' | 'cover' | 'is_archived' | 'page_width'>>): Promise<void>
    softDelete(id: string): Promise<void>
    restore(id: string): Promise<void>
    hardDelete(id: string): Promise<void>
    getDeleted(): Promise<Page[]>
    duplicate(id: string): Promise<Page>
  }
  blocks: {
    getByPageId(pageId: string): Promise<Block[]>
    save(pageId: string, blocks: Block[]): Promise<void>
  }
  links: {
    getBacklinks(pageId: string): Promise<BacklinkResult[]>
    syncLinks(pageId: string, linkTargets: LinkTarget[]): Promise<void>
  }
  io: {
    exportPageMarkdown(pageId: string): Promise<string>
    exportPageJSON(pageId: string): Promise<string>
    exportAllMarkdown(): Promise<{ filename: string; content: string }[]>
    exportAllJSON(): Promise<string>
    importMarkdown(content: string, filename: string): Promise<Page>
    importJSON(content: string): Promise<Page | { imported: number }>
    importPlainText(content: string, filename: string): Promise<Page>
  }
  dialog: {
    showSaveDialog(options: {
      title?: string
      defaultPath?: string
      filters?: { name: string; extensions: string[] }[]
    }): Promise<string | null>
    showOpenDialog(options: {
      title?: string
      filters?: { name: string; extensions: string[] }[]
      properties?: string[]
    }): Promise<string[] | null>
    showSelectFolder(): Promise<string | null>
  }
}

// ============================================================
// Command palette
// ============================================================

export interface Command {
  id: string
  label: string
  shortcut?: string
  section?: string
  icon?: string
  action: () => void
}
