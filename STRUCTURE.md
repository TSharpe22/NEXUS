# STRUCTURE — the model after the MVP

> Exploration, not a milestone. This file argues for a direction; it does not
> schedule it. Read `NEXUS.md` first — everything here is a delta against the
> model that file describes.

---

## The question

The MVP shipped a working page/type/property model. The complaint against it
is not that anything is broken — it is that the structure available to the
user is fixed at the level the MVP chose, and there is no way to reach past
it. You cannot say "this relation points at many pages", "these two types
share the same `status` property", "show me every page where `status = active`
and `due < next week`", or "put that list inside this note". Each of those is
a different kind of control, and the MVP has none of them.

The tension to hold, stated as the brief did: **structure is important but so
is freedom.** Those pull apart in a specific way, and every system below has
picked a side. The design goal of this document is to not pick.

---

## Where the model actually is

Grounded in the code, not the intentions.

**A page** (`schema.ts:103`) has a title, a body, one optional `type_id`, one
optional `folder_id`, a pinned flag. Everything else about it lives in other
tables.

**A type** (`schema.ts:62`) is a name, an icon, and a template page. That is
the whole of it. It owns property definitions and nothing else.

**A property definition** (`schema.ts:72`) is `UNIQUE(type_id, key)` — the
schema is scoped to a type. `status` on Book and `status` on Directive are two
unrelated rows that happen to collide on a string.

**A property value** (`schema.ts:121`) is `UNIQUE(page_id, key)` — the value
store is **not** scoped to a type. It is keyed by page and key alone.

Those last two sentences are the most important fact in this file. *The values
are already a global vocabulary; only the schema is per-type.* The evidence is
`repo.getKnownPropertyValues()` (`repo.ts:1532`), which answers "what values
has this property ever held" with a query over `properties` by `key` across
the entire vault, joining no type at all. The suggestion list in the
multi-select editor is already reading a global property vocabulary that the
schema layer pretends does not exist.

So the model is not two designs in tension. It is one design, half-built.

**What follows from the halves not matching:**

- A relation holds exactly one target — `value_relation` is a single TEXT
  column (`schema.ts:129`), `setProperty` writes one id (`repo.ts:1470`), and
  the Tables cell renders one title (`Tables.tsx:20`). "Books by this author"
  is not expressible.
- Selects have no options. There is no options table; the editor infers the
  list from values already typed. Options therefore have no colour, no order,
  and cannot be renamed across pages.
- A multi-select is a JSON array stringified into `value_text`. Nothing can
  query into it; `getKnownPropertyValues` unpacks it by hand at read time.
- A page cannot carry a property its type does not define — the panel is
  driven entirely by `getPropertyDefinitions(typeId)`.
- There are no saved views. Tables holds a sort and a filter in React state
  and drops both when you change type (`Tables.tsx:101`).
- A type has exactly one template (`types.template_page_id`, schema v7).

None of that is a bug. It is the MVP's floor, and the floor is where we are
standing.

---

## What the three systems actually do

Not feature lists — the structural commitment each one made, and the price.

### Notion — the container is the schema

A database is a block; its rows are pages; the schema belongs to the database.
Views (table, board, calendar, gallery, timeline) are saved objects hanging off
the database, each carrying its own filters, sorts, grouping and column
visibility. Relations are two-way: pointing Book→Author silently creates
Author→Books on the other side. Rollups aggregate across a relation, formulas
compute per row.

**The price:** a page belongs to one database and inherits its schema wholesale.
There is no property vocabulary above the database, so `Status` in three
databases is three unrelated properties, and moving a page between databases is
a re-creation. Structure is excellent and total; freedom is whatever the
database owner left you.

**Worth taking:** views as saved, first-class objects on a query. Grouping as
the thing that turns one query into a board or a calendar rather than each
layout being its own feature.

### Obsidian — there is no schema

