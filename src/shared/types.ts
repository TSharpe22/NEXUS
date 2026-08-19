export type PageWidth = number

export interface Page {
  id: string
  type_id: string
  title: string
  icon: string | null
  content: string // JSON string of the BlockNote document
  page_width: PageWidth
  /** Folder this page lives in. null = root of the tree. */
  folder_id: string | null
  is_deleted: number
  created_at: string
  updated_at: string
}

/**
 * A search hit. Matched terms inside `titleMarked` and `bodySnippet` are
 * wrapped in the control characters below — never interpolate these as HTML;
 * split on them instead (see `SearchHighlight`).
 */
export const SEARCH_MARK_OPEN = '\u0002'
export const SEARCH_MARK_CLOSE = '\u0003'

export interface SearchResult {
  page: Page
  /** Page title with matched terms wrapped in the sentinels above. */
  titleMarked: string
  /** Body excerpt around the match, or null when only the title matched. */
  bodySnippet: string | null
}

/** A node in the Notes list tree. A page belongs to at most one folder. */
export interface Folder {
  id: string
  name: string
  parent_folder_id: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

/**
 * Tags are first-class rather than a `multi_select` property: properties are
 * defined per type, and tagging shouldn't require schema setup first.
 */
export interface Tag {
  id: string
  name: string
  color: string
  created_at: string
}

export interface TagWithCount extends Tag {
  page_count: number
}

export type PropertyType = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multi_select' | 'relation' | 'url'

export interface Property {
  id: string
  page_id: string
  key: string
  type: PropertyType
  value_text: string | null
  value_number: number | null
  value_date: string | null
  value_relation: string | null
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

export interface ActivityLogEntry {
  id: string
  page_id: string | null
  event_type: string
  message: string
  created_at: string
}

export interface StorageStats {
  pageCount: number
  dbSizeBytes: number
  withPropertiesPercent: number
}

export interface TypeDef {
  id: string
  name: string
  icon: string | null
}

export interface PropertyDefinition {
  id: string
  type_id: string
  key: string
  name: string
  property_type: PropertyType
  sort_order: number
}

export interface PageSummary extends Page {
  properties: Property[]
}

export interface GraphPreview {
  nodeCount: number
  edgeCount: number
}

export interface GraphNode {
  id: string
  title: string
  type_id: string
  updated_at: string
  /** Total links touching this page, in either direction. Drives node size. */
  degree: number
}

export interface GraphEdge {
  source: string
  target: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ============================================================
// IPC API contract
// ============================================================

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

export interface NexusAPI {
  /**
   * One-way export of the vault to a Markdown tree on disk, so any assistant,
   * editor or backup tool can read it as ordinary files.
   */
  journal: {
    /** Today's journal entry, created from the Journal template if absent. */
    today(): Promise<Page>
  }
  mirror: {
    getConfig(): Promise<MirrorConfig>
    /** Passing a folder also enables the mirror; passing null disables it. */
    setFolder(folder: string | null): Promise<MirrorConfig>
    setEnabled(enabled: boolean): Promise<MirrorConfig>
    syncNow(): Promise<MirrorResult>
  }
  search: {
    /** Full-text search over page titles and body content. */
    pages(query: string, limit?: number): Promise<SearchResult[]>
    /** Rebuild the index from scratch. Returns the number of pages indexed. */
    rebuildIndex(): Promise<number>
  }
  pages: {
    create(typeId?: string): Promise<Page>
    getAll(): Promise<Page[]>
    getAllSummary(typeId?: string): Promise<PageSummary[]>
    getById(id: string): Promise<Page | null>
    update(
      id: string,
      data: Partial<Pick<Page, 'title' | 'icon' | 'content' | 'page_width' | 'type_id'>>
    ): Promise<void>
    /** Move a page into a folder, or to the root when folderId is null. */
    move(id: string, folderId: string | null): Promise<void>
    setType(pageId: string, typeId: string): Promise<void>
    softDelete(id: string): Promise<void>
    restore(id: string): Promise<void>
    hardDelete(id: string): Promise<void>
    emptyTrash(): Promise<number>
    getDeleted(): Promise<Page[]>
    duplicate(id: string): Promise<Page>
  }
  folders: {
    list(): Promise<Folder[]>
    create(name: string, parentFolderId: string | null): Promise<Folder>
    rename(id: string, name: string): Promise<void>
    /** Reparent a folder. Rejects a move that would create a cycle. */
    move(id: string, parentFolderId: string | null): Promise<void>
    /** Delete the folder; its pages and subfolders move up to its parent. */
    remove(id: string): Promise<void>
  }
  tags: {
    list(): Promise<TagWithCount[]>
    getForPage(pageId: string): Promise<Tag[]>
    /** Attach a tag by name, creating it when it doesn't exist yet. */
    addToPage(pageId: string, name: string): Promise<Tag>
    removeFromPage(pageId: string, tagId: string): Promise<void>
    rename(id: string, name: string): Promise<void>
    remove(id: string): Promise<void>
    setColor(id: string, color: string): Promise<void>
    /** Ids of pages carrying at least one of the given tags. */
    pageIdsFor(tagIds: string[]): Promise<string[]>
  }
  properties: {
    getForPage(pageId: string): Promise<Property[]>
    /** Resolves with the row as stored, so the caller needn't guess the column. */
    set(
      pageId: string,
      key: string,
      type: PropertyType,
      value: string | number | null
    ): Promise<Property>
    /** Distinct values already recorded for this property key. */
    knownValues(key: string): Promise<string[]>
    remove(pageId: string, key: string): Promise<void>
  }
  types: {
    /** Point a type at the page its new pages start from, or null to clear. */
    setTemplate(typeId: string, pageId: string | null): Promise<void>
    getTemplate(typeId: string): Promise<Page | null>
    list(): Promise<TypeDef[]>
    create(name: string, icon?: string): Promise<TypeDef>
    rename(id: string, name: string): Promise<TypeDef>
    remove(id: string): Promise<{ reassigned: number }>
    getPropertyDefinitions(typeId: string): Promise<PropertyDefinition[]>
    defineProperty(typeId: string, name: string, propertyType: PropertyType): Promise<PropertyDefinition>
    renameProperty(definitionId: string, name: string): Promise<PropertyDefinition>
    removeProperty(definitionId: string): Promise<void>
    /** Rewrites `sort_order` to match the given order of definition ids. */
    reorderProperties(typeId: string, orderedIds: string[]): Promise<void>
  }
  links: {
    getBacklinks(pageId: string): Promise<BacklinkResult[]>
    syncLinks(pageId: string, linkTargets: LinkTarget[]): Promise<void>
    searchPages(query: string, excludePageId?: string): Promise<Page[]>
  }
  activity: {
    getRecent(limit?: number): Promise<ActivityLogEntry[]>
  }
  stats: {
    getStorage(): Promise<StorageStats>
    getGraphPreview(): Promise<GraphPreview>
    getGraph(): Promise<GraphData>
    getDataDir(): Promise<string>
  }
  io: {
    exportPageMarkdown(pageId: string): Promise<string>
    exportPageJSON(pageId: string): Promise<string>
    exportAllMarkdown(): Promise<{ filename: string; content: string }[]>
    importMarkdown(content: string, filename: string): Promise<Page>
    importJSON(content: string): Promise<Page | { imported: number }>
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
