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
  /** Pinned to Home. Unlike every other projection on a page, nothing can re-derive this. */
  is_pinned: number
  /** When the pin was made, which is what orders Home's list. null when unpinned. */
  pinned_at: string | null
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

/**
 * One checkbox block, as the tracker sees it.
 *
 * A projection of a block inside `pages.content` — never the only copy of
 * anything, and never edited directly: ticking one writes back into the
 * document it came from.
 */
export interface TrackerTask {
  pageId: string
  blockId: string
  text: string
  isDone: boolean
  /** The date this counts against: the block's own `@date`, else its page's. */
  dueDate: string | null
  /** Which of the two supplied `dueDate`, or null when it has neither. */
  dueDateSource: 'block' | 'page' | null
  completedAt: string | null
  pageTitle: string
  pageIcon: string | null
}

/** A page placed on the calendar by a `date` property of its own. */
export interface DatedPage {
  pageId: string
  pageTitle: string
  pageIcon: string | null
  typeName: string | null
  /** Which date property put it here — a type can define more than one. */
  propertyKey: string
  date: string
}

/**
 * A type that can be read as a habit: one carrying both a date property and a
 * checkbox property. There is no Habit table and no habit type in the
 * codebase — a habit is those two properties on a type the user made.
 */
export interface HabitCandidate {
  typeId: string
  typeName: string
  dateKeys: string[]
  booleanKeys: string[]
}

