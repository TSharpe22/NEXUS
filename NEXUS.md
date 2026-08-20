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

**The first build is gone from the working branches.** Both builds share one
git history, so its commits are still reachable — the branches that carried
code not already in `main` are kept as `archive/first-build/*` — but nothing
in the tree comes from it. If you find `LassoSelect.tsx`, `SelectionOverlay`,
`ColumnResizeHandles`, a `tailwind.config.js`, `src/renderer/components/`, or
a `nexus-clean.tar.gz`, you are looking at the first build and should stop.
The current app is `src/main` + `src/renderer` with `views/`, `design/` and
`store/`, and it is described by this file.

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
- **Nav**: six views — Home, Notes, Tables, Tracker, Activity, Settings. The
  names in the code (`View` in `store/app-store.ts`) match what's on screen.
- **State**: Zustand. No router — a single `activeView` string switches
  between the six nav sections.
- **Fonts**: IBM Plex Mono + Chakra Petch, self-hosted via `@fontsource`
  packages (no Google Fonts CDN call — keeps the app fully offline-capable).

---

## Core model (kept from the original design)

Nexus's atomic unit is a **hybrid note-object**: every page has a body
(BlockNote document) and a title, and can optionally be assigned a `type_id`
that gives it typed properties. This is what lets a plain note, a tagged log
entry, and a "Directive" (task) all be the same underlying thing.

