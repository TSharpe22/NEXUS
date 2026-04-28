# PHASE 06 — Dashboard + Themes and Aesthetics

> This spec is the authoritative reference for Phase 06. Read PROJECT.md and PHASE_01.md through PHASE_05.md first. Do not deviate from decisions made here.

---

## Objective

Phase 06 delivers two things: a customizable Dashboard that serves as Nexus's home screen on launch, and the full theming system (light mode, accent colors, font selection). These are paired because the Dashboard is the most visible surface in the app — it makes no sense to build it before the theme system exists, and both touch every visual layer simultaneously.

---

## Stack Notes

No changes to the core stack.

**New dependencies:**

| Package | Purpose | Condition |
|---------|---------|-----------|
| `@dnd-kit/core` + `@dnd-kit/sortable` | Widget drag-and-drop on Dashboard | Preferred — already consistent with editor drag patterns |
| `react-grid-layout` | Alternative if `@dnd-kit` is insufficient for free-form grid placement | Evaluate — prefer `@dnd-kit` first |

Font loading: embed Inter (body) and JetBrains Mono (code) as local assets — no Google Fonts CDN request. Fonts ship with the app.

---

## Part A — Dashboard

### A.1 What the Dashboard Is

The Dashboard is the default home screen. It is not a regular page — it cannot be deleted, renamed, or moved to trash. It is a special view that appears:
- On app launch (before any page is opened)
- When `Cmd+T` opens a new tab with no prior context
- When the user clicks the Nexus logo / home button in the sidebar header

The Dashboard can be **replaced as the launch screen** by any page: right-click any page in the sidebar → "Set as Home". When a custom home is set, that page opens on launch instead. The Dashboard remains accessible via the sidebar home button or command palette → "Open Dashboard".

### A.2 Widget System

The Dashboard is a **free-form grid** of widgets. Widgets are draggable and resizable by the user. Layout is persisted.

**Grid model:**
- Implicit grid: 12 columns, rows auto-sized to widget content.
- Widgets snap to grid on drop (no pixel-perfect free placement — grid-snapped).
- Each widget has a minimum size (varies per widget — defined below).
- Widgets can overlap only if the user explicitly forces it (drag with `Alt` held) — by default, they push aside on drop.

**Widget chrome:**
- On hover, each widget reveals a drag handle (⠿) in the top-left corner and a settings icon (⚙) in the top-right corner.
- Settings icon opens a small popover to configure that widget (e.g. change title, adjust item count).
- A remove button (×) appears in the top-right corner on hover, inside the settings popover — not directly visible to prevent accidental removal.
- Widget container: `--bg-surface` background, 8px border-radius, 1px `--border-subtle` border, subtle shadow.

**Adding widgets:**
- A `+ Add Widget` button in the top-right corner of the Dashboard opens a widget picker panel (slides in from the right, ~280px wide). The panel lists all available widgets as cards. Click to add to the Dashboard.
- Each widget type can be added multiple times (e.g. two Recent Pages widgets with different settings).

### A.3 Widget Catalog (Phase 06)

#### Widget 1 — Recent Pages

Shows the N most recently edited non-deleted pages.

- Default size: 4 columns × auto height
- Min size: 3 columns
- Configurable: N (5 / 10 / 20 items), show icon (on/off), show timestamp (on/off)
- Each item: icon + title + relative timestamp ("3m ago", "Yesterday")
- Click to open the page in the current pane

#### Widget 2 — Pinned Pages

Shows pages the user has explicitly pinned to the Dashboard. Different from pinned tabs — these are page-level pins.

- Default size: 3 columns × auto height
- Min size: 2 columns
- Pin a page: right-click any page in the sidebar → "Pin to Dashboard"
- Each item: icon + title. No timestamp.
- Empty state: "Right-click any page in the sidebar to pin it here."
- Reorderable within the widget via drag

#### Widget 3 — Quick Capture

An inline note-creation widget. Type and press Enter to create a new page instantly.

- Default size: 4 columns × 1 row (fixed height — this is a compact input, not an editor)
- Min size: 3 columns
- Behavior: a text input with a placeholder ("Capture a thought..."). Press Enter → creates a new page with the typed text as the title, opens it in a new tab. The input clears after creation.
- Optional: a small icon picker to set the new page's icon before creating (click the 📝 icon left of the input to change it)
- This is title-only capture — not a block editor. Full editing happens after the page is created and opened.

