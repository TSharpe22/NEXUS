# PHASES — the build plan after the MVP

> **Read this before starting any structural work on Nexus.** It is the
> authoritative sequence, and it is written to be picked up cold by a session
> that has not seen the conversation it came from.
>
> Read alongside:
> - `NEXUS.md` — what Nexus is, and the conventions every change follows.
> - `DESIGN.md` — the visual system. A phase is not done until it matches.
> - `MODEL.md` — the vocabulary. **Use these words in code, UI and commits.**
> - `ARCHITECTURE_OPTIONS.md` — why these choices and not others. Consult
>   before proposing a different one; the alternatives are already argued.

---

## How to use this document

Phases are **ordered and dependent**. Do not start a phase before the ones
above it are shipped — each assumes the previous one's tables exist.

Each phase gives: its goal, why it sits where it does, the exact schema, the
migration, the code that moves, what "done" means, and an explicit **Do not**
list. The Do-not lists are the most important part. They exist because every
phase here is adjacent to a more interesting one, and the MVP's predecessor
died of exactly that.

**Schema versions are reserved in advance** (v11–v17). If a phase lands in more
than one step, it takes more than one version — never reuse a number, and never
let one number mean two things to two databases. Schema v7's comment in
`schema.ts` records what happened the one time that nearly did.

---

## Invariants — true in every phase

1. **The app stays usable.** It is in daily use. Every phase ships on its own
   and never leaves a view broken between phases.
2. **Migrations are additive and in place.** No rebuild, no export-and-reimport.
   Take a backup before any step that rewrites values — `applySchema` already
   accepts a `backup` callback for this.
3. **Nothing new is ever required.** An object with no type, no properties and
   no folder keeps working exactly as it does today. Structure is offered,
   never demanded.
4. **Derived data is derived.** `page_fts`, `tasks` and `links` are rebuilt
   from source and cost nothing to lose. Anything computable — backlinks,
   inverse references, rollups, formulas, view membership — is computed, never
   stored a second time.
5. **User data is never a projection.** If nothing can re-derive it, it is not
   an index and must never be rebuilt. `pages.is_pinned` is the existing
   example.
6. **Structure round-trips.** If it cannot be written into the mirror and read
   back, it is not finished.
7. **The document body belongs to BlockNote.** Structure lives around the
   document. The only blocks added are ones that *reference* or *read* —
   never ones that redefine how text works. See `NEXUS.md` on the first
   build.
8. **Use the vocabulary.** Object, Type, Property, Value, Format, View, Folder.
   Never "relation" — a property that points at an object has format
   `reference`.

---

## The seeded types

Phases 3 and after assume these exist. `Note` is seeded already
(`schema.ts:70`); the rest are created lazily on first use, the way the
Journal type already is (`repo.ensureJournalSetup`).

| Type | Display | Properties |
|---|---|---|
| **Note** | page | — |
| **Journal entry** | page | `date` |
| **Project** | page | `status`, `due`, `owner`→Person |
| **Task** | **inline** | `done`, `due`, `project`→Project |
| **Habit** | **page** | `cadence`, `target`, `active` |
| **Check-in** | **inline** | `habit`→Habit, `date`, `done` |

**A Habit is a page-level object**, with its own body, its own notes and its
own properties. Its **Check-ins are inline objects pointing at it** — one per
day. This is the Project/Task relationship reused, which is the point: there is
no habit subsystem, and `repo.getHabitCandidates()` eventually retires rather
than growing.

---

# Phase 1 — Property vocabulary

**Schema v11.** Separate property *identity* from property *membership*.

### Goal

A property exists once for the whole vault. Types point at properties instead
of owning them. An object may carry a property its type never declared, and
promoting that into the type is one click.

### Why here

Every later phase assumes a property has one definition. Multi-value storage,
references, views, rollups and formulas all key off a property that means the
same thing everywhere. Nothing else can start until this is true.

### Schema

