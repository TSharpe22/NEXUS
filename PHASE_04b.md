# PHASE 04b — Polish, Stability, and Hardening

> This spec is the authoritative reference for Phase 04b. Read PROJECT.md and PHASE_01.md through PHASE_04.md first. This phase produces no new features. It exists to ensure Nexus is solid, consistent, and genuinely pleasant to use before the workspace complexity of Phase 05 begins.

---

## Objective

Audit and harden everything built in Phases 01–04. Fix functional edge cases, unify visual inconsistencies, enforce performance baselines, and wire up every error path. The deliverable is a version of Nexus that feels like a finished tool — not a prototype with rough edges deferred.

**Rule:** No new features. If a fix requires a new feature to be done properly, document it as a Phase 05+ item instead.

---

## 1. Functional Fixes and Edge Cases

### 1.1 Auto-Save Contract

Auto-save is the only save mechanism — there is no manual save, and there are no warnings on close. This contract must be airtight.

**Audit checklist:**
- [ ] On app close (`will-quit` Electron event): flush any pending debounced saves synchronously before the process exits. Cancel all pending timers and call the save function directly.
- [ ] On page switch (navigating away from a page in the sidebar): flush pending saves for the departing page before loading the new one.
- [ ] On tab close (Phase 05 will formalize this, but the flush logic must exist now): ensure the save flush is wired into whatever tab/page-switching logic exists.
- [ ] Verify that a 500ms debounce cannot result in data loss if the user types and immediately closes the app within that window.
- [ ] The save indicator ("Saving..." → "Saved") must always resolve. Audit for cases where it gets stuck on "Saving..." indefinitely (e.g. IPC call never returns).

**Implementation:** In the Electron main process, register a `before-quit` handler that calls a `db.flushPendingWrites()` function. This function accepts any queued writes from the renderer via a dedicated `pages.flushAll()` IPC call and executes them synchronously before the process exits.

### 1.2 Soft Delete and Trash

- [ ] Pages soft-deleted while open in the editor: the editor area should transition to the empty state, not remain showing the deleted page's content.
- [ ] Restoring a page from trash: should auto-select and open the restored page in the editor.
- [ ] Permanently deleting a page that has backlinks (Phase 03): verify that `ON DELETE CASCADE` on the `links` table fires correctly and the orphaned link nodes in other pages' block content JSON render gracefully (as "Page no longer exists" state, not a crash).
- [ ] Empty trash action: if there are many deleted pages, this should not block the UI. Run hard deletes in a single transaction.

### 1.3 Search

Phase 01 implemented title-only search with substring matching. Audit its behavior:
- [ ] Search is case-insensitive.
- [ ] Search matches mid-word (searching "rade" finds "Trade Log").
- [ ] Deleted pages do not appear in search results.
- [ ] Archived pages do not appear in search results.
- [ ] Searching while pages are loading does not crash or produce stale results.
- [ ] Empty search state: the full page list is shown (not an empty list).
- [ ] Clearing search: the list returns to full immediately, not after a debounce delay.

### 1.4 Command Palette

- [ ] Fuzzy match is working correctly — "np" should match "New Page", "tog" should match "Toggle Sidebar".
- [ ] Command palette opens pages by ID, not by title string match that could silently navigate to the wrong page if two pages share a title.
- [ ] If the command palette is open and a page is deleted in the background, selecting that page's result does not crash.
- [ ] Command palette results are scrollable when the list exceeds the visible area.
- [ ] The palette dismisses correctly on: Escape, click outside, item selection, window blur.
- [ ] Keyboard navigation (arrow keys) wraps correctly at the top and bottom of the list.

### 1.5 Block Editor Integrity

- [ ] Blocks save correctly on every block type from Phase 01–02. Run through each: paragraph, h1/h2/h3, bullet, numbered, checklist, quote, divider, code, toggle, callout, table, columnGroup/column.
- [ ] An empty page (no blocks) saves and loads without error. The editor shows a placeholder and correctly creates the first block on keypress.
- [ ] Deleting the last block in a page does not leave a broken state — the editor should auto-create a new empty paragraph.
- [ ] Undo/redo (provided by the editor library) works across all block types without corrupting the block tree.
- [ ] Pasting plain text from an external source into the editor creates a paragraph block, not a crash or invisible content.
- [ ] Pasting rich text (e.g. from a browser) strips unsupported formatting rather than injecting raw HTML into the block content.

