# PHASE 02 — Block-Based Editing + Polish

> This spec is the authoritative reference for Phase 02. Read PROJECT.md and PHASE_01.md first. Do not deviate from decisions made here.

---

## Objective

Elevate Nexus from a functional note app to one that feels like a real tool. Phase 02 delivers: drag-and-drop block reordering, column layouts (up to 4 columns), three new block types (Toggle, Callout, Table), text highlighting, a unified context menu (right-click + slash), and a visual polish pass across the entire UI to eliminate harsh colors and rough edges.

**No new schema changes.** The blocks table from Phase 01 already supports all block types and parent/child nesting needed for columns and toggles. This phase is pure editor and UI work.

**Markdown editor is out of scope.** The original roadmap paired it with this phase, but the editor already renders beautifully in WYSIWYG — a source/markdown mode adds no value right now. Defer to a later phase if ever needed.

---

## Stack Notes

No new dependencies unless stated. The editor library chosen in Phase 01 (BlockNote or raw TipTap) continues. If BlockNote cannot support columns or the context menu requirements below, this is the phase where you drop to raw TipTap. Document the decision.

**Potential new dependencies:**

| Package | Purpose | Condition |
|---------|---------|-----------|
| `@tiptap/extension-highlight` | Text highlight marks | Only if using raw TipTap |
| `@tiptap/extension-color` | Text color marks | Only if using raw TipTap |
| `@tiptap/extension-table` | Table block support | Only if using raw TipTap |

If using BlockNote, check if its extension system covers these natively before adding TipTap extensions directly.

---

## 1. Drag-and-Drop Block Reordering

### Behavior

- Every block shows a **drag handle** (⠿ grip icon) on hover, left of the block.
- Drag a block vertically to reorder it within the page.
- Drag a block **horizontally to the side of another block** to create a column layout (see Section 2).
- While dragging, show a **drop indicator** — a horizontal blue line between blocks for vertical drops, a vertical blue line beside a block for column creation.
- On drop, update `sort_order` values. Use fractional indexing (midpoint between neighbors). If the page has accumulated too many fractional values (precision < 0.001 between adjacent blocks), reindex all blocks on that page sequentially (1.0, 2.0, 3.0...).

### Implementation Notes

- If BlockNote provides drag-and-drop out of the box, use it. Customize the drag handle styling to match Nexus aesthetics.
- If using TipTap, evaluate `@tiptap/extension-draggable` or implement via a custom `NodeView` wrapper that adds a drag handle and uses the HTML Drag and Drop API.
- Drag handle opacity: 0 at rest, fades in on block hover (150ms transition). Always visible on touch devices if relevant later.

---

## 2. Column Layouts

### Behavior

- **Max 4 columns.** A row can contain 1–4 blocks side by side.
- **Creating columns**: Drag a block to the left or right edge of another block. A vertical drop indicator appears. On drop, the two blocks become a column group.
- **Adding to columns**: Drag another block to the left/right edge of an existing column group to add a column (up to 4).
- **Removing columns**: If a column group has only one block left (others deleted or dragged out), it collapses back to a normal single block.
- **Resizing columns**: Columns within a group are resizable by dragging the divider between them. Default split is equal width. Persist column widths in the block content JSON.
- **Nesting**: A column can contain multiple blocks stacked vertically (paragraphs, lists, headings, etc.). A column cannot contain another column group — max one level of columns.

### Data Model

Columns are represented as a **parent block** of type `columnGroup` with children blocks. Each child is a `column` block, and each column contains the actual content blocks as its children.

```
columnGroup (parent)
├── column (child 1)
│   ├── paragraph
│   └── bulletList
├── column (child 2)
│   └── paragraph
└── column (child 3)
    ├── heading1
    └── callout
```

This nests naturally into the existing `blocks` table using `parent_block_id`. The `content` JSON of the `columnGroup` block stores layout metadata (column widths as ratios, e.g. `{"widths": [0.5, 0.25, 0.25]}`).

**Add to valid block types:** `columnGroup`, `column`. These are structural — they do not appear in the slash menu or block type picker. They are created only via drag interaction.

---

## 3. New Block Types

### 3.1 Toggle Block

A collapsible container. Click the triangle/chevron to expand or collapse nested content.

**Behavior:**
- Slash command: `/toggle`
- Renders as: ▶ (collapsed) or ▼ (expanded) chevron + a summary line of editable text.
- When expanded, shows nested child blocks indented below the summary.
- Child blocks inside a toggle can be any type (paragraph, list, code, another toggle, etc.).
- Toggle state (expanded/collapsed) is **ephemeral** — not saved to DB. All toggles start expanded on page load.
- Content inside a collapsed toggle is still searchable (Phase 01 search is title-only, but do not architecturally hide toggle content from future full-text search).

