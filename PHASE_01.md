# PHASE 01 — Note Software (Foundation)

> This spec is the authoritative reference for Phase 01. Read PROJECT.md first, then this file. Do not deviate from decisions made here.

---

## Objective

Build the foundational layer of Nexus: the SQLite schema, Electron shell, and a working CRUD note interface with a native WYSIWYG editor. The deliverable is a functional desktop app where you can create, read, edit, and delete notes — and it feels like writing in a real app, not a textarea.

---

## Stack Decisions (Locked)

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | **React** (with TypeScript) | Largest ecosystem, best block editor library support |
| Electron tooling | **electron-vite** | Fast HMR, modern ESM support, clean main/renderer split |
| SQLite binding | **better-sqlite3** | Synchronous API eliminates callback complexity; fastest option for Electron main process. Rebuild for Electron with `electron-rebuild` or `@electron/rebuild`. |
| IPC pattern | **Context bridge + preload** | All DB calls go through IPC. Renderer never touches Node directly. `contextIsolation: true`, `nodeIntegration: false`. |
| Editor | **TipTap** (evaluate BlockNote as wrapper) | TipTap gives maximum control for future phases. BlockNote is built on TipTap — if its out-of-box UX is good enough for Phase 01, use it and retain the ability to drop to TipTap later. **Decision rule**: start with BlockNote. If it fights you on any requirement below, switch to raw TipTap. Document which you chose and why. |
| Styling | **Tailwind CSS** | Utility-first, works well with CSS custom properties for future theming (Phase 06). |

---

## SQLite Schema

Implement this schema exactly. This is the foundation for the entire app — every future phase depends on it. Use WAL mode (`PRAGMA journal_mode=WAL`) for concurrent read performance.

```sql
-- ============================================================
-- TYPES
-- ============================================================
CREATE TABLE types (
  id            TEXT PRIMARY KEY,          -- UUID
  name          TEXT NOT NULL UNIQUE,
  icon          TEXT,                       -- emoji or icon identifier
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed the base type
INSERT INTO types (id, name, icon) VALUES ('note', 'Note', '📝');

-- ============================================================
-- PAGES
-- ============================================================
CREATE TABLE pages (
  id            TEXT PRIMARY KEY,          -- UUID
  type_id       TEXT NOT NULL DEFAULT 'note' REFERENCES types(id),
  title         TEXT NOT NULL DEFAULT '',
  icon          TEXT,                       -- emoji or icon identifier, nullable
  cover         TEXT,                       -- path to cover image, nullable
  is_archived   INTEGER NOT NULL DEFAULT 0,
  is_deleted    INTEGER NOT NULL DEFAULT 0, -- soft delete
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_pages_type ON pages(type_id);
CREATE INDEX idx_pages_archived ON pages(is_archived);
CREATE INDEX idx_pages_deleted ON pages(is_deleted);

-- ============================================================
-- BLOCKS
-- ============================================================
CREATE TABLE blocks (
  id              TEXT PRIMARY KEY,        -- UUID
  page_id         TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  parent_block_id TEXT REFERENCES blocks(id) ON DELETE CASCADE,
  block_type      TEXT NOT NULL DEFAULT 'paragraph',
    -- Valid types: paragraph, heading1, heading2, heading3,
    -- bulletList, numberedList, checkList, toggle,
    -- code, image, file, embed, divider, callout, table, quote
  content         TEXT,                     -- JSON (TipTap/BlockNote node content)
  sort_order      REAL NOT NULL DEFAULT 0,  -- fractional indexing for reordering
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_blocks_page ON blocks(page_id);
CREATE INDEX idx_blocks_parent ON blocks(parent_block_id);
CREATE INDEX idx_blocks_order ON blocks(page_id, sort_order);

-- ============================================================
-- PROPERTIES (for typed objects — used starting Phase 09, schema exists now)
-- ============================================================
CREATE TABLE property_definitions (
  id            TEXT PRIMARY KEY,          -- UUID
  type_id       TEXT NOT NULL REFERENCES types(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  property_type TEXT NOT NULL,
    -- Valid types: text, number, date, boolean, select,
    -- multi_select, relation, url, file
  config        TEXT,                       -- JSON for select options, relation targets, etc.
  sort_order    REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(type_id, name)
);

CREATE TABLE property_values (
  id              TEXT PRIMARY KEY,        -- UUID
  page_id         TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  property_def_id TEXT NOT NULL REFERENCES property_definitions(id) ON DELETE CASCADE,
  value_text      TEXT,
  value_number    REAL,
  value_date      TEXT,
  value_boolean   INTEGER,
  value_json      TEXT,                     -- for multi_select, relation arrays
  UNIQUE(page_id, property_def_id)
);

CREATE INDEX idx_propvals_page ON property_values(page_id);
CREATE INDEX idx_propvals_def ON property_values(property_def_id);

-- ============================================================
-- LINKS (bidirectional — used starting Phase 03, schema exists now)
-- ============================================================
CREATE TABLE links (
  id              TEXT PRIMARY KEY,        -- UUID
  source_page_id  TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  target_page_id  TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  context         TEXT,                     -- optional excerpt / anchor text
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source_page_id, target_page_id)
);

CREATE INDEX idx_links_source ON links(source_page_id);
CREATE INDEX idx_links_target ON links(target_page_id);
```