#### Widget 4 — Stats

Shows aggregate counts about the user's knowledge base.

- Default size: 3 columns × 1 row (fixed compact height)
- Min size: 2 columns
- Stats displayed (always, no configuration):
  - Total pages (non-deleted)
  - Total words (approximate — sum of all block content text length / 5)
  - Pages created this week
  - Pages edited today
- Layout: 4 stat cells in a 2×2 grid within the widget, each showing a number and label
- Numbers animate (count up) on Dashboard load — 600ms ease-out

### A.4 Dashboard Persistence

Widget layout is stored in the `workspace` table (established in Phase 05) using new keys:

| Key | Value (JSON) | Description |
|-----|-------------|-------------|
| `dashboard_widgets` | Array of widget config objects | Widget types, positions, sizes, settings |
| `dashboard_home_page_id` | `"page_id"` or `null` | Custom launch page, null = Dashboard |

**Widget config object:**
```json
{
  "id": "widget_instance_uuid",
  "type": "recent_pages",
  "grid_x": 0,
  "grid_y": 0,
  "grid_w": 4,
  "grid_h": 2,
  "settings": {
    "count": 10,
    "show_icon": true,
    "show_timestamp": true
  }
}
```

### A.5 Dashboard IPC

No new IPC methods needed for the Dashboard itself. Widget data is assembled from existing IPC:
- Recent Pages: `pages.getAll()` sorted by `updated_at` descending, limit N.
- Pinned Pages: a new field on the `pages` table (see schema below).
- Stats: a new IPC method.

**New IPC:**
```typescript
interface NexusAPI {
  // ... existing ...

  pages: {
    // ... existing ...
    setPinnedToDashboard(id: string, pinned: boolean): Promise<void>;
    getDashboardPinned(): Promise<Page[]>;
  };

  stats: {
    getWorkspaceStats(): Promise<WorkspaceStats>;
  };
}

interface WorkspaceStats {
  totalPages: number;
  totalWords: number;      // approximate
  pagesThisWeek: number;
  pagesToday: number;
}
```

**Schema addition — `pages` table:**
```sql
ALTER TABLE pages ADD COLUMN is_dashboard_pinned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_pages_dashboard_pinned ON pages(is_dashboard_pinned);
```

Safe migration: `ALTER TABLE ADD COLUMN` with a default. Run on startup with existence check.

---

## Part B — Themes and Aesthetics

### B.1 Theme System Architecture

All colors, radii, spacing, and font families are CSS custom properties (established in Phase 02). Phase 06 makes these dynamic — the active theme sets a different token set. No CSS-in-JS, no runtime injection of stylesheets. The `:root` custom properties are updated via a `data-theme` attribute on `<html>` and a `data-accent` attribute for accent color.

```html
<html data-theme="dark" data-accent="blue" data-font="inter">
```

CSS:
```css
[data-theme="dark"] { --bg-base: #1a1a1f; ... }
[data-theme="light"] { --bg-base: #f5f5f7; ... }
[data-accent="blue"] { --accent: #6b8afd; --accent-hover: #8ba2fd; --accent-muted: rgba(107,138,253,0.12); }
[data-accent="purple"] { --accent: #9b7afd; ... }
```

This approach means: zero runtime JS for theme switching, instant switch with no flash, full CSS cascade preserved.

### B.2 Themes

**Dark (default):** The refined dark palette from Phase 02. This is the baseline — no changes to it.

**Light theme:**

```css
[data-theme="light"] {
  --bg-base:        #f0f0f5;
  --bg-surface:     #fafafa;
  --bg-elevated:    #ffffff;
  --bg-hover:       #ebebf0;
  --bg-active:      #e0e0e8;

  --text-primary:   #1a1a2e;
  --text-secondary: #5a5a72;
  --text-tertiary:  #9898b0;

  --border-subtle:  #dcdce8;
  --border-default: #c8c8d8;
}
```

**System (auto):** Follows `prefers-color-scheme`. Uses the Dark or Light token set accordingly. Switches automatically when the OS theme changes (listen to `window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ...)`).

### B.3 Accent Colors

6 accent options. All tested for legibility on both dark and light backgrounds.