### 1.6 Sidebar

- [ ] Sidebar resize (drag handle) has a minimum width of 200px and a maximum of 480px. Values outside this range are clamped.
- [ ] Sidebar width persists across sessions (localStorage or the `workspace` table — use `workspace` table for consistency with Phase 05).
- [ ] Collapsing the sidebar (`Cmd+\`) and then opening a page navigates correctly (sidebar stays collapsed, page opens).
- [ ] The page list scrolls independently of the sidebar chrome (search field and trash section stay fixed at top/bottom while the page list scrolls).
- [ ] Right-click context menu on a page item: Rename, Delete, Duplicate all work correctly.
- [ ] Rename: inline edit (not a modal). Pressing Enter or clicking away confirms the rename. Pressing Escape cancels and restores the original title.
- [ ] Duplicate: creates a copy of the page with all its blocks, with the title "Copy of [original title]", inserts it immediately below the original in the list, and selects it.

---

## 2. Visual Polish Audit

Phase 02 established the color system and polish pass. This section audits adherence and fixes deviations.

### 2.1 Color System Compliance

Run a full audit of every UI surface. Nothing should use hardcoded color values — every color must be a CSS custom property from the established token set.

**Audit targets:**
- [ ] No `#fff`, `#000`, `white`, `black`, or raw hex values anywhere in component CSS/Tailwind classes.
- [ ] No Tailwind color utilities (`text-gray-500`, `bg-zinc-800`, etc.) that bypass the token system. All colors via `text-[var(--text-primary)]` or equivalent.
- [ ] Scrollbars: verify custom scrollbar CSS (`::-webkit-scrollbar`) is applied to every scrollable container — sidebar page list, editor area, command palette results, trash list.
- [ ] Focus states (see Section 3) use `--accent` at a consistent opacity, not the browser default blue outline.

### 2.2 Animation and Transition Audit

Every interactive element should have a transition. Audit for missing or inconsistent ones:

| Element | Expected Transition |
|---------|-------------------|
| Sidebar page item hover | background 120ms ease |
| Button hover/active | background 120ms ease |
| Slash menu open | opacity + translateY, 120ms ease-out |
| Context menu open | opacity + translateY, 120ms ease-out |
| Command palette open | opacity + scale(0.98→1), 150ms ease-out |
| Save indicator | opacity fade, 200ms |
| Toast notifications | slide-in from right, 200ms ease-out; fade-out 200ms |
| Sidebar collapse/expand | width transition, 200ms ease-in-out |
| Drag handle appear | opacity 0→1, 150ms |
| Modal overlays (any) | opacity + scale, 150ms ease-out |

- [ ] Audit all of the above and add missing transitions.
- [ ] No transitions on properties that cause layout reflow (avoid transitioning `width` on the editor content area — use `max-width` instead).
- [ ] Respect `prefers-reduced-motion`: wrap all non-essential transitions in `@media (prefers-reduced-motion: no-preference)`.

### 2.3 Empty States

Every possible empty state must be designed, not left as a blank void:

| State | Required Empty State |
|-------|---------------------|
| No pages exist | Centered: icon + "Your workspace is empty" + "Press Cmd+N to create your first page" |
| No page selected | Centered: icon + "Select a page or press Cmd+N" |
| Search returns no results | Centered: icon + "No pages match '[query]'" |
| Trash is empty | Centered: icon + "Trash is empty" |
| Page has no blocks | Subtle placeholder text inside the editor: "Start writing, or press / for commands" |
| Backlinks section (0 backlinks) | "No pages link here yet." — no icon needed, inline text is fine |

All empty state icons use `--text-tertiary`. All empty state primary text uses `--text-secondary`. All CTAs use `--accent`.

### 2.4 Typography Consistency Audit

- [ ] All heading sizes (H1/H2/H3 in the editor, section headers in the sidebar) match the spec values from Phase 02.
- [ ] Line height is 1.6–1.7 on all paragraph text. Verify nothing has defaulted to 1.4 or browser default.
- [ ] No orphaned font-size declarations outside the CSS custom property system.
- [ ] Code blocks use the correct monospace stack on all platforms (JetBrains Mono if embedded, system monospace as fallback).
- [ ] Inline code marks (within a paragraph) have a subtle background (`--bg-elevated`) and slightly smaller font size (0.875em).

---

## 3. Accessibility Baseline

Minimal focus rings — visible only on interactive controls, not editor content. The app must be fully keyboard-navigable for its core flows.

### 3.1 Focus Ring Specification

```css
/* Apply globally, then suppress where not needed */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}

/* Suppress on editor content area — the editor handles its own cursor */
.editor-content:focus-visible,
.editor-content *:focus-visible {
  outline: none;
}

/* Mouse clicks should not show focus ring */
:focus:not(:focus-visible) {
  outline: none;
}
```

- [ ] All buttons, links, and interactive controls show the focus ring on keyboard focus.
- [ ] The sidebar page list items are keyboard-navigable (arrow keys move between items, Enter opens).
- [ ] The command palette is fully keyboard-navigable.
- [ ] The slash command menu is fully keyboard-navigable.
- [ ] The context menu is fully keyboard-navigable (arrow keys, Enter, Escape).
- [ ] Modal overlays trap focus (Tab cycles only within the modal while it's open).
- [ ] Closing a modal returns focus to the element that opened it.

### 3.2 ARIA Labels

Minimal but correct ARIA on key interactive elements:

- [ ] Sidebar toggle button: `aria-label="Toggle sidebar"`, `aria-expanded={!collapsed}`.
- [ ] New Page button: `aria-label="New page"`.
- [ ] Tab close buttons: `aria-label="Close [page title] tab"`.
- [ ] Search input: `aria-label="Search pages"`.
- [ ] Command palette input: `aria-label="Command palette"`, `role="combobox"`.
- [ ] Context menus: `role="menu"`, items `role="menuitem"`.
- [ ] Toast notifications: `role="status"`, `aria-live="polite"`.

### 3.3 Keyboard Navigation Gaps

Audit and fix any flows that require a mouse:

- [ ] Creating a new page: `Cmd+N` works from anywhere in the app.
- [ ] Deleting a page: focus a sidebar item, right-click menu is keyboard-accessible, or `Cmd+Backspace` works.
- [ ] Renaming a page: sidebar item focused → `F2` or `Enter` initiates inline rename.
- [ ] Opening command palette from any focus state: `Cmd+K` works even when focus is inside the editor.

---

## 4. Performance Baselines

### 4.1 Startup Time

Target: app is interactive (page list visible, editor ready) within **2 seconds** on a mid-range machine with a database of up to 500 pages.

**Audit and fix:**
- [ ] SQLite queries on startup use indexed columns only. Verify `idx_pages_deleted` and `idx_pages_archived` are used for the initial page list load (`WHERE is_deleted = 0 AND is_archived = 0`).
- [ ] The initial `getAll()` pages call does not load block content — only page metadata (id, title, icon, updated_at, type_id). Blocks are loaded on-demand when a page is opened.
- [ ] No synchronous IPC calls on the main thread during startup. All DB reads are async from the renderer's perspective (better-sqlite3 is sync in the main process — keep heavy queries off the critical path by deferring non-essential ones).
- [ ] Enable WAL mode on the SQLite database (`PRAGMA journal_mode=WAL`) if not already set. Verify it's set.
- [ ] Add `PRAGMA cache_size = -32000` (32MB cache) to the database init sequence.

### 4.2 Large Page Performance

Target: a page with 200 blocks renders and is editable within **500ms** of being selected.

- [ ] Blocks are loaded via a single indexed query (`SELECT * FROM blocks WHERE page_id = ? ORDER BY sort_order`). Verify no N+1 queries.
- [ ] Block content JSON deserialization happens once, not on every render.
- [ ] The editor library's virtual rendering (if available) is enabled for large block counts.

### 4.3 Search Performance

Target: search results update within **100ms** of keystroke for a database of up to 500 pages.

- [ ] Title search uses a `LIKE '%query%'` query with the `idx_pages_deleted` index. For up to 500 pages, this is acceptable without FTS.
- [ ] Search is debounced at 150ms (not 0ms — don't query on every keystroke, but don't use the 500ms autosave debounce either).
- [ ] If page count exceeds 1000, add a note in code comments that FTS5 (`fts_pages` virtual table) should be considered.

### 4.4 Memory

- [ ] No memory leak from editor instances: when switching pages, the previous editor instance is properly destroyed (check for lingering event listeners).
- [ ] The Zustand store does not accumulate stale page data across navigation. Only `currentPage` and `pages` (the list) need to be in memory — block content is loaded per-page and can be discarded on navigate.

---

## 5. Error Handling Completeness

### 5.1 Toast System Specification

One unified toast system, used everywhere. If a library was used in Phase 01 (`react-hot-toast` was suggested), verify it's consistent. If it wasn't implemented properly, do it now.

**Toast variants:**

| Variant | Color | Icon | Auto-dismiss |
|---------|-------|------|-------------|
| Success | `--accent` tint | ✓ | 2.5s |
| Error | Rose/red tint | ✗ | 5s (longer — user needs to read it) |
| Info | Neutral | ℹ | 3s |
| Warning | Amber tint | ⚠ | 4s |

**Toast anatomy:**
- Position: bottom-right, 16px from edges.
- Width: 320px max.
- Background: `--bg-elevated`, border `--border-default`, subtle shadow.
- Stack: multiple toasts stack vertically with 8px gap. Maximum 3 visible at once — oldest dismissed if a 4th arrives.
- Animation: slide in from right (200ms ease-out), fade out (200ms ease-in).

### 5.2 IPC Error Coverage

Every IPC call in the renderer must have an error handler. Audit the following and add toasts where missing:

| IPC Call | Error Toast Message |
|----------|-------------------|
| `pages.create()` | "Failed to create page" |
| `pages.update()` | "Failed to save changes" |
| `pages.softDelete()` | "Failed to delete page" |
| `pages.restore()` | "Failed to restore page" |
| `pages.hardDelete()` | "Failed to permanently delete page" |
| `blocks.save()` | "Failed to save — your changes may be lost" (Warning variant) |
| `links.syncLinks()` | Silent — log to console only (non-critical) |
| `io.exportPageMarkdown()` | "Export failed" |
| `io.importMarkdown()` | "Import failed — file could not be parsed" |

**In the main process:** Every IPC handler is wrapped in a try/catch. Errors are logged with `console.error` and a structured error object is returned to the renderer (`{ success: false, error: string }`). The renderer checks `success` before processing the result.

### 5.3 Database Init Failures

If the SQLite database cannot be created or opened on launch (permissions issue, corrupted file, disk full):
- [ ] Show a native Electron dialog (`dialog.showErrorBox`) explaining the failure and the database path.
- [ ] Do not attempt to run the app in a broken state — exit after the dialog is dismissed.
- [ ] Log the full error to a log file adjacent to the database location (`~/.nexus/nexus.log`).

### 5.4 Graceful Degradation

- [ ] If a block's `content` JSON is malformed (corrupted in the DB), the editor renders a placeholder block ("This block could not be loaded") rather than crashing the entire page.
- [ ] If a linked page's ID cannot be resolved (bidirectional link to a non-existent page), the inline link renders as plain text with a tooltip, not a crash.
- [ ] If an image/attachment referenced in a block is missing from disk, render a "File not found" placeholder in the block rather than an error screen.

---

## 6. Code Quality and Consistency

This phase is also a chance to clean up technical debt before Phase 05 adds significant complexity.

### 6.1 TypeScript Strictness

- [ ] Enable `"strict": true` in `tsconfig.json` if not already set.
- [ ] Resolve all `any` types in shared types (`shared/types.ts`). Every Page, Block, and IPC response must be fully typed.
- [ ] The `NexusAPI` interface in the preload types must exactly match the handlers registered in `ipc-handlers.ts`. No drift between the two.

### 6.2 IPC Handler Consistency

All IPC handlers must follow the same pattern:

```typescript
// ipc-handlers.ts — standard pattern
ipcMain.handle('pages:create', async (_event) => {
  try {
    const page = db.createPage();
    return { success: true, data: page };
  } catch (error) {
    console.error('[IPC] pages:create failed:', error);
    return { success: false, error: (error as Error).message };
  }
});
```

- [ ] Audit every handler and enforce this pattern. No handlers that throw uncaught exceptions.
- [ ] Channel naming: all channels use `namespace:method` format (e.g. `pages:create`, `blocks:save`). No inconsistent naming.

### 6.3 Zustand Store Organization

- [ ] Split the Zustand store if it has grown into a single monolithic file. Suggested split: `useAppStore` (pages, sidebar, search), `useEditorStore` (current page, blocks, saving state).
- [ ] No derived state computed inside the store — compute it in selectors or component useMemo.
- [ ] Verify no store actions call other store actions directly (creates circular dependency risk). Actions call IPC, IPC returns data, actions update state.

---

## 7. Regression Test Checklist

Before marking Phase 04b complete, manually verify every Phase 01–04 DoD item still passes. Key regression risks:

- [ ] Phase 01: Create, read, edit, delete pages. Auto-save. Sidebar search. Command palette. Trash.
- [ ] Phase 02: Drag-and-drop reorder. Columns. Toggle, callout, table blocks. Text highlight. Context menu. Visual polish (no regressions to color system).
- [ ] Phase 03: Bidirectional links (`[[` trigger, link chip, backlinks panel). Export to Markdown and JSON. Import Markdown. Block multi-select (lasso, bulk actions). Page width toggle.
- [ ] Phase 04: (Whatever was built — media embedding, web tabs if implemented.)

---

## Definition of Done

Phase 04b is complete when:

**Functional:**
- [ ] Auto-save flushes synchronously on app close — no data loss possible.
- [ ] All soft-delete and trash edge cases handled correctly.
- [ ] Search is accurate, case-insensitive, and fast.
- [ ] Command palette is robust (fuzzy match, no stale results, correct keyboard nav).
- [ ] Block editor handles all edge cases (empty page, last block deleted, paste from external).
- [ ] Sidebar resize/collapse persists and behaves correctly at boundary values.
- [ ] Inline rename (sidebar) works with Enter to confirm and Escape to cancel.

**Visual:**
- [ ] Zero hardcoded color values — 100% CSS custom property usage.
- [ ] Custom scrollbars on every scrollable container.
- [ ] All transitions present and consistent per the audit table.
- [ ] `prefers-reduced-motion` respected.
- [ ] All empty states designed and implemented.
- [ ] Typography and line-height consistent across all surfaces.

**Accessibility:**
- [ ] Focus rings on all interactive controls, suppressed in editor content.
- [ ] Sidebar page list keyboard-navigable.
- [ ] All menus keyboard-navigable.
- [ ] Modal focus trapping correct.
- [ ] Key ARIA labels in place.
- [ ] `F2` / `Enter` to rename from sidebar keyboard focus.

**Performance:**
- [ ] App interactive within 2s on 500-page database.
- [ ] Page with 200 blocks renders within 500ms.
- [ ] Search updates within 100ms.
- [ ] WAL mode and cache size pragmas confirmed active.
- [ ] No memory leaks on page navigation (editor instances destroyed).

**Error Handling:**
- [ ] Toast system implemented and consistent (4 variants, correct auto-dismiss, max 3 stacked).
- [ ] Every IPC call has an error handler with appropriate toast.
- [ ] All IPC handlers follow the `{ success, data/error }` pattern.
- [ ] DB init failure shows native dialog and exits gracefully.
- [ ] Malformed block content renders a placeholder, not a crash.
- [ ] Missing attachment file renders a placeholder, not a crash.

**Code Quality:**
- [ ] TypeScript strict mode enabled, no `any` in shared types.
- [ ] IPC channel naming consistent (`namespace:method`).
- [ ] Zustand store organized and free of circular action calls.

**Regression:**
- [ ] All Phase 01–04 DoD items verified passing.

---

## What NOT to Do in Phase 04b

- No new features of any kind.
- No schema changes beyond what's required to fix a bug.
- No new IPC methods beyond what's needed for error handling patterns.
- Do not start Phase 05 work (tabs, split view) — not even scaffolding.
- Do not implement the settings panel (Phase 06).
- Do not add full-text search (Phase 05+ scope).
- Do not refactor the editor library choice — if BlockNote or TipTap is causing problems, document them for a dedicated decision, do not silently swap mid-phase.