```sql
CREATE TABLE property_defs (
  key         TEXT PRIMARY KEY,
  namespace   TEXT NOT NULL DEFAULT 'core',
  name        TEXT NOT NULL,
  format      TEXT NOT NULL,
  config      TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE type_properties (
  type_id       TEXT NOT NULL REFERENCES types(id) ON DELETE CASCADE,
  property_key  TEXT NOT NULL REFERENCES property_defs(key) ON DELETE CASCADE,
  sort_order    REAL NOT NULL DEFAULT 0,
  is_required   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (type_id, property_key)
);

CREATE INDEX idx_type_properties_type ON type_properties(type_id);
```

**On `namespace`.** It is reserved, not load-bearing. Identity is `key` alone,
matching `properties.key`, which is how values already join. Everything writes
`'core'`. If true namespacing is ever needed, the migration is a mechanical
rewrite of `key` to `namespace || '.' || key` in both tables — cheap, and
knowing that is why the column exists now. **Do not write code that reads
`namespace` for behaviour.**

**On `config`.** JSON, read only through a narrow accessor in `repo.ts` —
never `JSON.parse`d at call sites. Phase 1 writes `{}`; Phase 2 fills it.

### Migration

This is **the only irreversible step in the plan**. Take a backup first.

1. Read every `property_definitions` row, grouped by `key`.
2. For each key where all rows agree on `property_type` → one `property_defs`
   row. `name` is the most common; ties break to the earliest `created_at`.
3. For each key where rows **disagree** on `property_type`:
   - The most-used format keeps `key`.
   - Each other format takes `key_2`, `key_3`, … in descending use order.
   - **Rewrite `properties.key` for every object of the affected types** in the
     same transaction. A value that keeps its old key while its definition
     moved is the one way this migration can silently lose data.
4. Write `type_properties` from the original rows, preserving `sort_order`.
5. Any `properties` row whose `key` has no `property_defs` entry gets one,
   inferred from that row's `type` column. This makes the migration total —
   no value is left without a definition.
6. Drop `property_definitions`.

Add a `scripts/check-migration.mjs` fixture containing a **deliberate format
collision** before writing the migration, not after.

### Code

- `src/main/schema.ts` — v11, the DDL and the migration above.
- `src/main/repo.ts` — `getPropertyDefinitions(typeId)` becomes a join through
  `type_properties`. New: `getPropertyDefs()`, `defineProperty(key, name,
  format)`, `addPropertyToType(typeId, key)`, `removePropertyFromType`,
  `renameProperty(key, name)` (renames once, everywhere).
- `src/main/ipc.ts` + `src/preload/index.ts` + `NexusAPI` in
  `src/shared/types.ts` — the new calls.
- `src/renderer/views/PropertiesPanel.tsx` — read the object's own `properties`
  rows and merge with its type's list. Type properties first, ad-hoc under a
  divider, both editable. `+ Add property` picks from existing properties or
  creates one. Each ad-hoc row carries **Add to type**.

### Done when

- One property renamed in one place changes every object carrying it.
- An object shows and edits a property its type never declared.
- Add to type promotes it, and it appears on every other object of that type.
- `npm run check` passes, including the collision fixture.
- The panel matches `DESIGN.md` — empty, error and loading states included.

### Do not

- Do not touch cardinality, references or tags. Phase 2.
- Do not build a property picker with search, filtering or grouping. A list.
- Do not add formats. The existing eight, unchanged.
- Do not read `namespace`.

---

# Phase 2 — Values that hold more than one thing

**Schema v12 and v13.** Two steps, shipped separately.

### Goal

A property can hold many values. A reference can point at many objects. Select
options are real objects with colour and order. Then tags stop being a system.

### Why here

Boards group by a select. Rollups aggregate across a reference. Collections are
an ordered reference. All three are blocked until a value can be plural, and
tags cannot collapse until multi-value storage is better than `page_tags`.

## 2a — Multi-values, references, options (v12)

### Schema

```sql
-- Ordered multiple values: select, text, number.
CREATE TABLE property_multi (
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  sort_order  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (page_id, key, value)
);
CREATE INDEX idx_property_multi_key ON property_multi(key, value);

-- Ordered references. Replaces properties.value_relation.
CREATE TABLE property_refs (
  page_id         TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  target_page_id  TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  sort_order      REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (page_id, key, target_page_id)
);
CREATE INDEX idx_property_refs_target ON property_refs(target_page_id);

-- Select options, with colour and order.
CREATE TABLE property_options (
  key         TEXT NOT NULL REFERENCES property_defs(key) ON DELETE CASCADE,
  value       TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'accent',
  sort_order  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (key, value)
);
```