| Name | Hex | Description |
|------|-----|-------------|
| Blue (default) | `#6b8afd` | Current default |
| Purple | `#9b7afd` | Softer violet |
| Teal | `#4db6ac` | Muted teal |
| Green | `#5cb85c` | Muted green |
| Rose | `#e06c75` | Muted red-pink |
| Amber | `#d4a853` | Warm amber |

Each accent color has three variants defined in CSS: `--accent`, `--accent-hover` (+15% lightness), `--accent-muted` (base at 12% opacity).

**Selection UI:** In Settings, show 6 color swatches. Active swatch has a subtle ring outline (`--accent` colored border, 2px, 2px gap). No labels — the color is self-evident.

### B.4 Typography

**Body font options (3):**

| Name | Stack | Character |
|------|-------|-----------|
| Inter (default) | Inter, system-ui, sans-serif | Clean, modern, readable |
| SF Pro / System | -apple-system, BlinkMacSystemFont, system-ui | Native OS feel |
| Serif | Georgia, 'Times New Roman', serif | Long-form writing feel |

**Code font:** Always JetBrains Mono. Not user-selectable in Phase 06. This is a deliberate decision — code should be consistent.

**Font size:** A global base font size slider in Settings. Range: 13px–18px, default 15px. All font sizes in the app use `rem` units relative to this base. Changing it scales everything proportionally.

```css
html { font-size: var(--base-font-size, 15px); }
```

### B.5 Settings Panel

Phase 06 introduces the **Settings panel** — a modal overlay (not a separate window) triggered by:
- `Cmd+,` (macOS standard)
- Command palette → "Open Settings"
- Sidebar footer: a small gear icon

**Settings panel layout:**
```
┌─────────────────────────────────────────────────────┐
│  Settings                                      [×]  │
├──────────────┬──────────────────────────────────────┤
│  Appearance  │  Theme                               │
│  Editor      │  ○ Dark   ○ Light   ○ System         │
│  Shortcuts   │                                      │
│  About       │  Accent Color                        │
│              │  ● ○ ○ ○ ○ ○  (6 swatches)          │
│              │                                      │
│              │  Font                                │
│              │  ○ Inter  ○ System  ○ Serif          │
│              │                                      │
│              │  Font Size                           │
│              │  [────●────────] 15px                │
└──────────────┴──────────────────────────────────────┘
```

**Settings sections (Phase 06 scope):**

- **Appearance:** Theme, Accent Color, Font, Font Size
- **Editor:** Default page width (Narrow / Default / Wide / Full), Auto-save delay (300ms / 500ms / 1000ms)
- **Shortcuts:** Read-only reference table of all keyboard shortcuts (no rebinding in Phase 06)
- **About:** App version, build date, open-source licenses link (placeholder)

**Persistence:** Settings stored in the `workspace` table:

| Key | Value |
|-----|-------|
| `theme` | `"dark"` \| `"light"` \| `"system"` |
| `accent_color` | `"blue"` \| `"purple"` \| `"teal"` \| `"green"` \| `"rose"` \| `"amber"` |
| `font_family` | `"inter"` \| `"system"` \| `"serif"` |
| `font_size` | `"15"` (number as string) |
| `default_page_width` | `"default"` \| `"narrow"` \| `"wide"` \| `"full"` |
| `autosave_delay` | `"500"` |

Settings are loaded on app startup and applied before the first render (no flash of unstyled content). Apply them in the Electron `preload` script or via a `<script>` tag injected into `index.html` that reads from localStorage as a fast bootstrap, then syncs from SQLite.

### B.6 Cyberpunk / Batcomputer Theme (Placeholder)

Per the project vision, a cyberpunk/dark-tech theme toggle is planned. **Do not implement it in Phase 06.** However:

- Reserve a `data-theme="cyberpunk"` slot in the CSS.
- Add a placeholder "Cyberpunk (Coming Soon)" entry in the theme selector that is visually present but disabled (grayed out, with a "soon" badge).
- This signals the feature is planned without shipping half-finished work.

---

## Keyboard Shortcuts (Phase 06 Additions)

| Shortcut | Action |
|----------|--------|
| `Cmd+,` | Open Settings |
| `Cmd+Shift+D` | Open Dashboard (navigate to Dashboard in focused pane) |

All prior phase shortcuts remain unchanged.

---

## Zustand State Additions

