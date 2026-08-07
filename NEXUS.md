# NEXUS — Project Guide

> Authoritative reference for Claude Code sessions working on Nexus. Read this
> and `DESIGN.md` before writing code.

---

## What is Nexus

Nexus is a local-first, desktop personal knowledge management application —
built for one user, not a team, not a SaaS product. It replaces the note-
taking + light-task-tracking + tag/data workflow of tools like AnyType or
Notion with something smaller, self-hosted, and fully owned.

This is the second build. The first attempt got through basic note-taking,
block editing, and links, but stalled in a debugging loop over a custom
multi-select overlay and a multi-column layout feature — both fighting the
block editor library's own internals instead of using what it already gave
for free. This build is scoped down to an MVP, and deliberately avoids
rebuilding either of those two things.

---

## Platform and stack

- **Platform**: Desktop (Electron).
- **Data layer**: SQLite via `better-sqlite3`. Everything lives in a local
  database file. No cloud sync. No network calls at runtime except explicit
  user-initiated ones (there are none in the MVP).
- **Frontend**: React + TypeScript, built with `electron-vite`.
- **Editor**: BlockNote (`@blocknote/core` + `@blocknote/react`), using
  `@blocknote/ariakit` as the UI adapter — not `@blocknote/mantine`.
  `@blocknote/react`'s default UI (formatting toolbar, slash menu, side
  menu) has no visual implementation of its own; it needs an adapter
  package to supply actual component rendering. Ariakit was picked over
  Mantine because it's a thin, deliberately unstyled component layer with
  no app-wide CSS reset or competing theme — its popups are restyled with
  our own CSS tokens, and it stays scoped to the editor instead of leaking
  into the rest of the app the way importing `@mantine/core`'s stylesheet
  would. Multi-block selection uses BlockNote's native selection, not a
  custom overlay.

  **`@tiptap/*` is pinned to 2.11.5 via `overrides` in `package.json`. Do not
  remove that pin.** BlockNote 0.24 declares `@tiptap/core: ^2.7.1`, and the
  caret lets npm resolve 2.27, whose `ReactNodeView` changed when
  `contentDOMElement` is assigned relative to the React ref firing. The result
  is silent and easy to misread: custom React block specs (`toggle`, `callout`)
  still *render*, but their `contentRef` element never receives ProseMirror's
  content DOM, so the block cannot be typed into and text aimed at it lands in
  the following block instead. Nothing throws and nothing logs. If toggle or
  callout ever stop accepting text, check the resolved tiptap version first.
- **Nav**: five views — Home, Notes, Tables, Activity, Settings. The names in
  the code (`View` in `store/app-store.ts`) match what's on screen.
- **State**: Zustand. No router — a single `activeView` string switches
  between the five nav sections.
- **Fonts**: IBM Plex Mono + Chakra Petch, self-hosted via `@fontsource`
  packages (no Google Fonts CDN call — keeps the app fully offline-capable).

---

## Core model (kept from the original design)

Nexus's atomic unit is a **hybrid note-object**: every page has a body
(BlockNote document) and a title, and can optionally be assigned a `type_id`
that gives it typed properties. Tags are just a `multi_select` property —
not a separate system. This is what lets a plain note, a tagged log entry,
and a "Directive" (task) all be the same underlying thing.

### Schema (simplified from the original)

- `pages` — `id, title, icon, type_id, content (JSON blob of the BlockNote
  document), page_width, is_deleted, created_at, updated_at`. The BlockNote
  document is stored as a single JSON blob, not exploded into a `blocks`
  table with parent/order columns. BlockNote already models a document as
  one ordered nested array — storing it as rows and reassembling on every
  save was the direct cause of a `created_at`-reset bug in the first build.
- `properties` — `page_id, key, type, value_text, value_number, value_date,
  value_relation`. Sparse columns, not a JSON blob — keeps typed queries
  cheap.
- `links` — `source_page_id, target_page_id, context`. Backs `[[wiki-links]]`
  and the backlinks panel.
- `activity_log` — `id, page_id, event_type, message, created_at`. Written
  whenever a page is created/edited/property-changed. Backs the Activity view
  and Home's recent-activity widget.
- `types` — user-created, not predetermined. The only seeded row is a base
  "Note" type with no properties — everything else (Directive, Book, Trade
  Log, whatever) is created from the Notes page-creation flow or wherever
  a type picker appears. A type has no schema of its own beyond a name.
- `property_definitions` — `type_id, key, name, property_type, sort_order`.
  A type's actual schema. Rows are added by the user via "+ Add property"
  on a page (Notes) — the moment you define a property on one page of a
  type, every other page of that type gets a slot for it. The architecture
  is created by using the app, not decided in advance by the codebase.
  Tables is a generic browser over this: pick a type, see a table whose
  columns are exactly that type's property_definitions — it is not a
  separate task subsystem with hardcoded status values.

### Migrations

`src/main/schema.ts` owns the schema and the forward-migration, and imports
no `electron` — so it can be exercised directly against a throwaway file:
`npm run check:migration`. `pages.content` doubles as the version marker: a
database that has `pages` but no `content` column can only have come from the
first build, and is migrated (blocks rows folded into one JSON document,
`property_values` rekeyed onto `properties`) after the file is copied aside
to `nexus.db.backup-<timestamp>`. `user_version` is stamped afterwards so it
runs once.

### Data access

`src/main/repo.ts` holds all reads/writes as plain functions, called by
`src/main/ipc.ts` today. Any future integration surface (an HTTP API for
external tools/agents to read or write notes) would call the same
functions — that layer doesn't exist yet, but the split is there so adding
it later isn't a rewrite.

---

## Navigation / views

Five sections, each a thin view over the same page/property model:

- **Home** — dashboard. An interactive force-directed graph of the whole
  vault (pan, zoom, drag a node, click to open), vault stats, recent
  activity, and an entries table (name / type / properties / modified)
  across all pages.
- **Notes** — the page list and the block editor. Creating a page picks (or
  creates) a type inline; the list is searchable and has a trash. Opening a
  page shows the BlockNote editor in a centred reading column, a properties
  panel driven entirely by that page's type schema (with an inline
  "+ Add property" to grow the schema, and a type picker to re-type the
  page), and the backlinks panel.
- **Tables** — pick any user-created type, see a table of its pages with
  columns generated from that type's property_definitions. Types can be
  renamed and deleted here; deleting a type re-homes its pages onto Note
  rather than deleting them.
- **Activity** — chronological feed from `activity_log`. Consecutive content
  saves on one page coalesce into a single "edited" entry (see
  `EDIT_COALESCE_MINUTES` in `repo.ts`) so typing doesn't bury every other
  event.
- **Settings** — data folder location, import/export, keyboard shortcuts.

This mapping is a starting structure, not locked — renaming or regrouping a
view doesn't touch the data model underneath it.

---

## What's explicitly out of scope for this MVP

Column/multi-column block layout, any custom multi-select overlay (use
BlockNote's native selection), tabs/split view, canvas, sections/vaults,
spaced repetition, AI integration, and any actual running
API/agent-integration server.

These may come back later, deliberately, once the MVP is solid — not as a
side effect of "while I'm in here."

---

## Development principles

- **Polish before progress.** A view is done when empty/error/loading states
  are handled and it matches the design tokens — not just "renders."
- **No premature abstraction.** Don't build a plugin system or generic
  widget framework for a five-view MVP.
- **Privacy by default.** No telemetry, no network calls, works fully
  offline.
- **Keyboard-first** where practical, but don't block MVP progress on
  exhaustive shortcut coverage.

When in doubt: do less, do it well.