**Tags are their own system, deliberately.** The original design made them a
`multi_select` property. In practice that meant you could not tag anything
until you had defined a property on the page's type — schema design as the
price of admission for "mark this note as reading". Tags now have their own
tables and their own chip UI, and `multi_select` properties remain for
tag-shaped data that genuinely belongs to a type (a Trade Log's `setups`, a
Book's `themes`). Two controls, because they answer two different questions.

**A habit is a type, not a subsystem.** There is no habit table and no habit
type in the codebase: a habit is any user-made type carrying a `date` property
and a `boolean` property, and the year grid in the Tracker is a view over
those two. `repo.getHabitCandidates()` is the whole of the "is this a habit"
logic — a type offering both. Anything that would need a table here is a sign
the model has gone wrong rather than that the grid needs more.

**Folders are their own axis too.** A page sits in at most one folder — that
is what makes the Notes list a tree you can navigate — while tags stay
many-to-many. Location and topic are different questions and neither
substitutes for the other.

### Schema (simplified from the original)

- `pages` — `id, title, icon, type_id, content (JSON blob of the BlockNote
  document), page_width, folder_id, is_deleted, created_at, updated_at`. The BlockNote
  document is stored as a single JSON blob, not exploded into a `blocks`
  table with parent/order columns. BlockNote already models a document as
  one ordered nested array — storing it as rows and reassembling on every
  save was the direct cause of a `created_at`-reset bug in the first build.
- `properties` — `page_id, key, type, value_text, value_number, value_date,
  value_relation`. Sparse columns, not a JSON blob — keeps typed queries
  cheap. `setProperty` owns which column a value lands in and writes all of
  them on conflict, so retyping a property can't leave the old column
  populated. A relation holds the target page's id in `value_relation`; there
  is no foreign key, so a target deleted for good leaves an id that every
  reader shows as a missing page rather than as an empty value.
- `folders` — `id, name, parent_folder_id, sort_order`. The Notes list tree.
  Both this and `pages.folder_id` are `ON DELETE SET NULL`, so removing a
  folder can never cascade into losing pages; `deleteFolder()` reparents its
  contents onto its own parent first. `moveFolder()` refuses a move that
  would place a folder inside its own subtree, which would otherwise detach
  that subtree from the root and make it unreachable.
- `tags` / `page_tags` — `tags(id, name, color)` with a case-insensitive
  unique index on `name`, joined to pages through `page_tags(page_id,
  tag_id)`. Renaming a tag onto an existing name merges the two rather than
  failing the index. Colour is one of the four semantic names from
  `tokens.css`, assigned round-robin on creation.
- `links` — `source_page_id, target_page_id, source, property_key, context`.
  Backs `[[wiki-links]]`, relation properties and the backlinks panel. `source`
  is `'mention'` or `'relation'`, and it is what lets the two be projected
  independently: a content save rewrites only that page's mentions, setting a
  property rewrites only its relations. Without it a relation could not have a
  backlink at all — `syncLinks` deletes whatever is not in the document, and a
  relation's row never is. `property_key` names the property a relation came
  through and is `''` for a mention, not null, so the unique constraint over
  (source, target, source, property_key) actually holds for mentions; a page
  relating to the same target through two properties is deliberately two rows.
- `tasks` — `page_id, block_id, text, is_done, due_date, completed_at,
  sort_order`. One row per `checkListItem` block in a page's document, keyed by
  (page_id, block_id) since BlockNote block ids are stable across saves. A
  projection, not a store: the block inside `pages.content` is the source of
  truth and this is rebuilt from it by `repo.projectDocument` on every write to
  a page's body, so nothing here is the only copy of anything typed. A due date
  is an `@2026-08-20` written into the block; a task without one inherits the
  `date` property of the page holding it, which is what makes a journal entry's
  todo list work with no syntax at all. That fallback is resolved at query time
  (`EFFECTIVE_DUE` in `repo.ts`) rather than stored, because a page's date can
  change long after its body was last touched. `completed_at` is the one field
  the document cannot answer — a checkbox records that it is ticked, never
  when — so the projector carries it across a reprojection.
- `activity_log` — `id, page_id, event_type, message, created_at`. Written
  whenever a page is created/edited/property-changed. Backs the Activity view
  and Home's recent-activity widget.
- `types` — user-created, not predetermined. The only seeded row is a base
  "Note" type with no properties — everything else (Directive, Book, Trade
  Log, whatever) is created from the Notes page-creation flow or wherever
  a type picker appears. A type has no schema of its own beyond a name, plus
  `template_page_id`: one page whose body and property values a new page of
  that type starts from. The template is deliberately an ordinary page *of*
  that type, which is what lets a per-type picker list candidates; nothing
  recurses, because creating a page copies the template rather than creating
  from the new page in turn. `ON DELETE SET NULL`, so deleting a template
  leaves the type intact and simply un-templated.
- `property_definitions` — `type_id, key, name, property_type, sort_order`.
  A type's actual schema. Rows are added by the user via "+ Add property"
  on a page (Notes) — the moment you define a property on one page of a
  type, every other page of that type gets a slot for it. The architecture
  is created by using the app, not decided in advance by the codebase.
  Tables is a generic browser over this: pick a type, see a table whose
  columns are exactly that type's property_definitions — it is not a
  separate task subsystem with hardcoded status values.
  `key` is a slug of the name and is what values are stored against, so
  renaming a property is display-only and never strands what pages hold; a
  second name that slugifies onto an existing key is refused rather than
  silently retyping the first. `sort_order` is the panel order, and drives
  the Tables column order and the mirror's frontmatter order.

### Migrations

`src/main/schema.ts` owns the schema and the forward-migration, and imports
no `electron` — so it can be exercised directly against a throwaway file:
`npm run check:migration`. `pages.content` doubles as the version marker: a
database that has `pages` but no `content` column can only have come from the
first build, and is migrated (blocks rows folded into one JSON document,
`property_values` rekeyed onto `properties`) after the file is copied aside
to `nexus.db.backup-<timestamp>`. `user_version` is stamped afterwards so it
runs once.

`user_version` 3 adds folders and tags. That step is purely additive — new
tables plus one `ALTER TABLE pages ADD COLUMN folder_id` — so a v2 file needs
no rebuild and no backup, and existing pages simply start at the folder root.

Not every step is structural: `user_version` 6 changes no tables at all and
only moves relation values out of `value_text`, where the old `setProperty`
put them, into `value_relation`, where every reader looks. A data repair like
that is gated on the stored version rather than written as an idempotent step
run on each startup — there is nothing to re-repair once a file has been
through it. The header comment on `SCHEMA_VERSION` is the log of what each
version did; keep it current when bumping.

`user_version` 8 adds `tasks`. Additive, and derived in the same sense as
`page_fts`: the table is created empty and `repo.ensureTaskIndex()` fills it
from the documents at startup when it is empty, which is also how a file
written before the tracker existed picks up every checkbox already in it.

`user_version` 7 adds `types.template_page_id`. It was built as 6 on its own
branch while 6 had already shipped as the relation repair, which is the one
mistake this scheme cannot absorb: a version number meaning two different
things to two databases is not recoverable afterwards. Renumbering it to 7 was
enough only because the step is additive and idempotent (`columnExists`), so a
file already stamped 6 by the earlier build still picks the column up —
`check:migration` covers exactly that file. **Before claiming a version
number, check what is already on `main`.**

### Data access

**Every projection is written in the main process.** `repo.updatePage` is the
single place a page's body changes, and it rebuilds all three things derived
from that body: the search index (`reindexPage`), the link graph and the task
table (both via `projectDocument`). Relation links are the one projection with
a second trigger, since they come from properties rather than from the
document: `syncRelationLinks` runs from `setProperty`, `removeProperty` and
`removePropertyDefinition`. Link extraction used to run in the
renderer, from `Editor.tsx`, after the save round-tripped — which made a React
component the only writer of the link graph, so pages created by import, by a
template, or by the journal button contributed no backlinks and nothing else
could repair it. A projection whose only writer is one UI component is a bug;
`syncLinks` is not exported and there is no IPC channel for it.

The document walkers those projections share live in `src/shared/document.ts`,
reachable from both processes, because a second copy of that parsing in the
renderer is how the two would drift.

### Backups

`src/main/backup.ts` copies the database aside on every launch, keeping the
last `KEEP_BACKUPS` (10) under `data/backups/`. It imports no `electron`, so
the rotation is exercised directly: `npm run check:backup`.

This exists because **the mirror is not a backup.** It is one-way and lossy on
the way out — a callout or a toggle comes back as a plain paragraph and a
table as nothing at all — so the database file is the only complete copy of a
vault. Before this, the only copies ever taken were the ones a destructive
migration made for itself.

Three things about it are load-bearing and easy to undo by accident:

- **The write-ahead log is checkpointed first.** Under WAL the recent writes
  are still sitting in `nexus.db-wal`, so copying the main file on its own
  snapshots a vault that is missing the last session.
- **A snapshot carries the mtime of the vault it captured**, not the time the
  copy was made. The skip check asks "has the vault moved on since this
  snapshot?"; left at the copy time it would instead be asking "was the vault
  written after the copy finished?", which is true for a vault nobody has
  touched, so opening Nexus five times in a morning would push five identical
  copies through the rotation and drop five real ones.
- **Every snapshot name carries a counter, including the first.** Age is read
  off name order, and adding the counter only on a collision sorts `-002`
  *before* the bare name, because `-` sorts under `.`.

Migration backups are a different thing and stay where they are, next to the
database as `nexus.db.backup-<timestamp>`. They are rare, they mark a
one-way change, and nothing rotates them away.

### The vault mirror

`src/main/mirror.ts` writes the whole vault out as a Markdown tree, one file
per page with the page's tags and typed properties as YAML frontmatter, plus
a `_nexus-index.md` table of contents. Deliberately **one-way**: edits made to
those files are never read back. The point is that any assistant, editor or
backup tool can read the vault as ordinary files.

`scheduleSync(pageId?)` runs after every mutation, debounced. **The argument
is the whole performance contract**: naming the page a mutation touched keeps
the sync to that one file, and leaving it off asks for a pass over every page
in the vault. A full pass renders each page from scratch — four queries and a
markdown build each — on the main process, which is also the process serving
autosave, so at a few hundred pages an un-narrowed call site is a visible
stutter while typing. Measured on a 1500-page vault: 474ms for a full pass
against 45ms for a scoped one.

So the rule for a new call site is: **pass the page id when the mutation
changes exactly that page, and leave it off when it changes others.** Renaming
a type or a tag rewrites the frontmatter of every page carrying it while
editing none of them — those must stay full passes, and `check-app.mjs` has an
assertion per case that fails if one is narrowed. Leaving the id off is always
*correct*, only slow, so when in doubt leave it off.

Two things happen on every sync regardless of scope, and neither needs a call
site to remember them:

- **Paths are recomputed for every page.** They are not independent — one
  page's title decides whether another needs a `(2)` suffix — so any page
  whose path moved is rewritten even when nothing marked it. That is what
  makes folder renames and page moves safe without special-casing. It is
  cheap because it reads three columns (`repo.getPageLocations()`) rather
  than dragging every document blob out of SQLite.
- **Path order is creation order, not `updated_at`.** The dedup suffix is
  decided by which page is seen first, so a recency order meant editing one of
  two same-titled pages renamed *both* files on disk.

If a sync throws, the pending set is escalated to a full pass rather than
dropped — the pages it was going to write are no longer marked, and anything
less would leave them stale forever.

`src/main/repo.ts` holds all reads/writes as plain functions, called by
`src/main/ipc.ts` today. Any future integration surface (an HTTP API for
external tools/agents to read or write notes) would call the same
functions — that layer doesn't exist yet, but the split is there so adding
it later isn't a rewrite.

---

## Navigation / views

Six sections, each a thin view over the same page/property model:

- **Home** — dashboard. An interactive force-directed graph of the whole
  vault (pan, zoom, drag a node, click to open), vault stats, recent
  activity, and an entries table (name / type / properties / modified)
  across all pages.
- **Notes** — the page tree and the block editor. A "Today's entry" button at
  the top of the list opens today's journal entry, creating it from the
  Journal type's template if it does not exist yet. Everything it needs — the
  Journal type, its folder, its `date` property, a starter template — is made
  lazily on first use, so a vault that never journals stays clean. The entry
  is matched on that `date` property rather than on its title, so renaming an
  entry never produces a second one for the same day, and the date is taken in
  local time (writing at 11pm would otherwise file under tomorrow).
  Creating a page picks (or creates) a type inline; the list is a folder tree (drag a page or a folder
  onto a folder to move it, expansion persists across restarts), filterable
  by the tag chips above it and by search — searching also matches folder
  names, and forces open any folder holding a match so nothing hides behind
  a collapsed ancestor. Trash stays a flat list. Opening a page shows the
  BlockNote editor in a centred reading column with its tag chips under the
  title, a properties panel driven entirely by that page's type schema, and
  the backlinks panel. The panel sits between the tags and the document body —
  a typed page's data is the first thing under the title, not something you
  scroll a whole note to reach — and `Editor` takes it as a slot for that
  reason. It carries an inline "+ Add property" to grow the schema, a type
  picker to re-type the page, a drag handle per row to reorder, and a click on
  a property name to rename it. The two altitudes are kept apart: the × on a
  row clears that page's value, while removing the property from the type
  lives in the rename state, since it clears the value from every page.
- **Tables** — pick any user-created type, see a table of its pages with
  columns generated from that type's property_definitions. Any column sorts,
  typed by the property's own type, cycling ascending → descending → back to
  the default newest-first; empty cells sink to the bottom in both directions,
  since a property added today is empty on every page that predates it. The
  filter box matches what the cells show rather than only the title, so a
  relation's target or one of a page's tags finds its row. Both reset when the
  type changes. Types can be renamed and deleted here, and a type's template is
  picked here from among its own pages; deleting a type re-homes its pages onto
  Note rather than deleting them.
- **Tracker** — what is due, in a window of time. Three modes over the same
  data: *Week* (every day of the week, empty ones included, because the shape
  of the week is part of what you're reading), *Quarter* (only the days
  carrying something — ninety empty rows is not a view), and *Habits* (a
  year grid). Tasks come from `tasks`, the projection of every checkbox block;
  dated pages come from any `date` property. A task can be ticked off here and
  the write goes back into its block, never into the projected row. Two
  panels sit outside the window because a date-scoped view would otherwise
  swallow their contents: *Overdue* (open tasks whose date has passed) and
  *No date* (open tasks with no date on the block or its page). Both show only
  while you're looking at the current window.

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
  widget framework for a six-view MVP.
- **Privacy by default.** No telemetry, no network calls, works fully
  offline.
- **Keyboard-first** where practical, but don't block MVP progress on
  exhaustive shortcut coverage.

When in doubt: do less, do it well.