**Data model:** The toggle block is a parent. Its `content` JSON stores the summary text. Child blocks use `parent_block_id` pointing to the toggle's `id`.

**Keyboard:** Enter on the summary line creates a new block inside the toggle. Backspace on an empty summary with no children deletes the toggle. `Cmd+Shift+T` or a dedicated shortcut to toggle expand/collapse.

### 3.2 Callout Block

A visually distinct box for emphasis — tips, warnings, important notes.

**Behavior:**
- Slash command: `/callout`
- Renders as: A rounded box with a subtle background tint, a left accent border, and an icon (emoji) on the left.
- Default icon: 💡 (lightbulb). Clicking the icon opens an emoji picker to change it.
- Background color is one of a preset palette (6–8 muted colors: blue, green, yellow, red, purple, gray, teal, orange). User selects via the block's context menu or a small color dot in the callout header.
- Text inside the callout is rich text (bold, italic, etc.). A callout can contain multiple child blocks (paragraphs, lists) — not just a single line.
- Callout colors must be **muted and harmonious with the dark theme**. No saturated or neon backgrounds. Use low-opacity tints (e.g. `rgba(59, 130, 246, 0.08)` for blue) with a slightly more opaque left border.

**Data model:** `block_type: 'callout'`. `content` JSON stores `{"icon": "💡", "color": "blue"}`. Child blocks (the callout body) use `parent_block_id`.

### 3.3 Simple Table

An inline editable grid. Not a database view — just rows and columns of text.

**Behavior:**
- Slash command: `/table`
- Default: 3 columns × 2 rows (+ 1 header row). User can add/remove rows and columns.
- Header row is visually distinct (bold text, subtle background).
- Tab to move between cells. Enter to move to the next row.
- Hover on column/row edge shows a `+` button to add a column/row.
- Right-click on a cell shows: Insert Row Above, Insert Row Below, Insert Column Left, Insert Column Right, Delete Row, Delete Column, Delete Table.
- Cell content is plain text in Phase 02. Rich text in cells is a future enhancement.
- Minimum: 1 row, 1 column. No maximum enforced, but UI should handle up to ~10 columns and ~50 rows without layout issues.

**Data model:** `block_type: 'table'`. The entire table is stored as a single block. `content` JSON stores the table structure:

```json
{
  "rows": [
    { "cells": ["Name", "Role", "Status"], "isHeader": true },
    { "cells": ["Alice", "Engineer", "Active"] },
    { "cells": ["Bob", "Designer", "On Leave"] }
  ]
}
```

Tables do not use child blocks — the table is atomic. This keeps serialization simple and avoids per-cell block overhead.

---

## 4. Text Highlighting

### Behavior

- Select text → a floating toolbar appears (if not already present from Phase 01).
- The toolbar includes a **highlight button** (marker icon) with a dropdown for color selection.
- Available highlight colors: yellow, green, blue, pink, purple, orange, red, gray. These are **background highlights** on the selected text, not text color changes.
- Highlight colors must be muted and legible on the dark theme. Use low-opacity tints. Test readability.
- A separate **text color** option is also added to the toolbar: same color palette, applied as foreground `color` instead of `background-color`.
- Keyboard shortcut for default highlight (yellow): `Cmd+Shift+H`.
- Remove highlight: select highlighted text, click the highlight button, choose "None" / clear option.

### Implementation

- TipTap: Use `@tiptap/extension-highlight` (supports multi-color) and `@tiptap/extension-color`.
- BlockNote: Check if the built-in formatting toolbar supports custom marks. If not, extend it.
- Store as inline marks in the block's `content` JSON. The editor library handles this natively.

---

## 5. Context Menu (Right-Click)

### Behavior

Right-clicking on a block opens a context menu with two sections:

**Section 1 — Block Actions:**
| Action | Behavior |
|--------|----------|
| Delete | Remove the block |
| Duplicate | Clone the block below |
| Copy | Copy block content to clipboard |
| Cut | Cut block to clipboard |
| Move Up | Swap with block above |
| Move Down | Swap with block below |

**Section 2 — Transform To:**
| Option | Converts the block to... |
|--------|--------------------------|
| Paragraph | Default paragraph |
| Heading 1 | H1 |
| Heading 2 | H2 |
| Heading 3 | H3 |
| Bullet List | Unordered list |
| Numbered List | Ordered list |
| Checklist | Checkbox list |
| Quote | Block quote |
| Code Block | Code block |
| Callout | Callout block |
| Toggle | Toggle block |

The "Transform To" section shows the current block type as **highlighted/checked** so the user knows what it currently is.

