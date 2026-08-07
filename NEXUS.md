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
  document), page_width, created_at, updated_at, deleted_at`. The BlockNote
  document is stored as a single JSON blob, not exploded into a `blocks`
  table with parent/order columns. BlockNote already models a document as
  one ordered nested array — storing it as rows and reassembling on every
  save was the direct cause of a `created_at`-reset bug in the first build.
- `properties` — `page_id, key, type, value_text, value_number, value_date,
  value_relation`. Sparse columns, not a JSON blob — keeps typed queries
  (e.g. "all Directives with status=active") cheap.
- `links` — `source_page_id, target_page_id, context`. Backs `[[wiki-links]]`
  and the backlinks panel.
- `activity_log` — `id, page_id, event_type, message, created_at`. Written
  whenever a page is created/edited/tagged/status-changed. Backs the Flow
  view and Atlas's recent-activity widget.
- `types` — built-in types include a "Directive" type with a `status`
  property (active / pending / done). The Command view is just a filtered
  table over pages of that type — not a separate task subsystem.

### Data access

`src/main/repo.ts` holds all reads/writes as plain functions, called by
`src/main/ipc.ts` today. Any future integration surface (an HTTP API for
external tools/agents to read or write notes) would call the same
functions — that layer doesn't exist yet, but the split is there so adding
it later isn't a rewrite.

---

## Navigation / views

Five sections, each a thin view over the same page/property model:

- **Atlas** — dashboard. A small graph widget (direct links of the active
  page, radial layout — not a full force-directed graph), a vault storage
  stats widget, a preview of active Directives, a preview of recent Flow
  activity, and an entries table (name / tags / modified / status) across
  all pages.
- **Vault** — the page list and the block editor. Opening a page shows the
  BlockNote editor, a properties/tags panel, and the backlinks panel.
- **Command** — table of Directive-typed pages, filterable by status.
- **Flow** — chronological feed from `activity_log`.
- **Settings** — accent info, keyboard shortcut reference, data folder
  location, import/export.

This mapping is a starting structure, not locked — renaming or regrouping a
view doesn't touch the data model underneath it.

---

## What's explicitly out of scope for this MVP

Column/multi-column block layout, any custom multi-select overlay (use
BlockNote's native selection), a full force-directed node graph, tabs/split
view, canvas, sections/vaults, spaced repetition, AI integration, and any
actual running API/agent-integration server.

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