`property_defs.config` gains, per format:

```jsonc
{ "cardinality": "one" | "many",
  "targetTypes": ["book", "person"],   // reference only; advisory (soft)
  "required": false }
```

**Constraints are soft.** `targetTypes` sorts and filters the picker and flags
a violation; it never rejects a write. The one exception is `is_required`,
which a type may enforce — opt-in per property, off by default. In a
single-user local app a rejected write is the app telling you that you are
wrong about your own notes.

### Migration

- `multi_select` values (a JSON array stringified into `value_text`) → rows in
  `property_multi`, and each distinct value → a `property_options` row.
  Malformed JSON becomes one single value rather than being dropped.
- `properties.value_relation` → one `property_refs` row per object, `sort_order`
  0. Leave `value_relation` in place but **stop reading it** — it is dropped in
  v13 once 2a has run in anger.
- `getKnownPropertyValues()` (`repo.ts:1532`) is superseded by
  `property_options`; keep it only as the seeder that fills options on
  migration.

### Code

- `repo.setProperty` splits: scalar values stay in `properties`; plural values
  go to `property_multi` / `property_refs`. One entry point, branching on the
  definition's format and cardinality.
- **`syncRelationLinks` (`repo.ts:1679`) must read `property_refs`.** It
  currently reads `properties.value_relation` and will silently produce no
  backlinks after the migration if missed. `links.property_key` already exists
  for this (schema v9).
- `PropertiesPanel` — a multi-value editor with chips, and a reference picker
  filtered by `targetTypes`.
- `Tables.tsx` — cells render plural values.

## 2b — Tags become a property (v13)

### Migration

- Create `property_defs('tags', name 'Tags', format 'select', config
  `{cardinality: "many"}`)`.
- Every `tags` row → a `property_options('tags', name, color)` row, colour
  preserved.
- Every `page_tags` row → a `property_multi(page_id, 'tags', name)` row.
- Keep `tags` / `page_tags` for one version, then drop in v14.

### Code

- `TagBar.tsx` keeps its chip UI and its zero-friction create — typing a name
  that has no option creates the option. **Collapsing the storage does not mean
  collapsing the chrome.** Chips under the title stay chips.
- `TagFilter.tsx` becomes an ordinary property filter.
- `tags:*` IPC retires; `NEXUS.md`'s tags section is rewritten to say a tag is
  a select property with many values.

### Done when

- A reference holds several objects, in an order you set, and each contributes
  a backlink.
- A select option renamed in one place changes every object carrying it, and
  keeps its colour.
- Tagging still costs one keystroke and no schema setup.
- `rebuildLinkIndex()` still reproduces every backlink from scratch.

### Do not

- Do not collapse tags before 2a ships. `page_tags` is an indexed join table
  and `multi_select` is JSON in a text column — collapsing early is a
  downgrade.
- Do not store inverse references. Person's `books` is read out of `links`.
- Do not add hard constraints.

---

# Phase 3 — Inline objects

**Schema v14.** Tasks and check-ins become real objects.

### Goal

An object may be displayed inside another object's body instead of on its own
page. Task, Habit and Check-in become ordinary objects with properties,
references and backlinks.

### Why here

Needs Phase 2 for `project`→Project and `habit`→Habit references, and needs
Phase 1 for those properties to exist once.

### The definition, restated

**An inline object is a real object shown inside another object's body.**

1. Stored like every other object — same table, same id, same properties, same
   queries, same backlinks.
2. Its **type** says to show it inline. That is the only difference.
3. A body holds a **reference** to it, not a copy. Editing it in the body edits
   the object. Removing it from the body removes the display; the object
   survives and is still found by its type's view.

Because every object can have a body, inline is a display choice and never a
restriction — an inline object that needs a page **just gains a body**. No
conversion, no retyping, no second object.

### Schema

