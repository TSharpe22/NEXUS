# ARCHITECTURE OPTIONS — the structural model

> Options, not a recommendation. `STRUCTURE.md` argued one direction; this
> file lays out the space that direction was picked from, so the choice can be
> made deliberately. Nothing here is scheduled and nothing here is built.

---

## What S1 was

S1 was the first stage of the plan in `STRUCTURE.md`, and it meant exactly
this:

**Replace `property_definitions(type_id, key, name, property_type)` with two
tables** — a vault-wide `property_defs` keyed by `key` alone, and a
`type_properties` join saying which properties each type offers and in what
order.

```
property_defs      key PK, name, property_type, created_at
type_properties    type_id, property_key, sort_order
```

Concretely it lands four things:

1. `status` defined on Book and `status` defined on Directive stop being two
   unrelated rows. One property, one definition, renamed in one place.
2. The properties panel stops being driven only by
   `getPropertyDefinitions(typeId)` and instead merges *the page's own
   property rows* with its type's list. A page can then show and edit a
   property its type never declared.
3. That ad-hoc property gets one action — **add to type** — which writes a
   single `type_properties` row and turns practice into schema.
4. A migration that merges existing per-type definitions by key, with a
   collision rule for when two types disagree on a property's type.

**S1 presupposed an answer to a question this file has not asked yet** — that
property schema should be a global vocabulary with types as bundles of
references (option **A2** below). That is one of four live answers. If a
different one wins, S1 is not the first stage; something else is.

---

## The constraints every option has to live inside

Six facts about this codebase that rule things out before taste does.

**1. The mirror is one page, one file, one path.** `computePaths()`
(`mirror.ts:130`) walks `folder_id` up the folder chain and turns it into a
directory path. A page in two folders has no path. Any option that gives a page
multiple parents either breaks the mirror, or has to nominate a primary parent
for it — which is the same as having one parent plus decoration.

**2. Property values are already global; only the schema is not.**
`properties` is `UNIQUE(page_id, key)` (`schema.ts:130`) with no type in the
key, and `getKnownPropertyValues()` (`repo.ts:1532`) queries by key across the
whole vault. Whatever is decided, the value store already behaves like a
vocabulary. Options that keep schema strictly per-type are choosing to keep
that mismatch, which is allowed but should be on purpose.

**3. "Untyped" is not representable.** `pages.type_id` is
`NOT NULL DEFAULT 'note'` (`schema.ts:105`). Every page is at least a Note.
Any option treating type as optional has to either make the column nullable or
keep treating Note as the null.

**4. Projections are the house pattern.** `page_fts`, `tasks` and `links` are
all rebuilt from source and documented as costing nothing to lose
(`schema.ts:203`). Anything derivable — backlinks, inverse relations,
rollups, query membership — should be derived, and an option that needs a
second stored copy of a derivable fact is paying for the privilege.

**5. BlockNote owns the document body.** The first build died fighting the
editor's internals over a custom overlay and column layout (`NEXUS.md:15`).
Any option requiring block-level schema, typed blocks, or database-rows-as-
blocks is re-opening that fight. Structure lives *around* the document, not
inside it — with the one exception of a custom block that only *reads*.

**6. One user, one machine, no sync.** No merge conflicts, no concurrent
writers, no migration coordination across clients. Denormalising is cheap,
rebuilding an index is cheap, and a wrong call is recoverable with a rebuild
rather than a data-loss incident. This is the constraint that makes the more
ambitious options affordable at all.

---

## Axis A — where does property schema live?

### A1. Per-type definitions (status quo, Notion's model)

Schema belongs to the type. `UNIQUE(type_id, key)`.

- **Buys:** nothing new; already built and understood. A type is genuinely
  self-contained, so deleting it takes its schema with it and nothing dangles.
- **Costs:** no reuse — the same property defined on five types is five rows,
  five renames, five option lists. The mismatch in constraint 2 stays. A page
  can never carry anything off-schema.
- **Forecloses:** cross-type queries by property (`show everything with
  status = active`) are always a join through five definitions rather than one.

### A2. Global vocabulary + type bundles (AnyType's model, minus objects)

`property_defs` keyed by `key`; `type_properties` says who offers what.

- **Buys:** one definition per property, reused anywhere. Cross-type queries
  are trivial. Ad-hoc page properties become legal and visible, and
  promote-to-type becomes a one-click gesture. Finishes constraint 2 rather
  than working around it.
