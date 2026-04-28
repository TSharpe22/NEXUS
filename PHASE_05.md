# PHASE 05 — Tabs and Split View

> This spec is the authoritative reference for Phase 05. Read PROJECT.md, PHASE_01.md through PHASE_04.md first. Do not deviate from decisions made here.

---

## Objective

Transform Nexus from a single-page editor into a multi-pane workspace. Phase 05 delivers: a browser-style tab system (with pinned persistent tabs and session-only regular tabs), a split view system supporting up to a 2×2 grid of independent panes, and each pane maintaining its own independent tab bar. The sidebar remains global — it is not per-pane.

---

## Stack Notes

No changes to the core stack.

**New dependencies:**

| Package | Purpose | Condition |
|---------|---------|-----------|
| `react-resizable-panels` | Resizable split pane dividers | Preferred — battle-tested, accessible, works with Tailwind |

No other new dependencies. Tab state is Zustand. Pane layout is React component state persisted to localStorage or a `workspace` settings table.

---

## 1. Mental Model

**Tabs** are per-pane. Each pane has its own tab bar. A tab is a reference to a page (or the Dashboard). Opening a page creates a tab in the focused pane.

**Panes** are the split view containers. A pane holds a tab bar and renders whichever tab is active within it.

**The sidebar** is global — it always shows all pages regardless of how many panes are open. Clicking a page in the sidebar opens it in the currently focused pane.

**Pinned tabs** persist across sessions. Regular tabs are session-only and are gone on app restart.

---

## 2. Tab System

### 2.1 Tab Bar Layout

The tab bar sits between the global sidebar and the editor content area — above the editor, not spanning the full window. Each pane has its own tab bar directly above its editor area.

```
┌────────────┬─────────────────────────────────────────────────┐
│            │  [📝 Page A] [📄 Page B ×] [+ New Tab]         │  ← Pane 1 tab bar
│  Sidebar   ├─────────────────────────────────────────────────┤
│  (global)  │                                                 │
│            │              Pane 1 Editor                      │
│            │                                                 │
│            ├─────────────────────────────────────────────────┤
│            │  [📘 Page C 📌] [📄 Page D ×] [+ New Tab]      │  ← Pane 2 tab bar
│            ├─────────────────────────────────────────────────┤
│            │                                                 │
│            │              Pane 2 Editor                      │
│            │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

### 2.2 Tab Anatomy

Each tab displays:
- Page icon (emoji or default) — 14px
- Page title — truncated with ellipsis at ~160px max width
- Pin indicator 📌 (small, right of title) — only on pinned tabs
- Close button (×) — appears on hover for regular tabs; not present on pinned tabs (must unpin first)
- Active tab: distinct background (`--bg-elevated`), full opacity text
- Inactive tab: `--bg-surface` background, `--text-secondary` text
- Hover: `--bg-hover` background
- Unsaved indicator: a small dot (●) left of the title when there are pending unsaved changes — same as VS Code's model

### 2.3 Tab Behavior

**Opening a tab:**
- Clicking a page in the sidebar opens it in a new tab in the focused pane, unless that page is already open in that pane (in which case, activate the existing tab).
- `Cmd+T` opens a new blank tab in the focused pane showing the empty state / Dashboard.
- `Cmd+Click` on a sidebar page opens it in a new tab without switching focus to it (background tab).

**Closing a tab:**
- Click the × button on a regular tab, or `Cmd+W`.
- Pinned tabs have no × — right-click → "Unpin" to convert to regular, then close.
- If closing the last tab in a pane: the pane shows the empty state ("Open a page or press Cmd+T").
- If the closed tab had unsaved changes: show a confirmation dialog — "Discard changes?" with "Save" / "Discard" / "Cancel".

**Reordering tabs:**
- Tabs are drag-and-drop reorderable within the same pane's tab bar.
- Dragging a tab to a different pane's tab bar moves it to that pane.
- Drop indicator: a vertical blue line between tabs while dragging.

**Tab overflow:**
- When tabs exceed the tab bar width, the bar becomes horizontally scrollable (no tab wrapping).
- A small overflow chevron (›) appears at the right edge when there are hidden tabs. Clicking it shows a dropdown list of all tabs in that pane.

### 2.4 Pinned Tabs

- Right-click a tab → "Pin Tab". The tab moves to the left of the tab bar, icon-only (no title, no close button). Tooltip on hover shows the full title.
- Pinned tabs persist to the `workspace` settings table and are restored on launch.
- Max pinned tabs per pane: 8 (after that, pin action is disabled with a tooltip "Maximum pinned tabs reached").
- Pinned tabs are always in the leftmost positions in the tab bar, left of all regular tabs.

### 2.5 Tab Persistence

**Session tabs**: stored only in Zustand memory. Gone on app close.
**Pinned tabs**: stored in a `workspace` table in SQLite (see Section 5 — Schema).

On launch:
1. Restore all pane configurations from the `workspace` table.
2. Restore pinned tabs per pane.
3. Regular tabs from the previous session are not restored.
4. Each pane with only pinned tabs activates the first pinned tab.
5. Each pane with no pinned tabs shows the empty state or Dashboard (user preference — see Phase 06).

### 2.6 Tab Context Menu (Right-Click)

| Action | Behavior |
|--------|----------|
| Pin Tab | Converts to pinned, moves to left |
| Unpin Tab | Converts pinned to regular |
| Close Tab | Closes this tab |
| Close Other Tabs | Closes all tabs in this pane except this one |
| Close Tabs to the Right | Closes all tabs to the right of this one |
| Duplicate Tab | Opens the same page in a new tab in this pane |
| Move to Pane → | Submenu: move this tab to another open pane |
| Open in New Pane | Splits current pane and opens this page in the new pane |

---

## 3. Split View

### 3.1 Pane Layout Model

The editor area can be split into up to **4 panes in a 2×2 grid**. Panes are always rectangular — no arbitrary tree splits.

**Valid configurations:**

```
1 pane (default):
┌───────┐