Files, folders, YAML frontmatter, links, and nested tags (`area/health`).
Structure is emergent and after the fact: you write, and then Dataview queries
the frontmatter as if it had been a schema all along. Property *types* are
declared globally in `types.json`, keyed by property name across the whole
vault — not per note, not per folder.

**The price:** nothing is guaranteed. A typo makes a new property. A relation
is a string that may not resolve. There is no way to say "a Book has an author"
and have the app help you honour it — and no gesture that turns a pattern you
have repeated forty times into a rule.

**Worth taking:** the global property vocabulary keyed by name. Nested tags.
And the posture — *no page is ever required to have any of it.*

### AnyType — the property is the first-class citizen

Objects have a Type; a Type is a bundle of **Relations**, and Relations are
themselves objects that exist independently and are reused across types. A
Type marks which of its relations are featured, recommended, or hidden. **Sets**
are saved queries over a type or relation — dynamic, membership computed.
**Collections** are manual, ordered lists — static, membership chosen.

**The price:** relations being full objects makes every schema edit a document
edit, and the object graph becomes recursive in a way that is hard to render
and harder to explain. The Set/Collection distinction is correct but arrives
as two separate UI concepts users routinely confuse.

**Worth taking:** the property as the first-class citizen, with types as
bundles of references to it. And the Set-vs-Collection distinction, which is
the cleanest available formalisation of "a query" versus "a list".

---

## The direction

Six moves. The first one is the one that matters; the rest fall out of it.

### 1. Promote properties to a global vocabulary; make a type a bundle

Replace `property_definitions(type_id, key, …)` with two tables:

```
property_defs      key (PK), name, property_type, config JSON, created_at
type_properties    type_id, property_key, sort_order, role, is_required
```

`property_defs` is the vault's vocabulary — one row per property that exists
anywhere, keyed the way `properties` values are already keyed. `type_properties`
says which of them a type offers, in what order, and how prominently.

This is the half-built design finished. It also buys three things at once:

- **Reuse.** Defining `status` on Book and then on Directive gets you the same
  property, the same options, the same colour. Renaming it renames it once.
- **Ad-hoc properties become legal.** `properties` is keyed by `(page_id, key)`
  and always was — a page can already carry a value for a key its type never
  declared. Today the panel simply cannot see it. Once the panel reads *the
  page's own property rows* and merges them with its type's list, freedom and
  structure stop competing: type properties render first, extras render under
  a divider, and everything is editable.
- **Promotion becomes a gesture.** An ad-hoc property carries one action: *add
  to type*. That writes one `type_properties` row and the ad-hoc thing becomes
  schema. This is the move neither Notion (structure first, no path from
  practice) nor Obsidian (practice only, no path to structure) offers, and it
  is the best single argument for building this at all.

