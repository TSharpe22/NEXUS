# PHASE 03 — Import / Export + Bidirectional Links + Block Multi-Select

> This spec is the authoritative reference for Phase 03. Read PROJECT.md, PHASE_01.md, and PHASE_02.md first. Do not deviate from decisions made here.

---

## Objective

Make Nexus a connected, portable knowledge base. Phase 03 delivers three features: a complete import/export system for data portability, inline bidirectional links between pages (using the `links` table scaffolded in Phase 01), and a block multi-select system that lets users lasso-select blocks in the editor and apply bulk actions via the existing context menu.

---

## Stack Notes

No changes to the core stack. The editor library chosen in Phase 01/02 continues.

**New dependencies:**

| Package | Purpose | Condition |
|---------|---------|-----------|
| `turndown` | HTML → Markdown conversion for export | Always |
| `marked` or `markdown-it` | Markdown → HTML/blocks for import | Always — evaluate both, prefer whichever produces a cleaner AST for block conversion |
| `file-saver` (or Electron `dialog.showSaveDialog`) | Save dialog for export | Use Electron's native dialog — no extra dependency |

**No new dependencies for bidirectional links or multi-select.** These are pure editor + IPC work.

---

## 1. Bidirectional Links

### 1.1 Creating Links

**Inline mention syntax:** Type `[[` anywhere in a block to open a page search popup.

**Popup behavior:**
- Appears inline at the cursor position (like the slash menu).
- Shows a filterable list of all non-deleted pages, sorted by `updated_at` descending.
- User types to filter by title (case-insensitive substring match).
- Arrow keys to navigate, Enter to select, Escape to dismiss.
- If no match is found, show a "Create new page: [typed text]" option at the bottom. Selecting it creates a new page with that title and inserts the link.
- On selection, the `[[` trigger text is replaced with an inline link node styled as a page mention (see 1.2).

**Implementation:**
- TipTap: Use the `Suggestion` extension (same pattern as slash menu) triggered by `[[`.
- BlockNote: Use its mention/inline-content extension system if available, otherwise implement via TipTap's `Suggestion` directly.
- On link creation: insert a row into the `links` table with `source_page_id` = current page, `target_page_id` = selected page, and `context` = the surrounding sentence or block text (truncated to 200 chars).

### 1.2 Link Display

- Inline link renders as a styled chip/pill: page icon + page title, with `--accent` color text and a subtle `--accent-muted` background on hover.
- Clicking a link navigates to the target page (same as clicking a page in the sidebar).
- `Cmd+Click` / `Ctrl+Click` opens the target page (future: in a new tab when Phase 05 lands — for now, same behavior as regular click).
- If the target page is deleted (in trash), the link renders with a strikethrough style and `--text-tertiary` color. Clicking it does nothing. Tooltip: "This page is in trash."
- If the target page is permanently deleted, the link renders as plain text with `--text-tertiary` color and a tooltip: "This page no longer exists." The `links` row is cleaned up on next save (CASCADE handles the DB side, but the editor content JSON may still reference it — handle gracefully).

### 1.3 Backlinks Panel

Every page shows its **backlinks** — other pages that link to it.

**UI:**
- A collapsible section below the editor content area, separated by a subtle divider.
- Header: "Backlinks (N)" where N is the count. Collapsed by default. Click to expand.
- Each backlink shows: source page icon + title, and the `context` excerpt (the sentence containing the link, with the link text highlighted in `--accent`).
- Clicking a backlink navigates to that source page.
- If a page has no backlinks, the section header reads "Backlinks (0)" and expanding shows "No other pages link here."

**Data:**
- Backlinks are fetched via a query on the `links` table: `SELECT * FROM links WHERE target_page_id = ?`.
- Join with `pages` to get title and icon for display.
- Backlinks update in real-time: when a link is added or removed in another page and saved, the backlinks panel reflects it on next load or via a refresh.

### 1.4 Link Lifecycle

**When a block containing a link is deleted:**
- The link row in the `links` table should be removed. Handle this in the `blocks.save()` flow: diff the set of links in the saved blocks against the existing `links` rows for that page, and delete any orphaned link rows.