- **Costs:** a real migration with a collision rule. Property names become a
  vault-wide namespace, so `name` means one thing everywhere — which is the
  point, but it will occasionally be wrong (a Book's `length` in pages, a
  Workout's `length` in minutes, now one property with one unit).
- **Watch:** the namespace collision is the sharp edge. Mitigation is either
  living with it (rename one), or a namespacing convention (`book.length`),
  which is unpleasant enough that it argues for A3 or A4.

### A3. Global type hints only (Obsidian's model)

No definitions and no bundles. `property_defs` exists solely to say "`due` is
a date, everywhere" — a type registry, not a schema. What a page carries is
whatever it carries; a "type" never declares anything.

- **Buys:** maximum freedom and the smallest possible schema. Nothing to
  migrate — the table is additive, and it can be *derived* from existing
  values on first run. No collision rule needed because there is no membership
  to merge.
- **Costs:** the app can never help. No "this type usually has these
  properties", no empty fields prompting to be filled, no template beyond a
  page. Typos silently make new properties. Tables has no columns to show
  until it infers them from what pages happen to carry.
- **Watch:** this is a real option, not a straw man — it is cheaper than A2,
  strictly more free, and gets much of A2's cross-type benefit. It loses
  precisely the thing structure is for.

### A4. Namespaced vocabulary

A2, but the key is `(namespace, key)` — a property belongs to a namespace
(often but not always a type), and types may import from other namespaces.

- **Buys:** A2's reuse without A2's collision problem. `book.length` and
  `workout.length` coexist; `core.status` is shared by importing it.
- **Costs:** every property now has a two-part identity to display, pick and
  migrate. `properties.key` would have to grow a namespace column, which
  touches the one table with the most rows and the most readers.
- **Watch:** this is the option that is right in three years and wrong now.
  A2 can grow into it later — a namespace column defaulting to `core` is
  additive — so picking A2 does not foreclose it.

---

## Axis B — what is a type?

### B1. A label plus a property bundle (status quo)

One type per page, carrying schema, an icon and a template.

- **Buys:** simple, already built, one type per page means the properties panel
  has one list to render and one order to respect.
- **Costs:** a page that is genuinely two things has to pick. A book you are
  reading *and* logging is a Book with reading fields bolted on, or a Reading
  Log with book fields bolted on, and either way the other type's pages don't
  share the shape.

### B2. A label only

Type carries no schema; it is a tag with a nicer name. Structure comes entirely
from what pages carry (A3) and from queries.

- **Buys:** collapses two concepts into one. Types and tags stop being a
  distinction users have to hold.
- **Costs:** removes the anchor for templates, for Tables' columns, and for the
  habit detection that already exists (`getHabitCandidates()`,
  `repo.ts:1251`, is literally "a type offering both a date and a boolean").
  Several working features are built on type-carries-schema.

### B3. Facets — a page has many types

`pages.type_id` becomes `page_types(page_id, type_id, sort_order)`. A page is a
Book *and* a Reading Log; its properties panel is the union of both bundles.

- **Buys:** composition without inheritance, which is the thing inheritance is
  usually reached for. Structure becomes additive: define a small `Dated`
  facet carrying `date`, apply it to nine types, and the calendar picks all
  nine up. Answers "this note became a project" without retyping anything.
- **Costs:** the largest change on this page. Every reader of `type_id` moves
  (`getPagesSummary`, Tables, the mirror's frontmatter, habit candidates,
  templates, `deleteType`'s re-homing). Templates need a rule for two facets
  both offering one. The properties panel needs an order across bundles.
  Tables needs to decide what "a table of Book" means when a row is also
  three other things.
- **Watch:** this is the highest-ceiling option and the one most likely to
  produce the first build's failure mode — a large refactor whose payoff
  depends on a usage pattern that may not exist. See "cheap probes" below:
  the honest test is counting how many pages in the real vault actually want
  a second type.

### B4. Inheritance — Book extends Media

- **Buys:** shared schema down a hierarchy.
- **Costs:** diamond resolution, override semantics, and a migration question
  every time a parent changes.
- **Verdict:** dominated. B3 gets the same reuse without the hierarchy, and A2
  gets most of it without touching types at all. Neither Notion nor AnyType
  has this. Listed for completeness.

---

## Axis C — how does one page point at another?

### C1. Single-valued relation property (status quo)

`properties.value_relation` holds one page id.

- **Costs:** "books by this author" is not expressible. Already the most-felt
  limit.

### C2. Multi-valued relation table, inverse derived

`property_relations(page_id, property_key, target_page_id, sort_order)`. The
paired side is read out of `links`, which already carries
`source = 'relation'` and `property_key` (`schema.ts:153`).

- **Buys:** ordered multi-targets. Inverses cost nothing and cannot desync.
  Collections stop needing a table — a collection is a page with an ordered
  multi-relation.
- **Costs:** one new table, one migration out of `value_relation`, and every
  reader of relations moves.

### C3. Multi-valued with stored inverse (Notion's model)

Same, but pointing Book→Author writes Author→Books as a real property.

- **Buys:** the inverse is a first-class property — it can be reordered, hidden,
  renamed and rolled up like any other.
- **Costs:** two stored copies of one fact, and all the consistency work that
  implies, against constraint 4. Notion spends real engineering here.
- **Verdict:** the only reason to prefer this over C2 is if inverses need to
  carry their own per-page ordering. They probably don't.

### C4. Collapse relations into the link graph

No relation *property* at all. `links` grows a `role` (`author`, `parent`,
`cites`), and what looks like a relation property in the panel is a **view over
edges with that role**. Mentions are edges with no role.

- **Buys:** one edge table for the whole vault. Mentions, relations, folder
  parentage and collection membership all become the same thing with different
  roles, and the graph view is reading the actual model rather than a
  projection of three. Traversal (`two hops from here`) becomes a query rather
  than a feature.
- **Costs:** relations stop being properties, so everything property-shaped —
  the panel row, the Tables column, the mirror's frontmatter, sorting —
  needs a second path for them. `links` stops being purely derived, which
  breaks the rebuild-from-source guarantee that made schema v9 safe; roles
  written by hand can no longer be regenerated from documents.
- **Watch:** structurally the most elegant option and the one that fights the
  existing code hardest. The loss of "links is derived" is the real price,
  and it is bigger than it looks — `rebuildLinkIndex()` (`repo.ts:1720`) is
  currently a safe recovery move and would stop being one.

---

## Axis D — do tags stay their own system?

### D1. Separate tables (status quo)

`tags` + `page_tags`, flat, many-to-many, case-insensitive, no schema needed.

- **Buys:** tagging costs nothing — no type, no property definition, no
  ceremony. This was a deliberate reversal of the original design and
  `NEXUS.md:77` documents why.
- **Costs:** a third vocabulary to maintain beside properties and types. Tags
  cannot be typed, ordered, or given meaning.

### D2. Tags become a universal multi-select property

One property, `tags`, defined on nothing and available everywhere.

- **Buys:** one mechanism. Tag filters become ordinary property filters, so a
  query language has one fewer field kind.
- **Costs:** re-introduces exactly the ceremony that got it reversed, unless
  properties become genuinely schema-free (A3) — in which case this is nearly
  free. **This option is cheap under A3 and expensive under A1/A2**, which is
  a good example of the axes not being independent.

### D3. Nested tags

`area/health`, `area/work` — parsed at display time, no schema change.

- **Buys:** hierarchy in the one axis that has none, for almost nothing. The
  tag chips group; the filter matches a prefix.
- **Costs:** essentially none. Renaming a parent has to rewrite children,
  which `renameTag()` (`repo.ts:2053`) can do with a `LIKE` update.
- **Verdict:** the cheapest real win on this page, and independent of every
  other decision here.

### D4. Tags become relations to tag pages

A tag is a page; tagging is a relation. Obsidian's MOC practice, formalised.

- **Buys:** a tag gets a body, backlinks, properties of its own — "what is this
  project" has somewhere to live. Collapses tags into C2/C4.
- **Costs:** every tag is now a page in the trash, the mirror, the search index
  and the graph. A vault with 200 tags gains 200 files. The tag chip UI has to
  keep working over something much heavier.

---

## Axis E — how is a page contained and found?

### E1. Folder tree + tags + search (status quo)

One parent, navigable, mirrors directly to disk.

- **Costs:** one axis of placement, and the tree is the only navigable
  structure — everything else is a filter.

### E2. Multi-parent containment

A page lives in many folders.

- **Blocked by constraint 1.** The mirror needs one path. Either it picks a
  primary parent (which is E1 with extra bookkeeping) or the mirror stops
  being a faithful tree. Not recommended unless the mirror's contract changes.

### E3. Queries replace folders

Saved filters, pinned in the sidebar. AnyType's Sets.

- **Buys:** placement stops being a decision. A page is wherever it matches.
- **Costs:** the mirror needs *something* for a path and would fall back to
  flat, which makes the on-disk vault much less browsable — one of the mirror's
  two stated reasons to exist. Also loses navigability: a tree can be explored
  without knowing what you want, a query list cannot.

### E4. Index pages (MOC)

Containment is content: a page holds links to its children. Structure is in the
document, not the schema. Under C2 this is a page with an ordered multi-
relation; under C4 it is a set of edges with a `child` role.

- **Buys:** containment gets a body — the index page can explain itself. Fully
  multi-parent with no schema cost. Nothing to migrate, because it needs no
  feature at all: it works today with `[[wiki-links]]`.
- **Costs:** no tree to render unless one is derived by walking the links, and
  cycles are possible. The mirror still needs folders for paths.

### E5. Folders for paths, queries for everything else

Keep the tree because the mirror and navigation need it; add queries as a
parallel, non-exclusive way in. Both pinned in the same sidebar.

- **Buys:** honest about what each is for. Placement stays cheap and browsable;
  finding stops depending on placement.
- **Costs:** two things in the sidebar that look similar and are not, which is
  a real UI problem and the reason AnyType's Set/Collection split confuses
  people.

---

## The axes are not independent

The couplings worth knowing before picking anything:

- **A determines D2's price.** Tags-as-a-property is nearly free under A3
  (no schema to define) and expensive under A1/A2 (definition ceremony
  returns).
- **B3 needs A2 or A4.** Facets whose bundles come from per-type definitions
  (A1) would give a page two unrelated `status` properties with no way to
  reconcile them. Multi-type requires a shared vocabulary first.
- **C2 makes collections free.** Once relations hold many ordered targets, a
  collection is a page, not a table — which removes a concept from axis E.
- **C4 subsumes D4 and E4.** If edges have roles, tags-as-relations and
  index-pages are the same mechanism, and three axes collapse into one.
- **E is bounded by the mirror.** Any option here is really a question about
  whether the mirror's one-page-one-path contract holds.
- **A2's migration is the only irreversible step on this page.** Everything
  else is additive or rebuildable. Merging the property namespace is not.

**Decision order.** A first — it constrains B and prices D. Then C, because it
decides whether collections and index pages need storage. Then D and E, which
are mostly independent once A and C are settled. Views last: they consume the
model and change nothing about it.

---

## Four coherent stances

Picking per-axis à la carte produces incoherent systems. These four hang
together.

| | Consolidate | Emergent | Vocabulary | Facets |
|---|---|---|---|---|
| **A** schema | A1 per-type | A3 hints only | A2 global | A2 global |
| **B** type | B1 bundle | B2 label | B1 bundle | B3 many |
| **C** relation | C3 stored inverse | C2 derived | C2 derived | C2 derived |
| **D** tags | D1 + D3 | D2 property | D1 + D3 | D1 + D3 |
| **E** organise | E1 tree | E3 queries | E5 both | E5 both |
| **Migration risk** | low | very low | medium | high |
| **Ceiling** | low | medium | high | highest |
| **Fights the code** | no | a little | some | a lot |

**Consolidate** — finish what the MVP started without changing its shape. Fix
multi-relations, add views to Tables, leave schema per-type. Smallest possible
step; you keep the mismatch in constraint 2 and the ceiling stays where it is.
Right answer if the honest need is "relations should hold more than one thing"
and nothing more.

**Emergent** — go the other way and delete structure rather than add it.
Properties are free-form with global type hints, a type is a label, tags are a
property, queries replace the tree. Cheapest to build, most free, and the app
stops being able to help you. Right answer if the real complaint is that the
MVP's structure is *in the way* rather than insufficient.

**Vocabulary** — the `STRUCTURE.md` direction. Global properties, types stay
single and become bundles, relations multi-valued with derived inverses, tree
and queries side by side. Highest ceiling reachable without a large refactor,
and the only stance where practice→schema promotion is a first-class gesture.
One irreversible migration.

**Facets** — Vocabulary plus many types per page. The most expressive model
available and the only one where "this note is also a project now" is additive.
Touches every reader of `type_id` in the codebase and its payoff depends on a
usage pattern that has not been demonstrated yet.

---

## What I would pick, stated separately

**Vocabulary**, with two amendments: take **D3** (nested tags) immediately
since it is independent and nearly free, and design `property_defs` with a
`namespace` column defaulted to `core` from day one — unused at first, but it
makes **A4** additive later instead of a second irreversible migration.

**Facets is the tempting one and the one to defer.** Not because it is wrong —
it may well be where this ends up — but because Vocabulary is a strict prefix
of it. A2 is required by B3 anyway, so building Vocabulary first costs nothing
against a later move to Facets, and the interval produces the evidence for
whether Facets is needed at all.

---

## Cheap probes before committing

Ways to test a stance against the real vault without writing app code.

1. **Count the pages that want a second type.** Read your vault and list pages
   whose title or properties suggest they are two things. If it is under a
   dozen, Facets is not paying for itself yet.
2. **Count property-name collisions.** `SELECT key, COUNT(DISTINCT type) FROM
   properties GROUP BY key HAVING COUNT(DISTINCT type) > 1` — every row is a
   case A2's migration has to resolve and A4 would have avoided. If this is
   zero, A2's only real cost evaporates.
3. **Write the ten queries you actually want**, in English, before designing
   the filter tree. If most are single-type, E1 plus a better Tables covers
   them and E5 is premature. If most cross types, A1 is already the bottleneck.
4. **Count how deep the folder tree actually is.** A tree that is one level
   everywhere is a tag system with worse ergonomics, and E3 becomes much more
   attractive.
5. **List the relations you would draw** and mark each single or multi. If
   fewer than a third are multi, C1 is not the limit it feels like.

Each of these is a question about the vault as it is, and every one of them
changes which stance is right. None require touching the code.