**Rejected: properties as pages** (AnyType's actual model). Tempting for the
purity — a property would get a body, backlinks, its own row in the graph. But
it makes the properties panel recursive, makes every schema edit a page write,
and drags the whole page lifecycle (trash, restore, mirror, FTS) onto something
that is a column heading. A global table gets the entire reuse benefit and none
of that. Revisit only if properties start wanting documentation attached.

**Rejected: type inheritance.** "Book extends Media" looks like the obvious
next step and is not: it buys what a shared vocabulary already buys, and adds
diamond resolution, override semantics, and a migration question every time a
parent changes. AnyType does not have it either. Composition through
`type_properties` is the answer.

### 2. Give properties a config

`property_defs.config` is JSON, per property type:

- `select` / `multi_select` — the option list, with colour and order. This is
  the first time options exist as objects rather than as whatever has been
  typed, which is what lets an option be renamed everywhere at once.
- `relation` — the type(s) a target may have (a soft constraint: filters the
  picker, never rejects a write), whether it holds one target or many, and the
  inverse key (see 3).
- `number` — format and precision.
- any — a default value applied at page creation.

Config in one JSON column rather than a column per knob, because the knobs
differ per property type and the set of them will keep moving. Read through a
narrow accessor, never `JSON.parse` at call sites.

`multi_select` values should also stop being a stringified array in
`value_text`. Once options are real, a `property_multi(page_id, key, value,
sort_order)` table makes them queryable and groupable, which is what a board
view needs.

### 3. Relations point at many pages, and inverses are derived

```
property_relations   page_id, property_key, target_page_id, sort_order
```

`value_relation` migrates in and stays readable for one schema version so
nothing outside has to move on the same day.

**Inverses are computed, never stored.** A relation's config may name an
inverse key: Book's `author` declares its inverse as `books`, and Person's
`books` is then a *derived* list read out of `links` — which already carries
`source = 'relation'` and `property_key` for exactly this shape
(`schema.ts:153`, added in schema v9). Notion stores both sides and spends real
engineering keeping them consistent. We already have the projection; a second
stored copy could only ever disagree with it.

This is also the repo's existing convention rather than a new one. `page_fts`,
`tasks` and `links` are all projections rebuilt from source, documented as such
in `schema.ts`. Derived inverses, rollups and query membership are the same
pattern extended — nothing new to learn, and nothing that can be the only copy
of anything the user typed.

### 4. Queries are objects; views are how you look at one

```
queries    id, name, icon, filter JSON, sort JSON, view JSON, pinned, created_at
```

A query is a named, saved filter over pages. The filter is a tree so that `and`
/ `or` nest:

```jsonc
{ "op": "and", "of": [
  { "field": { "kind": "type" }, "cmp": "is", "value": "book" },
  { "field": { "kind": "property", "key": "status" }, "cmp": "is", "value": "reading" },
  { "op": "or", "of": [
    { "field": { "kind": "tag" }, "cmp": "has", "value": "fiction" },
    { "field": { "kind": "property", "key": "rating" }, "cmp": "gte", "value": 4 }
  ]}
]}
```

`field.kind` covers `type`, `property`, `tag`, `folder`, `title`, `created`,
`updated`, `pinned`, `backlink`. Getting this shape right early matters more
than anything else in the plan — moves 4, 5 and 6 all serialise it, and a
filter tree that has to change shape later invalidates every saved query in
the vault. It compiles to SQL in one place in `repo.ts` and is never
interpreted in the renderer.

`view` is the layout and its parameters: `list | table | board | calendar`,
plus visible columns and a group-by key. **Grouping is what makes a layout**,
which is the useful part of Notion's design: a board is a query grouped by a
select or a relation; a calendar is a query grouped by a date property. Two
layouts, one mechanism, no per-layout query code.

**Tables should be rebuilt as a query with `type is X` prefilled.** Not as a
migration chore — as the proof. If the existing view cannot be expressed as a
query, the query model is wrong and we find out before anything depends on it.

**A Collection needs no table.** AnyType's Set/Collection split is right, but
once relations hold many targets (move 3), a collection is *a page with an
ordered multi-relation property*. It gets a body, a title, an icon, backlinks
and mirroring for free, and it is one fewer concept. Sets need storage;
collections do not.

### 5. A query can be a block

The document already carries custom React blocks — `toggle` and `callout` in
`editor/custom-blocks.tsx`. A `query` block holding a query id (or an inline
filter) renders its result inside the note.

This is Notion's inline database and Obsidian's Dataview block arriving as the
same object, and it is the single feature that makes the rest feel like a
system instead of a settings screen: the structure you defined shows up where
you are actually writing.

One caution recorded now because it will bite later: the mirror serialises
documents to Markdown (`mirror.ts`), and a query block has no stable Markdown
form. Write it as a fenced block carrying the query id and a rendered snapshot
underneath, so the export stays readable to anything that is not Nexus.

### 6. Rollups, and no formula language

A rollup is a read-only computed property: *over relation `author`, take
`count` / `sum` / `min` / `max` / `first` of property `rating`*. Config-shaped,
maybe fifty lines against the relation table, and it covers most of what people
actually reach for.

**A formula language is out.** Parser, evaluator, type system, error surfacing,
recursion guard, and a syntax to document — a project in its own right, against
"do less, do it well." Rollups first; revisit only if real use produces a
concrete question rollups cannot answer.

---

## How freedom stays available

Four rules that keep the above from becoming the thing it is trying to fix.

1. **Nothing new is ever required.** A page with no type, no properties, no
   query and no folder must keep working exactly as it does today. Every
   structure here is opt-in, and the app must never open a dialog to make
   someone choose one.
2. **A type is a suggestion.** It offers properties and orders them. It does not
   restrict what a page may carry, and `is_required` is a hint the panel shows,
   never a write that gets rejected.
3. **Practice can always become schema.** Every ad-hoc property is one click
   from being part of a type. Every filter typed into a box is one click from
   being a saved query. The path from freedom to structure is the product.
4. **Structure round-trips through the mirror.** If it cannot be written into
   frontmatter or a fenced block and read back, it is not finished. The vault
   is the user's, in files, and a structure that only Nexus can read is a
   structure they do not own.

---

## Staging

Each stage lands on its own, and the app is shippable after every one.

| # | Schema | What lands | Why here |
|---|---|---|---|
| S1 | v11 | `property_defs` + `type_properties`; panel shows ad-hoc properties; promote-to-type | Everything else depends on the vocabulary being global |
| S2 | v12 | `property_defs.config`; real select options with colour/order; `property_multi` | Boards in S4 need groupable options |
| S3 | v13 | `property_relations`; multi-target relations; derived inverses | Collections in S4 are a multi-relation |
| S4 | v14 | `queries` + filter tree + list/table views; Tables rebuilt as a query | The filter tree is the schema everything after this serialises |
| S5 | v14 | board and calendar as group-by over the same query | No new storage — proves the grouping model |
| S6 | v15 | query block in the editor | Wants S4 stable first |
| S7 | v16 | rollups | Wants S3 stable first |

Alongside, needing no schema change: nested tags by parsing `/` at display
time, and more than one template per type (a type's templates are its pages
carrying an `is_template` flag, which is a property, not a column).

**S1 carries the only real migration risk since v1.** Merging per-type
definitions into a global vocabulary has to decide what happens when Book's
`status` and Directive's `status` disagree on property type. The rule: same key
and same type merge; same key and different type keep the first and suffix the
second (`status_2`), with every affected value rewritten in the same
transaction. It should take a backup first — `applySchema` already accepts a
`backup` callback for exactly this — and `scripts/check-migration.mjs` should
grow a fixture with a deliberate collision in it before the code is written.

---

## Open questions

- **Does a query belong in the sidebar, or is it a page?** A saved query with a
  name and an icon is very close to a page that happens to have no body. Making
  it a page would collapse queries and collections into one concept and give
  queries backlinks and mirroring for free. It would also mean the sidebar is
  listing pages that are secretly views, which may be worse than a second list.
  Not resolved; S4 can start with a table and move later, since a query is
  addressed by id either way.
- **Should `type_properties.role` exist at all in S1?** AnyType's
  featured/recommended/hidden is real ergonomics on a type with twenty
  properties and pure ceremony on one with three. Possibly `sort_order` plus a
  "show under the fold" cut line is the whole of it.
- **What happens to folders once queries exist?** A folder is a manual,
  single-parent, hierarchical query. It is not obviously worth keeping as its
  own axis if a saved query can be pinned in the same sidebar — but the tree is
  navigable in a way a flat list of queries is not, and navigation was the
  point of it. Leave both; revisit once queries have been used for a while.
- **Where does the graph fit?** Multi-relations and derived inverses will
  multiply edges considerably. The graph already had scaling work done on it
  (`QA_SCAN.md` §4); S3 should re-check it rather than discover it.