**When a page is soft-deleted (trashed):**
- Links pointing to it remain in the DB. The link renders as broken (see 1.2). Restoring the page restores the links visually.

**When a page is hard-deleted:**
- `ON DELETE CASCADE` on the `links` table handles cleanup for both `source_page_id` and `target_page_id`.

### 1.5 IPC Additions

```typescript
interface NexusAPI {
  // ... existing methods ...

  links: {
    getBacklinks(pageId: string): Promise<BacklinkResult[]>;
    syncLinks(pageId: string, linkTargets: LinkTarget[]): Promise<void>;
      // ^ Called during blocks.save(). Receives the full list of link targets
      //   found in the page's blocks. Diffs against existing links rows and
      //   inserts/deletes as needed.
  };
}

interface BacklinkResult {
  sourcePageId: string;
  sourcePageTitle: string;
  sourcePageIcon: string | null;
  context: string | null;
}

interface LinkTarget {
  targetPageId: string;
  context: string | null;  // surrounding text, truncated to 200 chars
}
```

### 1.6 Schema Notes

The `links` table already exists from Phase 01. No schema changes needed. The `UNIQUE(source_page_id, target_page_id)` constraint means a page can link to another page only once in the DB — if the same page is mentioned multiple times in the source, only one link row exists. The `context` column stores the context from the first occurrence.

---

## 2. Import / Export

### 2.1 Export

**Supported formats:**

| Format | Scope | Description |
|--------|-------|-------------|
| Markdown (`.md`) | Single page | Exports one page as a Markdown file. Title becomes `# heading`. Blocks are converted to their Markdown equivalents. |
| Markdown (folder) | All pages | Exports all non-deleted pages as individual `.md` files in a folder. Filenames are slugified titles (e.g. `my-page-title.md`). Duplicate slugs get a numeric suffix. |
| JSON | Single page | Full Nexus JSON: page metadata + blocks array. Round-trippable — importing this JSON recreates the page exactly. |
| JSON (full database) | All data | Exports the entire database: pages, blocks, links, types. This is the backup/migration format. |

**CSV export is deferred** to Phase 10 (Data Views) — it only makes sense when typed objects with properties exist. Not in Phase 03 scope.

**How export is triggered:**
- Right-click a page in the sidebar → "Export" submenu → "Markdown" / "JSON".
- Command palette (`Cmd+K`) → "Export Current Page" → format picker.
- Command palette → "Export All Pages" → format picker.
- All exports use Electron's `dialog.showSaveDialog` (for single files) or `dialog.showOpenDialog` with `properties: ['openDirectory', 'createDirectory']` (for folder export).

**Markdown conversion rules:**

| Block Type | Markdown Output |
|------------|----------------|
| Paragraph | Plain text with inline formatting: `**bold**`, `*italic*`, `~~strikethrough~~`, `` `code` ``, `<u>underline</u>` |
| Heading 1/2/3 | `#` / `##` / `###` |
| Bullet List | `- item` (nested with 2-space indent) |
| Numbered List | `1. item` (nested with 3-space indent) |
| Checklist | `- [ ] unchecked` / `- [x] checked` |
| Quote | `> text` |
| Code Block | ` ```language\ncode\n``` ` |
| Divider | `---` |
| Callout | `> **icon** text` (best-effort — callout metadata is lost) |
| Toggle | `<details><summary>title</summary>\n\ncontent\n\n</details>` |
| Table | Standard Markdown table syntax with `|` pipes and `---` header separator |
| Column Group | Columns are flattened to sequential blocks (column layout is lost — no Markdown equivalent) |
| Bidirectional Link | `[[Page Title]]` — preserved as wiki-link syntax for re-import |

**JSON format (single page):**

```json
{
  "nexus_version": "1.0",
  "exported_at": "2026-04-10T12:00:00Z",
  "page": {
    "id": "uuid",
    "title": "Page Title",
    "icon": "📝",
    "type_id": "note",
    "created_at": "...",
    "updated_at": "..."
  },
  "blocks": [
    {
      "id": "uuid",
      "block_type": "paragraph",
      "content": { /* TipTap/BlockNote JSON */ },
      "sort_order": 1.0,
      "parent_block_id": null
    }
  ],
  "links": [
    {
      "target_page_id": "uuid",
      "target_page_title": "Linked Page Title",
      "context": "...surrounding text..."
    }
  ]
}
```

