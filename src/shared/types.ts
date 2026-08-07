export type PageWidth = number

export interface Page {
  id: string
  type_id: string
  title: string
  icon: string | null
  content: string // JSON string of the BlockNote document
  page_width: PageWidth
  is_deleted: number
  created_at: string
  updated_at: string
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
  center: Page | null
  neighbors: Page[]
}

// ============================================================
// IPC API contract
// ============================================================

export interface NexusAPI {
  pages: {
    create(typeId?: string): Promise<Page>
    getAll(): Promise<Page[]>
    getAllSummary(typeId?: string): Promise<PageSummary[]>
    getById(id: string): Promise<Page | null>
    update(
      id: string,
      data: Partial<Pick<Page, 'title' | 'icon' | 'content' | 'page_width'>>
    ): Promise<void>
    softDelete(id: string): Promise<void>
    restore(id: string): Promise<void>
    hardDelete(id: string): Promise<void>
    getDeleted(): Promise<Page[]>
    duplicate(id: string): Promise<Page>
  }
  properties: {
    getForPage(pageId: string): Promise<Property[]>
    set(
      pageId: string,
      key: string,
      type: PropertyType,
      value: string | number | null
    ): Promise<void>
    remove(pageId: string, key: string): Promise<void>
  }
  types: {
    list(): Promise<TypeDef[]>
    create(name: string, icon?: string): Promise<TypeDef>
    getPropertyDefinitions(typeId: string): Promise<PropertyDefinition[]>
    defineProperty(typeId: string, name: string, propertyType: PropertyType): Promise<PropertyDefinition>
  }
  links: {
    getBacklinks(pageId: string): Promise<BacklinkResult[]>
    syncLinks(pageId: string, linkTargets: LinkTarget[]): Promise<void>
    searchPages(query: string): Promise<Page[]>
  }
  activity: {
    getRecent(limit?: number): Promise<ActivityLogEntry[]>
  }
  stats: {
    getStorage(): Promise<StorageStats>
    getGraphPreview(): Promise<GraphPreview>
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