/** One day of a habit's year. */
export interface HabitDay {
  date: string
  done: boolean
  /** The page recording that day, so a cell in the grid can open it. */
  pageId: string
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
  /** The text around a mention. Always null for a relation. */
  context: string | null
  /** Which of the two ways one page can point at another produced this. */
  source: 'mention' | 'relation'
  /** The property a relation came from. Always null for a mention. */
  propertyKey: string | null
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
  /** Unticked checkbox blocks across every live page. */
  openTaskCount: number
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

/**
 * Just enough of a page to decide where its mirror file goes. The mirror
 * recomputes every path on every sync, and pulling whole `Page` rows for that
 * meant dragging every content blob out of SQLite to read three columns.
 */
export interface BackupInfo {
  folder: string
  count: number
  /** Path of the newest snapshot, or null when none has been taken yet. */
  latest: string | null
  /** Every snapshot on disk, newest first. */
  all: string[]
}

export interface PageLocation {
  id: string
  title: string
  folder_id: string | null
}

/**
 * A page without its document body.
 *
 * The body is by far the largest column, and almost nothing outside the editor
 * reads it — the sidebar, the command palette, Tables and Home all want a
 * title, a type and a folder. Shipping every page's whole document to the
 * renderer on every mutation is what made small actions feel chunky.
 */
export type PageListItem = Omit<Page, 'content'>

/**
 * Where a captured line lands. `page` is the default — a thought worth typing
 * is worth a page, and a page can be typed, tagged and linked afterwards,
 * which a line inside a journal entry cannot.
 */
export type CaptureTarget = 'page' | 'journal' | 'task' | 'inbox'

/** The handful of things that are settings rather than data. */
export interface Preferences {
  /** Hour 0–23 at which a new day begins. See `shared/day.ts`. */
  dayStartHour: number
  /** Heading in the journal entry that captured tasks are filed under. */
  taskSection: string
}

export interface PageSummary extends PageListItem {
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

/** One file in the attachment store, as the renderer sees it. */
export interface StoredAttachment {
  /** `<sha256>.<ext>` — the name on disk and in the URL. */
  name: string
  /** `nexus-file://vault/<name>`, which is what goes into the document. */
  url: string
  size: number
  /** True when these exact bytes were already stored, so nothing was written. */
  deduplicated: boolean
}

/** What Settings shows about the attachment store. */
export interface AttachmentStats {
  folder: string
  count: number
  bytes: number
  unreferencedCount: number
  unreferencedBytes: number
}

export interface NexusAPI {
  /**
   * One-way export of the vault to a Markdown tree on disk, so any assistant,
   * editor or backup tool can read it as ordinary files.
   */
  lifecycle: {
    /**
     * Run `handler` when the main process is about to close this window, and
     * hold the window open until whatever it returns has settled.
     *
     * This is what keeps an edit typed inside the 600ms autosave debounce from
     * dying on quit: the pending write is issued and *waited for* while the
     * database is still open. Returns an unsubscribe function.
     */
    onFlushRequest(handler: () => void | Promise<unknown>): () => void
  }
  journal: {
    /** Today's journal entry, created from the Journal template if absent. */
    today(): Promise<Page>
    /**
     * Today's entry if it exists, without creating it or the Journal type.
     * Home reads this: showing the entry must not be what makes it.
     */
    peek(): Promise<Page | null>
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
    /** Every live page without its body — what the sidebar and palette read. */
    list(): Promise<PageListItem[]>
    listDeleted(): Promise<PageListItem[]>
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
    /**
     * Pin a page to Home, or unpin it. There is no matching read: `list()`
     * already carries `is_pinned` and `pinned_at`.
     */
    setPinned(id: string, pinned: boolean): Promise<void>
  }
  capture: {
    /**
     * Capture one line from Home. Resolves with the page it landed on — the
     * new page itself for 'page', the inbox for 'inbox', today's journal entry
     * for the rest.
     */
    line(text: string, target: CaptureTarget): Promise<Page>
  }
  prefs: {
    get(): Promise<Preferences>
    /**
     * The hour a day rolls over, 0–23. Decides which entry "today" opens, when
     * a task is overdue, and which row the tracker marks. Resolves with the
     * value as stored, clamped.
     */
    setDayStartHour(hour: number): Promise<number>
    /** The heading captured tasks are filed under in the journal entry. */
    setTaskSection(name: string): Promise<string>
  }
  inbox: {
    /** The inbox page if it exists, without making one. */
    get(): Promise<Page | null>
    /** The inbox page, made on first use. */
    open(): Promise<Page>
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
    /**
     * No `syncLinks` here on purpose: the link graph is projected in the main
     * process from `repo.updatePage`, so there is no way for a renderer to
     * write a version of it that disagrees with the document.
     */
    searchPages(query: string, excludePageId?: string): Promise<Page[]>
  }
  habits: {
    /** Types carrying both a date and a checkbox property. */
    candidates(): Promise<HabitCandidate[]>
    days(
      typeId: string,
      dateKey: string,
      booleanKey: string,
      from: string,
      to: string
    ): Promise<HabitDay[]>
  }
  tasks: {
    /** Tasks dated inside [from, to], both bounds inclusive, as YYYY-MM-DD. */
    inRange(from: string, to: string): Promise<TrackerTask[]>
    /** Open tasks dated before `before`, which is exclusive. */
    overdue(before: string): Promise<TrackerTask[]>
    /** Open tasks with no date on the block or its page. */
    undated(limit?: number): Promise<TrackerTask[]>
    forPage(pageId: string): Promise<TrackerTask[]>
    /** Pages placed in the window by a date property of their own. */
    datedPages(from: string, to: string): Promise<DatedPage[]>
    /**
     * Tick a task off. Writes back into the block, and returns the page as
     * stored so the caller can refresh the copy the editor remounts from.
     */
    setDone(pageId: string, blockId: string, done: boolean): Promise<Page>
    /**
     * Move a task to a date, or to null to clear its own date and hand it back
     * to its page's. Resolves with the page as stored — the write goes into
     * the block, so the caller has to refresh the copy the editor remounts
     * from.
     */
    setDue(pageId: string, blockId: string, due: string | null): Promise<Page>
  }
  activity: {
    getRecent(limit?: number): Promise<ActivityLogEntry[]>
  }
  stats: {
    getStorage(): Promise<StorageStats>
    getGraphPreview(): Promise<GraphPreview>
    getGraph(): Promise<GraphData>
    getDataDir(): Promise<string>
    getBackups(): Promise<BackupInfo>
    /**
     * Put a snapshot back and reload onto it. The vault being replaced is kept
     * alongside the database as `nexus.db.pre-restore-<timestamp>`, so this is
     * destructive but not one-way. Resolves with that path just before the
     * window reloads.
     */
    restoreBackup(snapshotPath: string): Promise<{ keptAt: string | null }>
  }
  shell: {
    /** Resolves to null on success, or a message describing why it did not open. */
    openPath(target: string): Promise<string | null>
  }
  files: {
    /**
     * Store bytes pasted or dropped into a page, and resolve with the URL the
     * document should carry. The same bytes stored twice give the same URL and
     * write nothing the second time.
     */
    store(bytes: Uint8Array, originalName: string): Promise<StoredAttachment>
    /** What the store holds, and how much of it nothing points at any more. */
    stats(): Promise<AttachmentStats>
    /** Delete every attachment no page refers to. Only ever on request. */
    reclaim(): Promise<{ deleted: number; bytes: number }>
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