**JSON format (full database):**

```json
{
  "nexus_version": "1.0",
  "exported_at": "2026-04-10T12:00:00Z",
  "types": [ /* all rows from types table */ ],
  "pages": [ /* all rows from pages table, including deleted */ ],
  "blocks": [ /* all rows from blocks table */ ],
  "links": [ /* all rows from links table */ ],
  "property_definitions": [ /* all rows */ ],
  "property_values": [ /* all rows */ ]
}
```

### 2.2 Import

**Supported formats:**

| Format | Behavior |
|--------|----------|
| Markdown (`.md`) | Creates a new page. First `# heading` becomes the title (or filename if no heading). Markdown is parsed into Nexus block structure. |
| Markdown (folder) | Imports all `.md` files from a selected folder. Each becomes a page. |
| Plain text (`.txt`) | Creates a new page with a single paragraph block containing the text. Title is the filename. |
| JSON (Nexus format) | Creates a new page from a previously exported Nexus JSON file. Preserves block types and structure. Generates new UUIDs for all entities to avoid collisions. |
| JSON (full database) | **Merge import**: adds pages, blocks, links, types from the export into the current database. New UUIDs generated. Duplicate type names are skipped (existing type kept). |

**How import is triggered:**
- Command palette → "Import" → opens file picker (`dialog.showOpenDialog` with appropriate filters).
- Sidebar: a subtle "Import" option in the sidebar header menu or near the "New Page" button.
- Support drag-and-drop of `.md` / `.txt` / `.json` files onto the sidebar to trigger import.

**Markdown parsing rules:**
- Parse Markdown AST and convert to Nexus block structure.
- `# heading` → heading1 block. `## heading` → heading2. `### heading` → heading3.
- Paragraphs → paragraph blocks with inline formatting converted to the editor's mark format.
- Lists → bulletList / numberedList blocks. Nested lists become child blocks.
- `- [ ]` / `- [x]` → checkList blocks.
- Code fences → code blocks (preserve language tag).
- `> quote` → quote blocks.
- `---` → divider blocks.
- `[[Page Title]]` → attempt to resolve to an existing page by title. If found, create a link. If not found, create a new page with that title and link to it.
- Standard Markdown links `[text](url)` → inline link (plain URL, not a page link).
- Images `![alt](path)` → skip in Phase 03 (image blocks come in Phase 04). Insert a placeholder paragraph: "[Image: alt text]".
- Tables → table blocks.
- HTML `<details>/<summary>` → toggle blocks (best-effort).

### 2.3 Import Feedback

- Show a toast on successful import: "Imported N page(s)".
- If any files fail to parse, show a warning toast: "Imported N page(s). M file(s) could not be parsed." Log failures to console with details.
- After import, auto-select the first imported page in the sidebar.

### 2.4 IPC Additions

```typescript
interface NexusAPI {
  // ... existing methods ...

  io: {
    exportPageMarkdown(pageId: string): Promise<string>;
      // ^ Returns Markdown string. Renderer handles save dialog.
    exportPageJSON(pageId: string): Promise<string>;
      // ^ Returns JSON string.
    exportAllMarkdown(): Promise<{ filename: string; content: string }[]>;
      // ^ Returns array of {filename, markdown} pairs. Renderer saves to folder.
    exportAllJSON(): Promise<string>;
      // ^ Returns full database JSON string.
    importMarkdown(content: string, filename: string): Promise<Page>;
      // ^ Parses Markdown, creates page, returns it.
    importJSON(content: string): Promise<Page | { imported: number }>;
      // ^ For single-page JSON: returns Page.
      //   For full-db JSON: returns count of imported entities.
    importPlainText(content: string, filename: string): Promise<Page>;
      // ^ Creates page with single paragraph block.
  };

  dialog: {
    showSaveDialog(options: SaveDialogOptions): Promise<string | null>;
      // ^ Returns selected file path or null if cancelled.
    showOpenDialog(options: OpenDialogOptions): Promise<string[] | null>;
      // ^ Returns selected file paths or null if cancelled.
    showSelectFolder(): Promise<string | null>;
      // ^ Returns selected folder path or null.
  };
}
```