**For Callout blocks specifically**, the context menu also includes a **Color** submenu showing the 6–8 callout color options.

### Visual Design

- The context menu is a floating panel with rounded corners, subtle shadow, and muted background — **not** the browser's native right-click menu.
- Grouped sections separated by a thin divider line.
- Each item has an icon on the left, label in the middle, keyboard shortcut on the right (where applicable).
- Appears at the cursor position. If it would overflow the viewport, reposition to stay visible.
- Dismiss on click outside, Escape, or selecting an item.

### Slash Menu Update

The slash menu (`/`) should use the **same visual component** as the context menu's "Transform To" section. They should look and feel identical. Unify the underlying component so menu styling is consistent app-wide.

---

## 6. Visual Polish Pass

This is not a theme system (that's Phase 06). This is fixing everything that looks harsh, default, or unfinished from Phase 01.

### Color Palette — Dark Theme Refinement

**Problem:** Phase 01 likely has stark whites, default browser grays, and high-contrast elements that feel raw.

**Solution:** Establish a refined dark color scale and apply it globally. All colors via CSS custom properties (already in place from Tailwind setup).

```css
:root {
  /* Backgrounds — layered, not flat */
  --bg-base:        #1a1a1f;    /* App background, deepest layer */
  --bg-surface:     #222228;    /* Sidebar, panels */
  --bg-elevated:    #2a2a32;    /* Cards, menus, dropdowns */
  --bg-hover:       #32323c;    /* Hover states on interactive elements */
  --bg-active:      #3a3a46;    /* Active/selected states */

  /* Text — never pure white */
  --text-primary:   #e8e8ed;    /* Main body text */
  --text-secondary: #9898a6;    /* Sidebar items, timestamps, labels */
  --text-tertiary:  #6a6a7a;    /* Placeholders, disabled text */

  /* Borders — barely visible, structural */
  --border-subtle:  #2e2e38;    /* Dividers, sidebar border */
  --border-default: #3a3a46;    /* Input borders, card outlines */

  /* Accent — used sparingly */
  --accent:         #6b8afd;    /* Primary accent (links, active indicators) */
  --accent-hover:   #8ba2fd;    /* Accent hover state */
  --accent-muted:   rgba(107, 138, 253, 0.12); /* Accent backgrounds */
}
```

These are starting values. Adjust during implementation to what looks right on screen. The principle: **low contrast between adjacent surfaces, high contrast for text on any background, color used sparingly and intentionally.**

### Specific Polish Targets

**Sidebar:**
- Page list items: reduce padding, tighten line height. The sidebar should feel dense but readable.
- Selected page: subtle left accent border or muted background — not a bright highlight bar.
- Hover: gentle background shift, not a color jump.
- Search field: muted border, slightly recessed look (`--bg-base` background inside `--bg-surface` sidebar).
- Trash section: dimmed text, separated by a subtle divider — not a bright button.
- Scrollbar: thin, muted, auto-hiding. Custom scrollbar CSS (`::-webkit-scrollbar`).

**Editor Area:**
- Page title: large but not oversized. Use a slightly warmer white than body text (e.g. `#f0f0f5`). No visible input border — it should look like a rendered heading until clicked.
- Block content: comfortable line height (1.6–1.7 for paragraphs). Max content width: 720px, centered in the editor area. Do not let text stretch to fill a 1920px-wide window.
- Code blocks: muted background (`--bg-elevated` or slightly darker), rounded corners, subtle left border. Do not use stark white or bright gray backgrounds.
- Block quote: left border using `--accent-muted`, italicized text, muted text color.
- Divider: thin, uses `--border-subtle`. Not a thick black line.

**Menus (Slash, Context, Command Palette):**
- Background: `--bg-elevated` with subtle border (`--border-default`).
- Shadow: soft, multi-layered (`box-shadow: 0 4px 24px rgba(0,0,0,0.3), 0 1px 4px rgba(0,0,0,0.2)`).
- Items: clear hover states, active item highlight with `--accent-muted` background.
- Icons: muted color (`--text-secondary`), not bright.
- Border radius: 8px on the menu itself, 4px on individual items.
- **Smooth entrance animation**: menus fade + slide in (opacity 0→1, translateY 4px→0, 120ms ease-out). No jarring pop-in.

**Empty States:**
- Centered, muted text with an icon or illustration.
- "No pages yet — press Cmd+N to create one" — not a wall of text.

**Save Indicator:**
- Tiny, positioned near the title or in the status bar.
- "Saving..." in `--text-tertiary`, fades to a checkmark + "Saved" in `--text-secondary`, then fades out after 2s.
- Should feel ambient, not attention-grabbing.

**Scrolling:**
- Sidebar and editor should scroll independently.
- Smooth scroll behavior on keyboard navigation (page up/down, arrow keys in sidebar).
- No visible scrollbar jump on content load.

### Typography

- Body text: 15–16px. System font stack or a curated font (Inter, SF Pro, or similar — embed one that's freely licensed if not using system fonts).
- Headings: H1 28–30px, H2 22–24px, H3 18–20px. Bold weight for all.
- Sidebar items: 13–14px.
- Code: 13–14px, monospace (JetBrains Mono, Fira Code, or system monospace).
- All font sizes via CSS custom properties for future theming.

---

## 7. Floating Toolbar Polish

The floating toolbar (appears on text selection) from Phase 01 needs refinement:

- Add: Highlight button (with color dropdown), Text Color button (with color dropdown).
- Existing: Bold, Italic, Underline, Strikethrough, Inline Code.
- Compact pill shape, rounded corners (8px), muted background.
- Appears above the selection with a small arrow/caret pointing down.
- Smooth fade-in (100ms).
- Does not obscure the selected text — repositions if needed.

---

## 8. Keyboard Shortcuts (Phase 02 Additions)

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+H` | Highlight selected text (default yellow) |
| `Cmd+Shift+T` | Toggle expand/collapse on a toggle block |
| `Cmd+D` | Duplicate current block |
| `Cmd+Shift+Backspace` | Delete current block |
| `Tab` (in table) | Move to next cell |
| `Shift+Tab` (in table) | Move to previous cell |
| `Enter` (in table) | Move to next row |

All Phase 01 shortcuts remain unchanged.

---

## 9. IPC Changes

No new IPC methods are required for Phase 02. All new block types use the existing `blocks.save(pageId, blocks)` method which persists the full block tree. The editor library serializes columns, toggles, callouts, and tables into the block JSON, and the existing save path handles it.

If performance becomes an issue with large pages (many blocks), consider adding a `blocks.saveSingle(pageId, block)` method for incremental updates — but do not implement this preemptively. Wait for a real problem.

---

## 10. Migration Notes

No SQLite schema migrations needed. The `block_type` column is free-text — new types (`columnGroup`, `column`, `callout`, `toggle`, `table`) are simply new values stored in existing rows. The `content` JSON column already accommodates arbitrary structure per block type.

If Phase 01 used an enum or validation on `block_type` in the application layer, update the allowed list to include the new types.

---

## Definition of Done

Phase 02 is complete when:

- [ ] Blocks are drag-and-drop reorderable via a visible drag handle.
- [ ] Dragging a block to the side of another creates a column layout.
- [ ] Column layouts support 2–4 columns with resizable dividers.
- [ ] Columns can be dissolved back to single blocks by dragging out.
- [ ] Toggle block works: expand/collapse, nested content, slash command.
- [ ] Callout block works: icon picker, color selection (6–8 muted colors), nested content, slash command.
- [ ] Table block works: add/remove rows and columns, tab navigation, header row, slash command.
- [ ] Text highlighting works with a color palette from the floating toolbar.
- [ ] Text color works with the same palette from the floating toolbar.
- [ ] Right-click on any block opens a context menu with block actions + transform type.
- [ ] Slash menu and context menu share the same visual component and styling.
- [ ] Menus animate smoothly on open (no jarring pop-in).
- [ ] Dark theme colors are refined — no stark whites, no harsh contrasts.
- [ ] All backgrounds use the layered `--bg-*` scale.
- [ ] Text uses the `--text-*` scale — no `#fff` or `#000` anywhere.
- [ ] Editor content area is max-width constrained and centered.
- [ ] Code blocks, quotes, and dividers are visually polished.
- [ ] Sidebar is visually tightened (density, hover states, scrollbar).
- [ ] Custom scrollbars (thin, muted, auto-hiding) on all scrollable areas.
- [ ] Typography is consistent and sized correctly across all elements.
- [ ] Save indicator is subtle and ambient.
- [ ] Empty states are polished.
- [ ] All new keyboard shortcuts work.
- [ ] No regressions in Phase 01 functionality.
- [ ] No crashes, no data loss, no unhandled errors in console.

---

## What NOT to Build in Phase 02

- No markdown source editor.
- No import/export (Phase 03).
- No bidirectional links (Phase 03).
- No image/file/embed blocks (Phase 04).
- No tabs or split view (Phase 05).
- No theme switcher or light mode (Phase 06) — only refine the existing dark theme.
- No rich text inside table cells (plain text only).
- No table sorting or filtering (that's data views, Phase 10).
- No drag-and-drop between pages (blocks stay within their page).
- No block comments or annotations.