### Schema notes

- **UUIDs**: Use `crypto.randomUUID()` (available in Electron's renderer and main). Generate in the main process before insert.
- **Fractional indexing for `sort_order`**: Use REAL values (e.g. 1.0, 2.0, 3.0). When inserting between two blocks, use the midpoint. If precision degrades, reindex the page's blocks sequentially. Library recommendation: `fractional-indexing` npm package or manual midpoint math.
- **`content` column in blocks**: Store the TipTap/BlockNote JSON representation of the block's content. The editor library handles serialization/deserialization. Do NOT try to flatten rich text into separate columns.
- **Soft delete**: `is_deleted = 1` means the page is in trash. A "Trash" UI section is Phase 01 scope. Hard delete (actually remove the row) is a user action from within Trash.
- **`updated_at` maintenance**: Use a trigger or update it in the application layer on every write. Prefer application layer — triggers on every column update are noisy.

---

## Electron Architecture

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # App entry, window creation
│   ├── database.ts          # better-sqlite3 init, migrations, query functions
│   └── ipc-handlers.ts      # IPC handler registration (all DB operations)
├── preload/
│   └── index.ts             # contextBridge.exposeInMainWorld — typed API
├── renderer/                # React app
│   ├── App.tsx
│   ├── components/
│   ├── hooks/
│   ├── stores/              # State management (Zustand recommended)
│   └── styles/
└── shared/
    └── types.ts             # Shared TypeScript types (Page, Block, etc.)
```

### IPC Contract

Define a typed API exposed via `contextBridge`. Every database operation is an IPC call. The renderer calls `window.api.someMethod()`, which invokes a handler in the main process.

**Phase 01 IPC methods:**

```typescript
interface NexusAPI {
  // Pages
  pages: {
    create(): Promise<Page>;
    getAll(): Promise<Page[]>;
    getById(id: string): Promise<Page | null>;
    update(id: string, data: Partial<Page>): Promise<void>;
    softDelete(id: string): Promise<void>;
    restore(id: string): Promise<void>;
    hardDelete(id: string): Promise<void>;
    getDeleted(): Promise<Page[]>;
  };

  // Blocks
  blocks: {
    getByPageId(pageId: string): Promise<Block[]>;
    save(pageId: string, blocks: Block[]): Promise<void>;
      // ^ Replaces all blocks for the page. The editor owns the block tree
      //   and saves the full state. Diff-based partial updates are a future optimization.
  };
}
```

### Window configuration

```typescript
const mainWindow = new BrowserWindow({
  width: 1200,
  height: 800,
  minWidth: 800,
  minHeight: 600,
  titleBarStyle: 'hiddenInset',  // macOS native-feeling title bar
  trafficLightPosition: { x: 16, y: 18 },
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,  // required for better-sqlite3 via preload
  },
});
```

> **Note on `sandbox: false`**: better-sqlite3 is a native module that runs in the main process. The preload script itself does not load better-sqlite3 — it only exposes IPC bridges. However, `sandbox: false` is currently needed for the preload script to use `ipcRenderer`. If you find a way to keep `sandbox: true` while maintaining IPC, prefer that.

---

## UI Requirements

### Layout

```
┌──────────────────────────────────────────────────┐
│  ◀ ▶  ─ ─ ─ ─ ─ ─ ─ (drag area) ─ ─ ─ ─ ─ ─  │  ← Title bar / drag region
├────────────┬─────────────────────────────────────┤
│            │                                     │
│  Sidebar   │           Editor Area               │
│            │                                     │
│  ┌──────┐  │   ┌─────────────────────────────┐   │
│  │Search│  │   │  Page Title (editable)       │   │
│  └──────┘  │   │                              │   │
│            │   │  Block content...            │   │
│  All Notes │   │  Block content...            │   │
│  --------  │   │  Block content...            │   │
│  Page 1    │   │                              │   │
│  Page 2    │   │                              │   │
│  Page 3    │   │                              │   │
│  ...       │   │                              │   │
│            │   └─────────────────────────────┘   │
│            │                                     │
│  ┌──────┐  │                                     │
│  │Trash │  │                                     │
│  └──────┘  │                                     │
├────────────┴─────────────────────────────────────┤
│  Status bar (optional: word count, last saved)   │
└──────────────────────────────────────────────────┘
```

### Sidebar

- **Search field** at top. Phase 01: filter pages by title substring (case-insensitive). No full-text search yet.
- **Page list**: All non-deleted pages, sorted by `updated_at` descending (most recent first).
- Each page item shows: icon (or default), title (or "Untitled"), relative time ("2m ago", "Yesterday").
- Click to open in editor area.
- **Right-click context menu**: Rename, Delete (soft), Duplicate.
- **"New Page" button**: prominent, top of sidebar or floating. Keyboard shortcut: `Cmd+N` / `Ctrl+N`.
- **Trash section** at bottom of sidebar. Click to show deleted pages. From trash: Restore or Permanently Delete.
- Sidebar is **resizable** by dragging the right edge. Persist width in localStorage or a settings table.
- Sidebar is **collapsible** via toggle button or `Cmd+\` / `Ctrl+\`.

### Editor Area

- **Page title**: Large, editable text at the top. No explicit "save" — title updates are auto-saved on change (debounced, ~500ms).
- **Block editor**: WYSIWYG, rendered below the title. This is the core of the app.
- When no page is selected: show an empty state with a prompt ("Select a page or create a new one").
- **Auto-save**: All changes (title, blocks) are saved automatically. No save button. Debounce writes by 500ms to avoid excessive DB calls. Show a subtle "Saving..." / "Saved" indicator in the status bar or near the title.

### Editor Capabilities (Phase 01)

The editor must support these block types from day one:

| Block Type | Behavior |
|------------|----------|
| Paragraph | Default block. Rich text: bold, italic, underline, strikethrough, code inline. |
| Heading 1/2/3 | Styled headings. Accessible via `/h1`, `/h2`, `/h3` or toolbar. |
| Bullet List | Unordered list. Tab to indent, Shift+Tab to outdent. |
| Numbered List | Ordered list. Auto-incrementing. |
| Checklist | Checkbox + text. Clickable to toggle. |
| Quote | Block quote with left border styling. |
| Divider | Horizontal rule. |
| Code Block | Monospace, syntax highlighting optional in Phase 01. |

**Not in Phase 01 scope** (but the block types exist in the schema): toggle, image, file, embed, callout, table. These come in Phase 02–04.

### Slash Command Menu

- Typing `/` at the start of an empty block (or after a space) opens a floating menu.
- Menu lists available block types with icons and names.
- Filterable by typing (e.g., `/h1` filters to Heading 1).
- Arrow keys to navigate, Enter to select, Escape to dismiss.
- If using BlockNote, this is built-in. If using TipTap, implement via the `Suggestion` extension.

### Command Palette

- **Trigger**: `Cmd+K` (macOS) / `Ctrl+K` (Windows/Linux).
- **Behavior**: Modal overlay with a search input. Fuzzy-match against:
  - Page titles → navigate to page
  - Actions: "New Page", "Toggle Sidebar", "Go to Trash"
- Arrow keys to navigate, Enter to select, Escape to dismiss.
- This is a simple implementation — it will grow in later phases. Keep the architecture extensible (a registry of commands with `id`, `label`, `shortcut`, `action`).

---

## Keyboard Shortcuts (Phase 01)

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New page |
| `Cmd+K` | Command palette |
| `Cmd+\` | Toggle sidebar |
| `Cmd+Backspace` | Delete current page (soft) |
| `Cmd+Z` / `Cmd+Shift+Z` | Undo / Redo (editor handles this) |
| `Cmd+B` | Bold |
| `Cmd+I` | Italic |
| `Cmd+U` | Underline |
| `Cmd+Shift+S` | Strikethrough |
| `Cmd+E` | Inline code |

---

## State Management

Use **Zustand** for client-side state. Keep it minimal:

```typescript
interface AppState {
  // Sidebar
  pages: Page[];
  selectedPageId: string | null;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  searchQuery: string;