**Note:** File reading/writing happens in the main process. The renderer calls `dialog.showOpenDialog`, gets the path, then calls `io.importMarkdown` etc. The main process reads the file from disk. The renderer never touches `fs` directly.

---

## 3. Block Multi-Select (Lasso Select)

### 3.1 Behavior

**Trigger:** Left-click and drag on empty space in the editor area (not inside a block's text content). A selection rectangle appears. Any blocks that intersect the rectangle become selected.

**Selection rectangle:**
- Translucent accent fill: `rgba(107, 138, 253, 0.10)` (using the `--accent` base color at ~10% opacity).
- Border: 1px solid `rgba(107, 138, 253, 0.35)`.
- Drawn from the mousedown point to the current cursor position. Updates in real-time as the cursor moves.
- The rectangle is an overlay on top of the editor content — it does not interfere with scrolling or block layout.

**Block highlighting during drag:**
- As the lasso rectangle intersects a block's bounding box, that block receives a selected state immediately (not on mouseup).
- Selected blocks get a subtle background highlight: `rgba(107, 138, 253, 0.08)` with a left accent border (2px solid `--accent` at 40% opacity).
- This provides both the OS-style rectangle feel and the per-block highlight feedback.

**Finalizing selection:**
- On mouseup, the lasso rectangle disappears. Selected blocks retain their highlighted state.
- Click anywhere (not on a selected block) to deselect all.
- `Escape` to deselect all.
- `Cmd+A` / `Ctrl+A` selects all blocks on the page.

**Extending selection:**
- `Shift+Click` on a block adds/removes it from the selection (toggle).
- `Shift+Click` on a block while others are selected: selects the range from the last selected block to the clicked block (contiguous range select).
- `Cmd+Click` / `Ctrl+Click` on a block toggles that individual block's selection (non-contiguous).

### 3.2 Actions on Selected Blocks

When one or more blocks are selected, right-clicking opens the **existing context menu** from Phase 02, adapted for multi-select:

| Action | Behavior (multi-select) |
|--------|------------------------|
| Delete | Delete all selected blocks |
| Duplicate | Duplicate all selected blocks (inserted below the last selected block) |
| Copy | Copy all selected blocks to clipboard (as rich text / editor JSON) |
| Cut | Cut all selected blocks to clipboard |
| Move Up | Move all selected blocks up by one position (as a group) |
| Move Down | Move all selected blocks down by one position (as a group) |

**Transform To** actions in multi-select apply the transformation to every selected block. E.g., selecting 5 paragraphs and choosing "Heading 2" converts all 5 to H2.

**Keyboard shortcuts with selection active:**
- `Backspace` / `Delete` → delete all selected blocks.
- `Cmd+C` → copy selected blocks.
- `Cmd+X` → cut selected blocks.
- `Cmd+D` → duplicate selected blocks.

### 3.3 Clipboard Format

When copying/cutting multiple blocks:
- **Internal clipboard**: Store the full block JSON (editor-native format) so pasting within Nexus preserves block types and formatting.
- **System clipboard**: Also write a plain-text representation (Markdown conversion, same rules as export) so pasting into external apps produces readable text.
- Use the Clipboard API's `write()` with multiple `ClipboardItem` types: `text/plain` (Markdown) and a custom MIME type like `application/x-nexus-blocks` (JSON) for internal paste detection.

### 3.4 Implementation Notes

- The lasso selection overlay is rendered as an absolutely-positioned `div` within the editor area container, managed by React state — not by the editor library.
- Block intersection detection: on mousemove during drag, calculate which blocks' bounding rects overlap with the selection rect. Use `element.getBoundingClientRect()` for each block's DOM node.
- Performance: debounce intersection checks to every ~16ms (one frame) during drag. Cache block positions on drag start and only recalculate if the editor scrolls during the drag.
- The selection state (set of selected block IDs) lives in Zustand, not in the editor's internal state. The editor library is not aware of multi-select — this is a UI layer on top.
- While blocks are selected, typing should deselect all and place the cursor normally (selection is a "mode" that exits on text input).

### 3.5 Visual Priority

The lasso rectangle and block highlighting must not conflict with the editor's native text selection (cursor highlighting of text within a block). The rule:

- **Click inside a block's text area** → normal text cursor / text selection. No lasso.
- **Click on empty space** (the editor margin, the gap between blocks, or the drag handle area) → initiate lasso selection.
- A simple heuristic: if `mousedown` target is a block's content editable area, it's text editing. If it's the editor container, the block wrapper, or the drag handle zone, it's lasso territory.

---

## 4. Adjustable Page Width

### Behavior

Phase 02 set a fixed `max-width: 720px` on the editor content area. Phase 03 makes this user-adjustable per page.

**Width options:**

| Label | Max Width | Use Case |
|-------|-----------|----------|
| Narrow | 640px | Focused writing, long-form text |
| Default | 720px | General notes (current Phase 02 value) |
| Wide | 900px | Tables, columns, side-by-side content |
| Full | 100% (no max-width) | Dashboards, wide tables, canvas-like layouts |

**UI control:**
- A small width toggle in the **top-right corner of the editor area**, inline with the page title row. Three horizontal-line icons of increasing width (or a simple dropdown). Unobtrusive — uses `--text-tertiary` color, brightens to `--text-secondary` on hover.
- Clicking cycles through the options or opens a small dropdown showing all four with the current one highlighted.
- The transition between widths is animated: `max-width` transitions over 200ms ease-out. No jarring jump.

**Persistence:**
- Page width is stored per-page in the `pages` table. Add a `page_width` column:

```sql
ALTER TABLE pages ADD COLUMN page_width TEXT NOT NULL DEFAULT 'default';
-- Valid values: 'narrow', 'default', 'wide', 'full'
```

- This is the only schema change in Phase 03.

**Global default:**
- New pages inherit the `'default'` width.
- No global setting to override all pages in Phase 03 — per-page only. A global preference can come with Phase 06 (Themes).

### IPC Additions

Page width is saved via the existing `pages.update(id, data)` method — no new IPC needed. The `Partial<Page>` type already accommodates new fields.

### Zustand

Add `pageWidth` to `currentPage` state. The editor area reads `currentPage.page_width` and applies the corresponding `max-width` CSS class or inline style.

---

## 5. Keyboard Shortcuts (Phase 03 Additions)

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+E` | Export current page (opens format picker) |
| `Cmd+Shift+I` | Import (opens file picker) |
| `Cmd+A` | Select all blocks (when no text cursor is active in a block) |
| `Escape` | Deselect all blocks / dismiss any open menu |

All Phase 01 and Phase 02 shortcuts remain unchanged.

---

## 6. Zustand State Additions

```typescript
interface AppState {
  // ... existing state from Phase 01/02 ...

  // Multi-select
  selectedBlockIds: Set<string>;
  isLassoActive: boolean;
  lassoRect: { x: number; y: number; width: number; height: number } | null;

  // Actions
  selectBlocks(ids: string[]): void;
  deselectAllBlocks(): void;
  toggleBlockSelection(id: string): void;
  deleteSelectedBlocks(): Promise<void>;
  duplicateSelectedBlocks(): Promise<void>;
  copySelectedBlocks(): Promise<void>;
  cutSelectedBlocks(): Promise<void>;
}
```

---

## 7. IPC Summary (All Phase 03 Additions)

```typescript
// Add to existing NexusAPI interface:

links: {
  getBacklinks(pageId: string): Promise<BacklinkResult[]>;
  syncLinks(pageId: string, linkTargets: LinkTarget[]): Promise<void>;
};

io: {
  exportPageMarkdown(pageId: string): Promise<string>;
  exportPageJSON(pageId: string): Promise<string>;
  exportAllMarkdown(): Promise<{ filename: string; content: string }[]>;
  exportAllJSON(): Promise<string>;
  importMarkdown(content: string, filename: string): Promise<Page>;
  importJSON(content: string): Promise<Page | { imported: number }>;
  importPlainText(content: string, filename: string): Promise<Page>;
};

dialog: {
  showSaveDialog(options: SaveDialogOptions): Promise<string | null>;
  showOpenDialog(options: OpenDialogOptions): Promise<string[] | null>;
  showSelectFolder(): Promise<string | null>;
};
```

---

## 8. Migration Notes

One schema change: the `page_width` column added to the `pages` table (see Section 4). This is an `ALTER TABLE ADD COLUMN` with a `DEFAULT 'default'` — safe to run on an existing database with no data loss. Run this migration on app startup if the column does not exist.

The `links` table already exists from Phase 01. All link operations use the existing schema. Import creates pages and blocks using existing IPC methods (`pages.create`, `blocks.save`) plus the new `links.syncLinks` for resolving `[[wiki-links]]`.

---

## Definition of Done

Phase 03 is complete when:

**Bidirectional Links:**
- [ ] Typing `[[` opens a page search popup inline.
- [ ] Selecting a page inserts a styled link chip (icon + title).
- [ ] "Create new page" option appears when no match is found.
- [ ] Clicking a link navigates to the target page.
- [ ] Broken links (trashed/deleted targets) render with appropriate visual states.
- [ ] Every page has a collapsible "Backlinks" section below the editor.
- [ ] Backlinks show source page title + context excerpt.
- [ ] Link rows in the DB are created/deleted in sync with editor content.

**Import / Export:**
- [ ] Single page exports to Markdown (`.md`) via right-click or command palette.
- [ ] Single page exports to JSON via right-click or command palette.
- [ ] All pages export to a folder of Markdown files.
- [ ] All pages export to a single JSON database dump.
- [ ] Markdown import creates a page with correct block structure.
- [ ] JSON import (single page) recreates the page with new UUIDs.
- [ ] JSON import (full database) merges data into the current DB.
- [ ] Plain text import creates a page with a single paragraph.
- [ ] Folder import (multiple `.md` files) works.
- [ ] Drag-and-drop of files onto the sidebar triggers import.
- [ ] `[[wiki-links]]` in Markdown are resolved to existing pages or create new ones.
- [ ] Import shows success/failure toast notifications.
- [ ] Exported Markdown is valid and renders correctly in other Markdown viewers.
- [ ] Exported JSON is valid and round-trips (export → import produces an equivalent page).

**Block Multi-Select:**
- [ ] Left-click drag on empty editor space draws a selection rectangle with accent color tint.
- [ ] Blocks intersecting the rectangle are highlighted in real-time during drag.
- [ ] Selected blocks retain highlight after mouseup.
- [ ] Right-click on selected blocks opens the context menu with bulk actions.
- [ ] Delete, Duplicate, Copy, Cut, Move Up, Move Down work on multi-selected blocks.
- [ ] "Transform To" applies to all selected blocks.
- [ ] `Cmd+A` selects all blocks.
- [ ] `Escape` and click-away deselect all blocks.
- [ ] `Shift+Click` extends selection. `Cmd+Click` toggles individual blocks.
- [ ] `Backspace`, `Cmd+C`, `Cmd+X`, `Cmd+D` work with block selection active.
- [ ] Copied blocks paste correctly within Nexus (preserving block types) and externally (as Markdown).
- [ ] Lasso does not conflict with text selection inside blocks.

**General:**
- [ ] Editor content area width is adjustable per page (Narrow / Default / Wide / Full).
- [ ] Width toggle UI is visible in the editor header, unobtrusive.
- [ ] Width preference persists per page across sessions.
- [ ] Width transitions are animated (no jarring jump).
- [ ] `page_width` migration runs safely on existing databases.
- [ ] All new keyboard shortcuts work.
- [ ] No regressions in Phase 01 or Phase 02 functionality.
- [ ] No crashes, no data loss, no unhandled errors in console.

---

## What NOT to Build in Phase 03

- No full-text search (search remains title-only from Phase 01).
- No media/image embedding in imported content (defer to Phase 04).
- No CSV import/export (defer to Phase 10 — requires typed objects).
- No Notion or AnyType migration importers (lower priority, defer).
- No graph visualization of links (defer to Phase 13 — Node Graph).
- No multi-page drag-and-drop (blocks stay within their page).
- No block selection across pages.
- No collaborative clipboard or cross-vault paste.
- No link autocomplete in the command palette (links are editor-inline only).