```sql
ALTER TABLE types ADD COLUMN display TEXT NOT NULL DEFAULT 'page';  -- 'page' | 'inline'
ALTER TABLE types ADD COLUMN default_folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
```

Both additive, both guarded by `columnExists`.

A new BlockNote block, `objectRef`, carrying one prop: `objectId`. Follow the
existing custom-block pattern in `src/renderer/editor/custom-blocks.tsx`
(`toggle`, `callout`) and register it in `editor/schema.ts`.

### Two mechanisms live side by side, deliberately

Checkbox blocks and the `tasks` projection **stay exactly as they are**. Typing
a checkbox in a note does **not** create a Task object — that is a setting for
later, not a default, or every scratch list silently becomes data.

So after Phase 3 the Tracker reads a **union**: checkbox-block tasks from
`tasks`, and Task objects from the object table. Say so in the code. Whichever
one falls out of use gets retired in a later phase, on evidence rather than
prediction.

The same applies to habits: `repo.getHabitCandidates()` keeps working over
type-with-date-and-boolean while Habit/Check-in objects appear alongside.

### Code

- `repo.createPage` honours `types.default_folder_id`.
- New: `repo.createInlineObject(typeId, hostPageId)` — creates the object and
  inserts an `objectRef` block into the host's body, in one transaction.
- The editor renders an `objectRef` as a compact row: title, and the type's
  properties inline. Clicking through opens it as a page.
- Tracker reads the union described above.

### Done when

- A Task object can be created inside a note, carry `due` and `project`, and
  appear in a view of all Tasks.
- Deleting the `objectRef` block leaves the object findable.
- A Habit has a page; its Check-ins are inline objects referencing it; the year
  grid reads Check-ins.
- Existing checkbox tasks and existing habit types are untouched and still
  work.

### Do not

- Do not migrate existing checkbox blocks into Task objects.
- Do not make checkbox blocks create Task objects.
- Do not delete the object when its `objectRef` block is removed.
- Do not retire `tasks` or `getHabitCandidates()` in this phase.

---

# Phase 4 — Views

**Schema v15.** Saved filters, sorts, grouping and layouts.

### Goal

A saved question about the vault, drawn as a table, list, board, calendar or
gallery, pinnable in the sidebar and embeddable in a body.

### Why here

Needs 1–3 to have properties worth filtering and objects worth grouping.

### Schema