  // Editor
  currentPage: Page | null;
  isSaving: boolean;

  // Trash
  showTrash: boolean;
  deletedPages: Page[];

  // Actions
  loadPages(): Promise<void>;
  selectPage(id: string): Promise<void>;
  createPage(): Promise<void>;
  updatePage(id: string, data: Partial<Page>): Promise<void>;
  deletePage(id: string): Promise<void>;
  restorePage(id: string): Promise<void>;
  hardDeletePage(id: string): Promise<void>;
}
```

---

## Auto-Save Strategy

1. Editor emits `onChange` on every keystroke.
2. Debounce the save call by **500ms**.
3. On save: serialize the editor state to blocks JSON, call `window.api.blocks.save(pageId, blocks)`.
4. Title changes also debounced at 500ms, call `window.api.pages.update(id, { title })`.
5. Show a subtle save indicator: "Saving..." while the IPC call is in flight, "Saved" with a checkmark for 2 seconds after success.
6. On window close / page switch: flush any pending save immediately (cancel debounce, save synchronously if possible).

---

## Database Location

- Default: `~/.nexus/data/nexus.db` (or platform-appropriate app data directory via `app.getPath('userData')`).
- Create the directory if it doesn't exist on first launch.
- The `attachments/` directory (Phase 04) will live alongside the database file.

---

## Error Handling

- DB errors in IPC handlers: catch, log to console, return a structured error to the renderer. Do not crash.
- Renderer: show a toast/notification for user-facing errors ("Failed to save", "Page not found").
- Toast system: implement a simple one (or use a library like `react-hot-toast`). It will be reused in every future phase.

---

## Definition of Done

Phase 01 is complete when:

- [ ] Electron app launches, creates the SQLite database on first run.
- [ ] All tables from the schema section exist and are correct.
- [ ] User can create a new page (`Cmd+N`).
- [ ] User can see all pages in the sidebar, sorted by last updated.
- [ ] User can click a page to open it in the editor.
- [ ] Page title is editable and auto-saves.
- [ ] Block editor supports: paragraph, headings, bullet list, numbered list, checklist, quote, divider, code block.
- [ ] Rich text formatting works: bold, italic, underline, strikethrough, inline code.
- [ ] Slash command menu works for inserting block types.
- [ ] User can delete a page (moves to trash).
- [ ] Trash view shows deleted pages. User can restore or permanently delete.
- [ ] Search in sidebar filters pages by title.
- [ ] Command palette opens with `Cmd+K`, can navigate to pages and trigger actions.
- [ ] All changes auto-save with visual indicator.
- [ ] Sidebar is resizable and collapsible (`Cmd+\`).
- [ ] Empty states are handled (no pages, no selection, empty trash).
- [ ] No crashes, no data loss, no unhandled errors in console.

---

## What NOT to Build in Phase 01

- No markdown editor / source mode (Phase 02).
- No import/export (Phase 03).
- No bidirectional links (Phase 03).
- No media embedding (Phase 04).
- No tabs or split view (Phase 05).
- No themes beyond a single dark theme (Phase 06).
- No drag-and-drop block reordering (Phase 02 — the editor library may support this out of box, and if so, leave it enabled, but do not spend time implementing it manually).
- No page nesting / hierarchy (defer to Sections, Phase 15).
- No undo history beyond what the editor provides natively.
