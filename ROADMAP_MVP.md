# NEXUS — Path to Daily Use

> Written after an audit of the codebase at commit `30bbe84`. This file supersedes the
> Phase 04–08 ordering in `PROJECT.md` for the purpose of getting Nexus into daily use.
> The original phase specs remain valid; several are deferred, not cancelled.
>
> Read `PROJECT.md` first, then this file, then the relevant `PHASE_XX.md`.

---

## 1. Where Nexus actually is

**Built and working:**

- Electron + electron-vite + React 18 + TypeScript shell.
- SQLite via better-sqlite3, WAL mode, foreign keys on. Tables: `types`, `pages`,
  `blocks`, `property_definitions`, `property_values`, `links`.
- BlockNote 0.24 editor: paragraphs, headings, lists, checklists, quotes, code,
  dividers, toggle, callout, table, multi-column.
- Slash menu, formatting toolbar, right-click block context menu, lasso multi-select.
- Bidirectional links (`[[` trigger) + backlinks panel.
- Import/export: Markdown, plain text, JSON — per page and whole-vault.
- Command palette (`Cmd+K`), sidebar with resize/collapse, trash with restore,
  auto-save with status indicator.

**Spec'd but not built:** Phase 04 (media embedding, web tabs), Phase 05 (tabs +
split view), Phase 06 (dashboard + themes).

**In the schema but with zero code touching it:** `property_definitions` and
`property_values`. They are created by the migration, referenced by nothing else.
The entire typed-object half of the hybrid model — the thing `PROJECT.md` calls the
core architectural decision — does not exist yet in any read or write path.

---

## 2. The gap between the roadmap and the stated use

The intended daily uses are: journal, rigorous week/quarter tracker, subject notes,
reference surface for AI assistants, and structured data.

Mapping those against what exists:

| Intended use | Blocked by |
|---|---|
| Journal | No daily notes, no date navigation, no templates |
| Week/quarter tracker | No tasks, no dates, no cross-page queries |
| Subject notes | Works — until the flat sidebar stops scaling |
| AI reference | Search is title-only; no continuously readable vault on disk |
| Structured data | Properties unimplemented |

The next three phases as written (media, tabs/split view, dashboard) do not unblock a
single row of that table. They make an already-good editor a better editor. Every
blocker above is a **data-layer** problem, not an editor-surface problem.

**Recommendation: defer Phases 04, 05, 07, and 08. Pull Phase 09 forward.**

Phase 06's theming half is cheap and can ride along whenever; its Dashboard half should
wait until there is data worth putting on a dashboard.

---

## 3. Conflict with PROJECT.md that must be resolved

`PROJECT.md` § *What Nexus is NOT* currently states:

> Not a replacement for a task manager (yet). No due dates, assignees, or project
> management in v1.
> Not a calendar. Date properties exist, calendar views may come later — not in scope.

A rigorous week/quarter tracker with todos and habit ticks requires due dates and a
date-scoped view. These two lines directly forbid the tracker. Until they are amended,
any future Claude session reading `PROJECT.md` as authoritative will refuse to build it
or will build it half-heartedly.

**Action:** amend those bullets before Milestone D begins. Suggested replacement:

> - Personal tracking is in scope: todos, habits, and date-scoped review of both.
>   Team project management is not — no assignees, no shared boards, no workflow states
>   beyond what the user defines as a property.
> - Calendar *views* are in scope as a way to read date properties. Nexus is not an
>   event calendar and does not sync with external calendar providers.

---

## 4. Milestones

Ordered by "unblocks the most daily use per unit of work". Each is independently
shippable — Nexus stays usable after every one.

### Milestone A — Findability

*Without this, the vault becomes unusable at roughly 100 pages regardless of what else
gets built.*

1. **Full-text search.** Add an FTS5 virtual table over block content, kept in sync by
   triggers or on block save. Wire it into both sidebar search and the command palette.
   Today `Sidebar.tsx:172` filters on `title` alone — body text is unsearchable.
2. **Sidebar hierarchy.** Add `parent_page_id TEXT REFERENCES pages(id)` to `pages`.
   Drag-to-nest in the sidebar, collapsible tree, manual `sort_order`. Keep the current
   recency list available as a separate "Recent" section.