```typescript
interface SettingsState {
  theme: 'dark' | 'light' | 'system';
  accentColor: 'blue' | 'purple' | 'teal' | 'green' | 'rose' | 'amber';
  fontFamily: 'inter' | 'system' | 'serif';
  fontSize: number;  // 13–18
  defaultPageWidth: 'narrow' | 'default' | 'wide' | 'full';
  autosaveDelay: 300 | 500 | 1000;

  // Actions
  setTheme(theme: SettingsState['theme']): void;
  setAccentColor(color: SettingsState['accentColor']): void;
  setFontFamily(font: SettingsState['fontFamily']): void;
  setFontSize(size: number): void;
  persistSettings(): Promise<void>;
}

interface DashboardState {
  widgets: WidgetConfig[];
  homePageId: string | null;  // null = Dashboard is home

  // Actions
  addWidget(type: WidgetType): void;
  removeWidget(id: string): void;
  updateWidgetLayout(id: string, layout: GridLayout): void;
  updateWidgetSettings(id: string, settings: Partial<WidgetSettings>): void;
  setHomePage(pageId: string | null): void;
  persistDashboard(): Promise<void>;
}
```

---

## Definition of Done

Phase 06 is complete when:

**Dashboard:**
- [ ] Dashboard is the default home screen on launch.
- [ ] Dashboard opens in a new tab when `Cmd+T` has no prior context.
- [ ] Sidebar home button / Nexus logo navigates to the Dashboard.
- [ ] Dashboard is not deletable, not renamable, not in the page list.
- [ ] Recent Pages widget shows N most recently edited pages, click to open.
- [ ] Pinned Pages widget shows user-pinned pages; right-click sidebar page → "Pin to Dashboard" works.
- [ ] Quick Capture widget: type title, Enter creates a page, opens it, clears input.
- [ ] Stats widget: shows total pages, total words, pages this week, pages today — with count-up animation.
- [ ] Widgets are drag-and-drop repositionable on the Dashboard grid.
- [ ] Widgets are resizable (grid-snapped).
- [ ] Widget settings popover works (count, show icon/timestamp for Recent Pages).
- [ ] Widget remove works (via settings popover × button).
- [ ] `+ Add Widget` button opens the widget picker panel.
- [ ] Dashboard layout persists across sessions.
- [ ] Any page can be set as launch home ("Set as Home" in sidebar right-click).
- [ ] Custom home page is restored on next launch.
- [ ] `Cmd+Shift+D` always opens the Dashboard regardless of home setting.

**Themes:**
- [ ] Dark theme: unchanged from Phase 02 baseline.
- [ ] Light theme: all surfaces, text, borders correctly mapped.
- [ ] System theme: follows OS preference, updates live when OS switches.
- [ ] Theme switch is instant — no flash, no transition delay.
- [ ] 6 accent colors available and applied globally (buttons, links, active states, focus rings).
- [ ] Accent color updates immediately on selection.
- [ ] 3 font family options apply globally to body text.
- [ ] Font size slider (13–18px) scales the entire UI proportionally.
- [ ] Code blocks always use JetBrains Mono regardless of font setting.
- [ ] Cyberpunk placeholder entry visible but disabled in theme selector.

**Settings Panel:**
- [ ] `Cmd+,` opens the Settings modal.
- [ ] Settings modal has 4 sections: Appearance, Editor, Shortcuts, About.
- [ ] All Appearance settings functional (theme, accent, font, size).
- [ ] Editor settings functional (default page width, autosave delay).
- [ ] Shortcuts section shows a complete, accurate reference table.
- [ ] All settings persist across sessions (stored in `workspace` table).
- [ ] Settings applied on startup with no flash.
- [ ] `Escape` and × button close the Settings modal.

**General:**
- [ ] `is_dashboard_pinned` migration runs safely on existing databases.
- [ ] No regressions in Phase 01–05 functionality.
- [ ] No crashes, no data loss, no unhandled errors in console.

---

## What NOT to Build in Phase 06

- No cyberpunk/Batcomputer theme implementation (placeholder only).
- No arbitrary color picker for accent (curated 6 only).
- No third-party theme import/export.
- No per-page theme overrides.
- No keyboard shortcut rebinding.
- No plugin or extension system.
- No calendar widget on Dashboard (no calendar in v1).
- No activity heatmap widget (defer — needs richer event logging).
- No Dashboard sharing or export.
- No widget animation beyond the stats count-up.