```sql
CREATE TABLE views (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  icon        TEXT,
  filter      TEXT NOT NULL DEFAULT '{}',
  sort        TEXT NOT NULL DEFAULT '[]',
  grouping    TEXT,
  layout      TEXT NOT NULL DEFAULT 'table',
  config      TEXT NOT NULL DEFAULT '{}',
  is_pinned   INTEGER NOT NULL DEFAULT 0,
  sort_order  REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### The filter tree — the one contract not to get wrong

Every later phase serialises this. A shape change invalidates every saved view
in the vault.

```jsonc
{ "op": "and", "of": [
  { "field": { "kind": "type" }, "cmp": "is", "value": "book" },
  { "field": { "kind": "property", "key": "status" }, "cmp": "is", "value": "reading" },
  { "op": "or", "of": [
    { "field": { "kind": "property", "key": "tags" }, "cmp": "has", "value": "fiction" },
    { "field": { "kind": "property", "key": "rating" }, "cmp": "gte", "value": 4 }
  ]}
]}
```

`field.kind` — `type`, `property`, `folder`, `title`, `created`, `updated`,
`pinned`, `backlink`.
`cmp` — `is`, `not`, `has`, `lacks`, `gt`, `gte`, `lt`, `lte`, `contains`,
`empty`, `notEmpty`, `before`, `after`, `within`.

**It compiles to SQL in exactly one place** — `repo.compileFilter(tree)`
returning `{ sql, params }`. It is never interpreted in the renderer, and no
view behaviour exists that cannot be expressed in this tree.

### Grouping is what makes a layout

A board is a view grouped by a select or a reference. A calendar is a view
grouped by a date property. Two layouts, one mechanism, no per-layout query
code. **Register layouts** — `table`, `list`, `board`, `calendar`, `gallery` —
so that adding `chart` in Phase 5 and `timeline` later is the same shape of
addition, not a new feature each time.

### Code

- `repo.compileFilter`, `repo.runView(viewId)`.
- `views:*` IPC.
- **Rebuild `Tables.tsx` as a view with `type is X` prefilled.** This is the
  proof: if the existing screen cannot be expressed as a view, the model is
  wrong, and it is far cheaper to find out here than in Phase 5.
- Sidebar lists pinned views beside the folder tree.

### Done when

- A view survives a restart with its filter, sort, grouping and layout.
- The same view redrawn as a board and a calendar needs no new query code.
- Tables is a view and nothing was lost.

### Do not

- Do not add aggregates, rollups, formulas or charts. Phase 5.
- Do not build the query block yet — it wants a stable filter tree first.
- Do not let any filter behaviour exist outside the tree.

---

# Phase 5 — Analysis

**Schema v16.** In four steps, in this order, because each answers one of the
questions in `MODEL.md` and each needs the one before it.

### 5a — Aggregates

No schema. A view's column footer: count, sum, average, min, max, and
per-group totals when grouped. Pure SQL over the compiled filter.

*Answers:* "How many tasks did I finish this week, by project?"

### 5b — Rollups

A property with format `rollup`. Config:

```jsonc
{ "via": "author", "target": "rating", "fn": "avg" }
```

Read `property_refs` for `via`, gather `target` across the referenced objects,
apply `fn` (`count`, `sum`, `avg`, `min`, `max`, `first`, `last`). **Computed
on read**, never stored.

*Answers:* "What is my completion rate for each habit over 90 days?"

### 5c — Formulas

A property with format `formula`, config `{ "expr": "..." }`.

The expression language, deliberately small: literals; property references by
key; arithmetic; comparison; `and` / `or` / `not`; `if`; date functions
(`today()`, `days_between`, `date_add`); text functions (`concat`, `lower`,
`length`); and **`.` traversal through a reference** to another object's
properties (`author.name`).

Both an expression editor and a builder — **the builder writes expressions.
There is one engine, not two.** It lives in `repo.ts` so views, the mirror and
any future outside query path all get the same answers.

**Computed on read.** Correct by construction, nothing to invalidate, and
SQLite on one machine is fast. A cache table is a fix for a measured slow
query, not a starting design. Guard against cycles: a formula that reaches
itself returns an error value, never a hang.

*Answers:* "What am I reading, and how long has each been open?"

### 5d — Charts

Layout `chart`, config `{ kind, x, y, series }` with `kind` in `bar`, `line`,
`area`, `pie`. **A chart is a grouped view drawn differently** — it introduces
no query path of its own. Because layouts are registered (Phase 4), this is one
renderer and a config shape.

Charts appear in three places and are one thing in all three: as a view's
layout, embedded in a body via the view block, and on a dashboard — a view
whose contents are other views.

*Answers:* "Where does my time go?" — with 5a's cross-type aggregation over a
`duration` property, whatever type carries it.

### Do not

- Do not start 5c before 5b ships. Rollups cover most of what formulas get
  asked for, and shipping them first tells you which formulas are actually
  wanted.
- Do not store computed values.
- Do not add a charting dependency that cannot render offline.

---

# Phase 6 — History

**Schema v17.** What a property held over time, not only what it holds now.

### Goal

Change over time becomes queryable: streaks that survive an edit, a status's
history, a chart of a number moving.

### Why here

Wants a settled property model. Logging changes to a schema still in motion
records noise.

### Schema

```sql
CREATE TABLE property_history (
  id          TEXT PRIMARY KEY,
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT,
  changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_history_page_key ON property_history(page_id, key, changed_at);
```

Append-only. Never updated, never rewritten. `value` is the serialised form,
format-agnostic; `NULL` records a cleared value.

### Opt in, per property

`property_defs.config` gains `{ "history": true }`, **default false**. Logging
every property on every object is unbounded growth for data nobody asked for.
Turn it on for the handful that are worth a timeline.

### Code

- `repo.setProperty` appends a row when — and only when — the value actually
  changes. The no-op guard that already prevents empty writes
  (`repo.ts:1470`) is the right hook.
- `repo.valueAt(pageId, key, date)` — the value as of a date.
- History is a **projection of nothing**: it cannot be re-derived, so per
  invariant 5 it is user data and must never be rebuilt, and the mirror has to
  carry it.

### Do not

- Do not log history by default.
- Do not let a formula write history.
- Do not use history to implement undo. Different problem.

---

# Phase 7 — Plain text

Independent of everything above, the hardest, and last. **Nothing in phases
1–6 depends on how this is answered**, which is exactly why it can wait — but
it must be decided deliberately rather than drifted into.

### 7a — The converter (the gate)

A **lossless Markdown ↔ BlockNote converter**, both directions, with a
round-trip property test in `npm run check`.

Today `importMarkdown` is a line-to-paragraph mapper: headings arrive as
literal `## Heading` prose and a Nexus export re-imported does not survive
(`QA_SCAN.md:180`). It also emits blocks with no `id`, which makes any
checkbox it creates invisible to the task projector.

Custom blocks — `toggle`, `callout`, `objectRef`, a view block — have no native
Markdown form. Pick one convention and apply it everywhere: a fenced block
carrying the type and its props, with a human-readable rendering underneath, so
the file stays legible to anything that is not Nexus.

**This is the single hardest piece of work in the plan.** Nothing else in
Phase 7 can start until it round-trips.

### 7b — The decision

Two answers, and choosing the second dissolves two other problems rather than
solving them:

- **Database is the truth, files are an export** *(today)*. Flow-back means
  watching files, parsing edits back, and resolving conflicts against a
  database that may have changed too. `mirror.ts:4` calls two-way sync "a
  genuinely hard problem" and is right.
- **Files are the truth, the database is an index.** Then there is nothing to
  sync. SQLite becomes a derived projection that can be deleted and rebuilt —
  exactly what `page_fts`, `tasks` and `links` already are, one level up.
  Editing a file in Obsidian stops being a sync event and becomes an edit.

The second is the better architecture and the larger rewrite. It also makes
Obsidian compatibility fall out rather than being pursued: you would *be* an
Obsidian vault.

### 7c — Obsidian compatibility

- Properties as YAML frontmatter.
- References and mentions as `[[wiki-links]]`.
- Inline objects written **where they are shown** — a Task inside a note is
  `- [ ] text` in that note's file with its properties as inline fields; a
  Check-in is a row in a table in its Habit's file. An inline object with no
  host goes in one table file per type. *3,650 files a year is not a vault
  anyone wants to open.*
- The folder tree already mirrors directly (`mirror.ts:130`).
- Computed properties (rollups, formulas) write **both**: the current value, so
  the file is useful to other tools, and the definition in frontmatter, so
  nothing is lost on a rebuild. The value is a cache in the file, and the
  definition is the truth.

### Do not

- Do not start 7b before 7a round-trips.
- Do not attempt flow-back while Phase 1–6 migrations are still landing.
- Do not weaken the mirror's safety contract (`mirror.ts:8`) — every path
  verified inside the root, and only manifest files ever deleted.

---

## Deferred, on purpose

Recorded so they are not rediscovered as new ideas.

| Thing | Why not |
|---|---|
| **Spaces** (work / personal partitions) | Wanted eventually, not now. Note that a global property vocabulary shares one namespace across every context — if spaces arrive, each gets its own, and `property_defs.namespace` is where that lands. |
| **More than one type per object** | Decided against. One type per object. |
| **Type inheritance** | Composition through a shared vocabulary gets the same reuse without diamond resolution. |
| **Properties as objects** | Would make the properties panel recursive and drag the whole page lifecycle onto a column heading. |
| **References as roled edges** | Elegant, and it costs `links` its derived status, so `rebuildLinkIndex()` would stop being a safe recovery move. |
| **Generated objects** | Not wanted. |
| **Extension API** | Not a factor yet. Formats and layouts are registries so it stays possible. |
| **Outside query path** (read-only API or CLI) | Wanted eventually. Keeping the formula engine in `repo.ts` is what keeps it cheap. |
| **Checkbox blocks creating Task objects** | A setting for later, never a default. |