3. **Favorites / pinned pages.** A boolean on `pages` and a pinned section at the top of
   the sidebar. Trivial to build, disproportionately useful daily.

### Milestone B — Journal spine

4. **Daily notes.** `Cmd+D` opens today's page, creating it if absent. Deterministic
   title format, its own type. Previous/next day navigation. A month strip or mini
   calendar in the sidebar.
5. **Templates.** Mark any page as a template; a type can declare a default template.
   New daily notes instantiate it. This is what converts "I should track this" into
   "the prompts are already on the page" — the single highest-impact feature for
   *rigorous* tracking.

### Milestone C — The data layer (Phase 09, pulled forward)

6. **Property UI.** Build the read/write path for the two dormant tables. A collapsible
   property panel between the page title and the editor body. Property types per
   `PROJECT.md`: text, number, date, boolean, select, multi-select, relation, URL, file.
7. **Types as first-class.** A type manager: create a type, define its properties, set
   its icon and default template. Assign a type to any page. Seed the ones actually
   needed — Journal Entry, Subject Note, Habit, and whatever the tracker requires.

### Milestone D — The tracker

*Requires the `PROJECT.md` amendment in § 3.*

8. **Tasks.** Keep the checkbox block as the capture surface — writing a todo should
   never mean leaving the page. On block save, project checkbox blocks into a `tasks`
   table (`page_id`, `block_id`, `text`, `is_done`, `due_date`, `completed_at`). The
   block stays the source of truth; the table is a queryable index.
9. **Date-scoped views.** "This week" and "This quarter" views over that table plus any
   page with a date property. This is the tracker, and it is mostly a query plus a
   layout once step 8 exists.
10. **Habits.** Resist building a bespoke habit engine. A Habit type with a date and a
    boolean, rendered as a year grid, covers it and reuses Milestone C entirely.

### Milestone E — AI surface, and the substrate for phone

11. **Vault mirror.** Continuously mirror every page to plain `.md` files on disk —
    YAML frontmatter for properties, wikilinks preserved, one file per page, mirroring
    the page tree as directories. Debounced on save, full re-sync on demand.

    This is the highest-leverage item in the entire document and it involves no AI code
    at all. It delivers, in one feature: a readable reference for Claude/Hermes today
    (point any assistant at a folder), continuous plaintext backup, real portability,
    and the file substrate that makes phone sync tractable later.
12. **Local capture endpoint.** *Deferred — do not build yet.* When the phone
    integration comes, it should be a small localhost HTTP server in the Electron main
    process calling the existing `database.ts` functions, writing into an inbox. Nothing
    else needs to be designed for it now.

---

## 5. Architectural notes for the work above

- **Keep all mutation logic in `src/main/database.ts` as plain exported functions.**
  It is already structured this way and that is what will make the future phone
  endpoint a thin wrapper rather than a rewrite. Do not push business logic into the
  renderer or into IPC handlers — `ipc-handlers.ts` should stay a dispatch table.
- **Schema additions in this document are all additive** (`parent_page_id`,
  `is_favorite`, `tasks`, FTS tables). No destructive migration is required to reach
  daily use. Keep it that way.
- **The blocks table stays the source of truth for body content.** The FTS index and the
  tasks table are both *projections* — derived, disposable, rebuildable from `blocks`.
  Never let a projection become the only home for user data.
- **The vault mirror is one-way (DB → disk) in v1.** Two-way sync is a genuinely hard
  problem and is not needed for the AI-reference use case. Do not attempt it until
  there is a concrete reason.

---

## 6. Housekeeping carried over

- `nexus/DEBUG_HANDOFF_2.md` documents two unresolved editor bugs: lasso-selected blocks
  not painting a visible highlight, and untested/likely-broken column layout behaviour
  (nesting, resize handles, vertical stagger). Both predate this roadmap. Decide
  explicitly whether to fix or cut the lasso feature rather than carrying it further.
- No `CHANGELOG.md` exists despite `PROJECT.md` § *Session Protocol* requiring one.
- No tests and no CI. Not urgent for a single-user tool, but the migration path in
  `runMigrations()` is worth a smoke test before the schema additions above land — a
  broken migration is the one failure mode that loses real data.