2 panes vertical:
┌───┬───┐

2 panes horizontal:
┌───────┐
├───────┤

3 panes (L-shape, two variants):
┌───┬───┐    ┌───┬───┐
├───┘   │    │   └───┤
│       │    │       │
(not supported — too complex)

3 panes (row):
┌───┬───┬───┐
(supported)

4 panes (2×2):
┌───┬───┐
├───┼───┤
```

**Supported configurations:** 1 pane, 2 vertical, 2 horizontal, 3 in a row (horizontal), 4 in a 2×2 grid. Arbitrary tree splits are not supported.

### 3.2 Creating Splits

- `Cmd+\` — split focused pane vertically (left/right). If already at max, do nothing.
- `Cmd+Shift+\` — split focused pane horizontally (top/bottom).
- Right-click tab → "Open in New Pane" — splits the focused pane and opens the page in the new pane.
- Command palette → "Split Pane Vertically" / "Split Pane Horizontally".

### 3.3 Closing Panes

- When a pane has no tabs remaining (all closed), it collapses automatically.
- `Cmd+Shift+W` — close the focused pane entirely (all its tabs close, with unsaved-change checks).
- If only one pane remains, closing it is disabled.

### 3.4 Pane Focus

- Click anywhere inside a pane to focus it. The focused pane has a subtle accent border on its tab bar (1px `--accent` at 30% opacity).
- `Cmd+Option+Arrow` (macOS) / `Ctrl+Alt+Arrow` (Linux) — move focus to the adjacent pane in that direction.
- The focused pane is where sidebar clicks, `Cmd+T`, and `Cmd+N` open content.

### 3.5 Resizing Panes

- Panes are separated by a draggable divider (8px hit area, 1px visible line using `--border-subtle`).
- Drag the divider to resize. Minimum pane width: 300px. Minimum pane height: 200px.
- Double-click a divider to reset panes to equal size.
- Pane size ratios are persisted to the `workspace` table.

### 3.6 Pane Empty State

When a pane has no open tabs, it shows a centered empty state:
- Icon: a subtle grid/split icon in `--text-tertiary`
- Text: "Open a page from the sidebar, or press Cmd+T"
- A small "Close Pane" button below (unless it's the last pane)

---

## 4. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+T` | New tab in focused pane |
| `Cmd+W` | Close active tab in focused pane |
| `Cmd+1` through `Cmd+9` | Jump to tab N in focused pane (`Cmd+9` = last tab) |
| `Cmd+Shift+]` | Next tab in focused pane |
| `Cmd+Shift+[` | Previous tab in focused pane |
| `Cmd+\` | Split focused pane vertically |
| `Cmd+Shift+\` | Split focused pane horizontally |
| `Cmd+Shift+W` | Close focused pane |
| `Cmd+Option+→` | Focus pane to the right |
| `Cmd+Option+←` | Focus pane to the left |
| `Cmd+Option+↑` | Focus pane above |
| `Cmd+Option+↓` | Focus pane below |

All prior phase shortcuts remain unchanged.

---

## 5. Schema — workspace Table

One new SQLite table to persist pane layout and pinned tabs.

```sql
CREATE TABLE workspace (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

This is a simple key-value store for workspace state. Values are JSON strings.

**Keys used in Phase 05:**

| Key | Value (JSON) | Description |
|-----|-------------|-------------|
| `pane_layout` | `{ "config": "2v", "sizes": [0.5, 0.5] }` | Current split configuration and size ratios |
| `pane_pinned_tabs` | `{ "pane_0": ["page_id_1", "page_id_2"], "pane_1": ["page_id_3"] }` | Pinned tab page IDs per pane |
| `focused_pane` | `"pane_0"` | Which pane was focused at last close |

**`config` values:** `"1"` (single), `"2v"` (two vertical), `"2h"` (two horizontal), `"3h"` (three horizontal), `"4"` (2×2 grid).

No migration risk — this is a new table. Create it on startup with `CREATE TABLE IF NOT EXISTS workspace`.

---

## 6. Zustand State

```typescript
interface PaneTab {
  id: string;            // unique tab instance ID
  pageId: string;        // the page this tab displays
  isPinned: boolean;
  isUnsaved: boolean;
}

interface Pane {
  id: string;            // e.g. "pane_0"
  tabs: PaneTab[];
  activeTabId: string | null;
}

interface WorkspaceState {
  panes: Pane[];
  focusedPaneId: string;
  splitConfig: '1' | '2v' | '2h' | '3h' | '4';
  paneSizes: number[];   // ratios, e.g. [0.5, 0.5]

  // Actions
  openPageInPane(pageId: string, paneId?: string): void;
  openPageInNewTab(pageId: string, paneId?: string): void;
  closeTab(paneId: string, tabId: string): void;
  activateTab(paneId: string, tabId: string): void;
  pinTab(paneId: string, tabId: string): void;
  unpinTab(paneId: string, tabId: string): void;
  moveTabToPane(tabId: string, fromPaneId: string, toPaneId: string): void;
  reorderTabs(paneId: string, fromIndex: number, toIndex: number): void;
  splitPane(paneId: string, direction: 'vertical' | 'horizontal'): void;
  closePane(paneId: string): void;
  focusPane(paneId: string): void;
  resizePanes(sizes: number[]): void;
  persistWorkspace(): Promise<void>;  // writes to workspace table via IPC
  restoreWorkspace(): Promise<void>;  // reads from workspace table on launch
}
```

---

## 7. IPC Additions

```typescript
interface NexusAPI {
  // ... existing methods ...

  workspace: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    getAll(): Promise<Record<string, string>>;
  };
}
```

Simple key-value IPC over the `workspace` table. Workspace state is saved:
- On tab pin/unpin
- On pane close
- On app close (via Electron `before-unload` / `will-quit` hook)
- On pane resize end (debounced 1s after drag ends — not on every px change)

---

## 8. Visual Design

**Tab bar:**
- Height: 36px. Compact — tabs are not chunky browser tabs.
- Tab border-radius: 6px top corners only (tabs sit on the editor area).
- Active tab has no bottom border (visually merges with editor area below it).
- Tab bar background: `--bg-surface`. Active tab: `--bg-elevated`.
- Divider between tab bar and editor: `--border-subtle` 1px line.
- The `+` New Tab button: small, icon-only, `--text-tertiary`, brightens on hover.

**Split dividers:**
- Visible line: 1px `--border-subtle`.
- Hit area: 8px (4px each side of the line).
- Hover: divider line brightens to `--border-default`, cursor changes to resize cursor.
- Dragging: accent color (`--accent` at 40% opacity) for the active divider line.

**Pane focus indicator:**
- Focused pane tab bar has a 1px top border in `--accent` at 30% opacity.
- Unfocused panes are subtly dimmed: tab bar text at `--text-tertiary`.

**Tab drag ghost:**
- While dragging a tab, show a ghost at 80% opacity following the cursor.
- Drop indicator between tabs: 2px vertical accent-colored line.
- Drop indicator on a different pane's tab bar: highlight the entire tab bar with `--accent-muted` background.

---

## 9. Definition of Done

Phase 05 is complete when:

**Tabs:**
- [ ] Tab bar appears above each pane's editor area.
- [ ] Opening a page from the sidebar creates a tab in the focused pane.
- [ ] Clicking an already-open page activates its existing tab (no duplicates).
- [ ] `Cmd+T` opens a new tab showing empty state.
- [ ] `Cmd+W` closes the active tab (with unsaved-change confirmation if needed).
- [ ] `Cmd+1` through `Cmd+9` jump to specific tabs in focused pane.
- [ ] `Cmd+Shift+]` / `Cmd+Shift+[` cycle through tabs.
- [ ] Tabs are drag-and-drop reorderable within a pane.
- [ ] Dragging a tab to a different pane's tab bar moves it to that pane.
- [ ] Overflow tabs: horizontal scroll + overflow chevron dropdown.
- [ ] Unsaved indicator (dot) appears when a tab has pending changes.
- [ ] Tab context menu works (all 8 actions).
- [ ] Pinned tabs: pin via right-click, icon-only display, no close button, persist across sessions.
- [ ] Pinned tabs restored on app launch.
- [ ] Session tabs are cleared on app close (not restored next launch).
- [ ] `Cmd+Click` on sidebar page opens background tab.

**Split View:**
- [ ] `Cmd+\` splits focused pane vertically.
- [ ] `Cmd+Shift+\` splits focused pane horizontally.
- [ ] Up to 4 panes (2×2 grid) supported.
- [ ] Each pane has an independent tab bar.
- [ ] Pane focus: click to focus, accent indicator visible on focused pane.
- [ ] `Cmd+Option+Arrow` moves focus between panes.
- [ ] Pane dividers are draggable and resize panes.
- [ ] Double-click divider resets to equal pane sizes.
- [ ] Minimum pane size enforced (300px width, 200px height).
- [ ] Closing last tab in a pane shows pane empty state.
- [ ] `Cmd+Shift+W` closes the focused pane.
- [ ] Pane layout and sizes persist across sessions.
- [ ] "Open in New Pane" from tab context menu works.

**General:**
- [ ] Workspace state (pinned tabs, pane layout, sizes) persists to SQLite `workspace` table.
- [ ] Workspace is restored correctly on app launch.
- [ ] No regressions in Phase 01–04 functionality.
- [ ] No crashes, no data loss, no unhandled errors in console.

---

## What NOT to Build in Phase 05

- No per-pane sidebar (sidebar is always global).
- No tab groups or color-coded tab categories.
- No floating/detached panes or secondary windows.
- No tab session history (back/forward navigation between pages is a future feature).
- No synchronized scrolling between split panes.
- No "zen mode" or distraction-free view (Phase 06+ scope).
- No tab search or tab switcher overlay beyond `Cmd+1-9`.
