# ARCHITECTURE OPTIONS — the structural model

> Options, not a recommendation. `STRUCTURE.md` argued one direction; this file
> lays out the space it was picked from. Nothing here is scheduled or built.
>
> Revised after working through what "property schema" actually decomposes
> into. The earlier draft treated relations as their own architectural axis;
> that was wrong in a way that mattered, and §3 says why.

---

# Part 1 — Definitions

Most of the confusion in this area comes from four separate questions being
asked with one word. Separating them makes every later option obvious.

## 1.1 What "property schema" means

A property schema is the set of rules governing the fields a page can carry. It
is **four independent questions**, and a design is a set of four answers:

| | Question | Example of it going wrong |
|---|---|---|
| **Identity** | What makes two properties *the same property*? | Renaming `status` on Book leaves Directive's `status` untouched |
| **Format** | What kind of value does it hold? | `due` is a date on one page and a string on another |
| **Membership** | Which pages are expected to carry it? | Every page shows every property that exists anywhere |
| **Constraint** | Which values are legal? | A relation points at a page that was deleted last week |

**The diagnosis of the current code, in one line: Nexus answers Identity and
Membership with the same table, and that fusion is the source of nearly every
limit you have hit.**

`property_definitions(type_id, key, name, property_type)` with
`UNIQUE(type_id, key)` (`schema.ts:72`) says *simultaneously* "this is which
property it is" and "this is who carries it." You cannot change one without
changing the other. That is why:

- The same property on two types is two properties (Identity is trapped inside
  Membership).
- A page cannot carry anything off-schema (Membership is enforced, because it
  is the only thing establishing Identity).
- Tags needed their own tables (see §1.4).

Meanwhile `properties` — the *values* — is `UNIQUE(page_id, key)`
(`schema.ts:130`), keyed by name alone with no type in sight. So the value
store already answers Identity globally and Membership not at all. **Half the
system already works the way you are describing.**

### Options for Identity

- **I1 — per-type key** *(status quo)*. `(type_id, key)`. Two types, two
  properties, no reuse.
- **I2 — global key**. `key` alone. `status` is one property everywhere.
  Matches how values are already keyed. Risk: one namespace, so a Book's
  `length` (pages) and a Workout's `length` (minutes) collide.
- **I3 — namespaced key**. `(namespace, key)` — `book.length`,
  `workout.length`, `core.status`. Solves the collision; adds a two-part
  identity to every display, picker and migration.
- **I4 — opaque id + display name**. Identity is a uuid; the name is just a
  label and two properties may share one. Maximum flexibility, and the worst
  ergonomics — you cannot type a property name and mean it, and the mirror's
  frontmatter has no natural key to write.

### Options for Format

`PropertyType` today: `text | number | date | boolean | select | multi_select |
relation | url` (`shared/types.ts:62`). The open questions are not which formats exist
but two knobs that cut across them:

- **Cardinality** — one value or many. Currently `multi_select` is the only
  many, and it cheats by stringifying a JSON array into `value_text`.
- **Whether `relation` is a format or a separate concept.** It is a format.
  See §1.3.

### Options for Membership

- **M1 — enforced by type** *(status quo)*. A page carries exactly what its
  type declares. The panel cannot render anything else.
- **M2 — suggested by type**. The type offers a list and an order; a page may
  carry more. The panel shows type properties first, then extras.
- **M3 — emergent**. Nothing declares membership. What a page carries is what
  it carries; "which properties does a Book have" is answered by looking at
  Books.

### Options for Constraint

- **K1 — none** *(status quo, effectively)*. Select options are inferred from
  values already typed (`getKnownPropertyValues`, `repo.ts:1532`); relations
  may point at anything.
- **K2 — soft**. Constraints filter the picker and flag violations, never
  reject a write. A relation "limited to Person" shows Persons first and lets
  you pick anything.
- **K3 — hard**. The write is rejected.

**K3 is the one option in this document I would argue against outright.** In a
single-user local app, a rejected write is the app telling you that you are
wrong about your own notes. K2 gets all the ergonomic benefit — the picker is
short, the query is reliable — and never blocks you.

## 1.2 What a type is

Once Identity is separated from Membership, a type stops being an owner and
becomes something much smaller. **A type is a named set of membership
assertions, plus presentation.** That is genuinely all it needs to be: "pages
of this kind usually carry these properties, in this order," plus an icon, plus
a starting template.

Options:

- **T1 — Owner** *(status quo)*. Type owns Identity and Membership. Deleting a
  type deletes its property definitions.
- **T2 — Bundle**. Type references properties that exist independently.
  Deleting a type deletes no property and no value; pages fall back to Note.
  AnyType's model.
- **T3 — Label**. Type asserts nothing; it is a tag with an icon. Structure
  comes entirely from what pages carry and from queries.
- **T4 — Facet**. T2, but a page has *many*. Its property list is the union of
  its types' bundles. "This note is also a Project" becomes additive.

Under T2/T3/T4, note what a type *stops* being: a container. A page's type
does not say where it lives, what it may point at, or what it may carry. It is
advice with an icon.

## 1.3 What a relation is — and why it is not its own axis

> *"Wouldn't a relation just apply across a type or something? Or, you could
> apply it and set its value to anything?"*

**A relation is a property whose format is "page reference."** It is not a
separate kind of thing, and Nexus already models it that way: `relation` is a
member of `PropertyType`, and its value lives in `properties.value_relation`
alongside `value_text` and `value_number` (`schema.ts:121`).

AnyType reached the same conclusion and then went further — it has renamed
Relations to **Properties** outright, with "Object" as one of the available
formats: *"a reference to another object, such as a person, task, or
document."* The model diagram still uses the older word and defines it the
same way: *"Relation: properties which connect objects to each other in the
graph."* Its current onboarding has no Relations screen at all — the sequence
is Vault → Channels → **Objects → Types → Properties → Views**. One concept,
two names, and the newer name is the honest one.

That onboarding order is itself an argument. Objects come first, Types
classify them afterwards, Properties describe them, Views look at them.
Structure is layered onto content that already exists rather than being the
price of creating it — which is M2/M3, not M1.

So your question has a clean answer: **there is no relation architecture to
decide, only three knobs, and all three are the ordinary property questions
asked of a reference-format property.**

| Knob | This is really | Options |
|---|---|---|
| Which pages can carry it | **Membership** (§1.1) | M1 / M2 / M3 — same answer as every other property |
| What it may point at | **Constraint** (§1.1) | anything · limited to type(s) · limited to a saved query |
| How many targets | **Format cardinality** | one *(status quo)* · many, ordered |

"Apply it across a type" is M2. "Apply it and set its value to anything" is
M3 + K1. Both are coherent, both are what AnyType does depending on how you
configure it, and neither needs a new subsystem — they need `property_defs` to
carry a `config` blob with `cardinality` and `target_types` in it.

**Correction to the earlier draft.** It listed C1–C4 as if picking among them
were an architectural decision on the scale of the others. Three of those four
were cardinality and inverse-storage choices dressed up as architectures. Only
one is genuinely a different model:

- **R-collapse — edges with roles.** Delete the reference format. `links` grows
  a `role`, and everything that looks like a relation is a *view over edges*.
  Mentions, relations, folder parentage and collection membership become one
  table. Elegant, and it fights the code hardest: relations stop being
  properties (so the panel, the Tables column and the mirror's frontmatter all
  need a second path), and `links` stops being purely derived — which means
  `rebuildLinkIndex()` (`repo.ts:1720`) stops being a safe recovery move.

That is the only real fork. Everything else is configuration.

**One thing genuinely worth deciding: inverses.** If Book has `author`, does
Person get `books`? Two answers: **store it** (Notion writes a paired property
on the other side, and spends real engineering keeping the two consistent) or
**derive it** (read it out of `links`, which already carries
`source = 'relation'` and `property_key` from schema v9, `schema.ts:153`).
Deriving is strictly better here — it cannot desync, it matches the house
pattern, and the projection already exists. Storing only wins if an inverse
needs its own manual ordering, which it almost certainly does not.

## 1.4 What a tag is — and whether it is redundant

> *"I think tags may be redundant with more advanced data analysis or 'stuff'
> like properties/relations."*

**You are right, and the condition under which you are right is exactly the
decision in §1.1.**

A tag is a property with format `multi_select`, membership M3 (every page may
carry it), and constraint K1 or K2 (an option list with colours). Nexus already
has that format. `tags` + `page_tags` is a second implementation of something
the property system can already express.

Why does it exist, then? `NEXUS.md:77` records the reason, and it is worth
reading closely:

> *"The original design made them a `multi_select` property. In practice that
> meant you could not tag anything until you had defined a property on the
> page's type — schema design as the price of admission for 'mark this note as
> reading.'"*

That reason is **entirely an artifact of M1**. The ceremony was never inherent
to properties; it came from membership being enforced by type. Move to M2 or
M3 and the price of admission disappears — you type a tag, a property named
`tags` acquires a value, and nothing had to be declared first.

AnyType's resolution is the clean one and worth stating as a slogan: **Tag is a
format, not a system.**

Three honest caveats before collapsing them:

1. **Multi-value properties have to become real first.** `multi_select` is a
   stringified JSON array in `value_text`, which cannot be indexed, grouped or
   joined. `page_tags` is a proper indexed join table — today it is the
   *better* implementation. Collapsing tags into properties before building a
   `property_multi(page_id, key, value, sort_order)` table would be a
   downgrade. **Sequence matters: multi-value storage first, then collapse.**
2. **Colour and zero-friction creation are real ergonomics**, not accidents.
   `addTagToPage` creates the tag if it does not exist (`repo.ts:2016`).
   Whatever replaces it has to keep that gesture, or tagging gets worse.
3. **A tag chip and a property row are different UI at different altitudes.**
   Collapsing the *storage* does not require collapsing the *presentation* —
   a property with format `multi_select` and a `render: chips` hint can still
   appear under the title rather than in the panel. Storage and chrome are
   separable, and conflating them is what makes "collapse tags" sound lossy
   when it is not.

There is a fourth option worth naming since it goes the other direction:
**tags as pages** (a tag gets a body, backlinks, properties of its own —
Obsidian's MOC practice formalised). It buys "what *is* this project" a place
to live and costs 200 extra pages in the trash, the mirror, the search index
and the graph for a vault with 200 tags.

---

# Part 2 — The revised axes

With the definitions above, the decision space is smaller than the earlier
draft made it look. Five decisions, in dependency order:

1. **Identity** — I1 / I2 / I3 / I4 *(§1.1)*
2. **Membership** — M1 / M2 / M3 *(§1.1)*
3. **Type** — T1 / T2 / T3 / T4 *(§1.2)* — mostly determined by 1 and 2
4. **Reference model** — property-format *(status quo)* or R-collapse *(§1.3)*
5. **Containment** — see below

Cardinality, constraints, inverses and tags are **consequences**, not
decisions: settle 1 and 2 and each has an obvious answer.

## Containment — how is a page placed and found?

The one axis the definitions do not dissolve, because it is bounded by
something outside the model: **the mirror needs exactly one path per page**.
`computePaths()` (`mirror.ts:130`) walks `folder_id` up the chain and turns it
into a directory path.

- **E1 — Folder tree** *(status quo)*. One parent, navigable, mirrors directly.
- **E2 — Multi-parent**. *Blocked by the mirror* — either it stops being a
  faithful tree, or a primary parent is nominated, which is E1 with
  bookkeeping.
- **E3 — Queries replace folders**. Placement stops being a decision; a page is
  wherever it matches. Costs the on-disk vault its browsability, which is one
  of the mirror's two stated reasons to exist.
- **E4 — Index pages (MOC)**. Containment is content: a page holds an ordered
  reference-property listing its children. Fully multi-parent, no schema cost,
  and it works *today* with wiki-links. No tree to render unless one is derived
  by walking links; cycles possible.
- **E5 — Both**. Folders for paths and navigation, queries for finding. Honest
  about what each is for; costs two similar-looking things in one sidebar.

### The level above: spaces

AnyType's onboarding opens on a level Nexus does not have at all — a **Vault**
holding several **Channels** (Personal, Family, Work, Community), each with its
own objects, types and properties. Notion has the same idea as workspaces;
Obsidian as separate vaults you switch between.

Nexus has exactly one vault, and `NEXUS.md:548` puts "sections/vaults"
explicitly out of MVP scope. It is worth naming as its own axis because it is
the only structural question that **cannot be reached from the others** —
folders, tags, types and queries all partition *within* one namespace, while a
space partitions the namespace itself, including the property vocabulary.

- **S1 — One vault** *(status quo)*. Everything shares one property namespace,
  one type list, one graph.
- **S2 — Multiple spaces, separate databases**. Clean isolation, and switching
  is a restart-shaped operation. This is Obsidian's model and the cheapest by
  far — it is mostly a file path.
- **S3 — Multiple spaces, one database**. A `space_id` on nearly every table.
  Enables cross-space search and moving pages between spaces; touches every
  query in `repo.ts` and makes the mirror decide whether spaces are directories.

**This interacts with Identity.** If work and personal notes share one vault
(S1), a global property namespace (I2) has to hold both, and `status` means one
thing across contexts that may not agree — which is an argument for I3
namespacing that has nothing to do with Book-vs-Workout collisions. If spaces
exist (S2/S3), each gets its own namespace and I2 is safe inside one.

Deciding this is not urgent, but deciding I2 *without* considering it is how a
second irreversible migration gets created later.

---

# Part 3 — The four stances, defined

À-la-carte picking produces incoherent systems. These four hang together. Each
is given as: the commitment, the literal tables, what creating a book with an
author feels like, and what it forecloses.

## Stance 1 — Consolidate

**Commitment:** the MVP's shape was right; it is just unfinished. Fix what is
missing without changing what anything *is*.

**Answers:** I1 · M1 · T1 (owner) · property-format references · E1.

**Tables:** unchanged. `property_definitions` keeps `UNIQUE(type_id, key)`.
Add `property_multi` for real multi-values, `cardinality` in a config column,
and saved views on Tables.

**Creating a book with an author:** define type Book; define property `author`
on Book, format reference, cardinality many; create the page; pick authors.
Defining `author` on Person later is a separate, unrelated property.

**Forecloses:** cross-type queries stay awkward. Tags can never collapse —
under M1 the ceremony argument in §1.4 still holds, so they stay a parallel
system forever. Facets are unreachable without redoing this.

**Who builds it:** Notion, essentially.

## Stance 2 — Emergent

**Commitment:** the MVP's structure is *in the way* more than it is
insufficient. Delete schema rather than add it.

**Answers:** I2 · M3 · T3 (label) · property-format references, unconstrained
· E3 or E4.

**Tables:** `property_defs(key, name, format)` as a *hint registry* only —
derivable from existing values, so nothing to migrate. `type_properties` never
exists. `tags` collapses into a property. Folders optionally deprecated in
favour of saved queries.

**Creating a book with an author:** create a page, type `author` into the
properties panel, point it at a Person. Nothing was declared. "Book" is a value
of a property, or a tag, or nothing at all.

**Forecloses:** the app can never help — no "Books usually have these fields,"
no empty prompts, no meaningful template, no columns in Tables until it infers
them. Habit detection (`getHabitCandidates()`, `repo.ts:1251`, literally "a
type offering both a date and a boolean") stops having anything to detect.

**Who builds it:** Obsidian.

## Stance 3 — Vocabulary

**Commitment:** separate Identity from Membership. Properties exist in their
own right; types point at them.

**Answers:** I2 (with a `namespace` column defaulted to `core`, unused at
first, so I3 stays additive later) · M2 · T2 (bundle) · property-format
references with K2 soft constraints · E5.

**Tables:**

```
property_defs     key PK, namespace, name, format, config JSON
type_properties   type_id, property_key, sort_order
property_multi    page_id, key, value, sort_order      -- multi-values, real
property_refs     page_id, key, target_page_id, sort_order
queries           id, name, filter JSON, view JSON, pinned
```

`tags`/`page_tags` collapse into a `tags` property once `property_multi`
exists. Inverses derived from `links`. Collections need no table — a collection
is a page with an ordered reference property.

**Creating a book with an author:** define type Book; add `author` to it,
picking from properties that already exist or creating one. `author` is now
available to any type. Type it onto a page that is not a Book and it works —
then click **add to type** to make that a rule.

**Forecloses:** a page is still one thing. "This note became a project" means
retyping it and losing the old bundle.

**Who builds it:** AnyType, closely.

## Stance 4 — Facets

**Commitment:** Vocabulary, plus a page is many things at once.

**Answers:** I2/I3 · M2 · T4 (facet) · property-format references · E5.

**Tables:** Stance 3, plus `page_types(page_id, type_id, sort_order)` replacing
`pages.type_id`.

**Creating a book with an author:** as Stance 3. Then later, apply the Reading
Log facet to the same page and it gains `started`, `finished`, `rating` without
losing anything. Define a small `Dated` facet carrying `date`, apply it to nine
types, and the calendar picks up all nine.

**Forecloses:** little. The cost is not foreclosure, it is work — every reader
of `type_id` moves (`getPagesSummary`, Tables, the mirror's frontmatter, habit
candidates, templates, `deleteType`'s re-homing), templates need a rule when
two facets both offer one, and Tables must decide what "a table of Book" shows
when rows are also three other things.

**Who builds it:** nobody in the survey, fully. This is the one that would be
genuinely novel — and correspondingly the one with no proven design to copy.

## Side by side

| | Consolidate | Emergent | Vocabulary | Facets |
|---|---|---|---|---|
| Identity | per-type | global | global | global |
| Membership | enforced | emergent | suggested | suggested |
| Type is | owner | label | bundle | facet, many |
| Tags | stay separate | collapse | collapse | collapse |
| Migration risk | low | very low | medium | high |
| Ceiling | low | medium | high | highest |
| Fights the code | no | a little | some | a lot |
| Prior art | Notion | Obsidian | AnyType | none |

---

# Part 4 — The three systems against your vision

## 4.1 Your vision, as stated

Assembled from what you have actually said, not what I would like you to mean:

- **V1 — Structure and freedom, without trading one for the other.** *"Structure
  is important but so is freedom."*
- **V2 — You can build your own structure, and complexity is an acceptable
  price.** *"even if it introduces complexity."*
- **V3 — Properties and references should be flexible.** *"you could apply it
  and set its value to anything."*
- **V4 — Tags are probably redundant given a good property system.**
- **V5 — Local-first, single user, fully owned, offline, readable on disk.**
  From `NEXUS.md`, and the mirror exists to enforce it.
- **V6 — Analysis matters.** *"more advanced data analysis."*

**Still undetermined, and each changes the answer:** whether structure should
ever be *enforced* (K3) or only ever advisory; whether navigation matters or
querying suffices (E1 vs E3); and whether one page needs to be two things
(T2 vs T4).

## 4.2 How each stacks up

| | V1 both | V2 build your own | V3 flexible refs | V4 tags collapse | V5 owned/offline | V6 analysis |
|---|---|---|---|---|---|---|
| **Notion** | structure ✓ freedom ✗ | ✓ within a database | ✗ typed to a database | ✗ tags are a select | ✗✗ cloud, not yours | ✓✓ best in class |
| **Obsidian** | freedom ✓ structure ✗ | ✓ nothing stops you | ✓✓ total | ~ tags exist separately | ✓✓ plain files | ~ Dataview over untyped YAML |
| **AnyType** | ✓ closest to both | ✓✓ types and properties are yours | ✓✓ property with optional limit | ✓ tag is a format | ✓ local-first, ✗ not plain files | ~ Sets, no rollups/formulas |

**Notion is for V6 and against nearly everything else you have said.** Its
analysis layer — views, grouping, rollups, formulas — is genuinely the best
built and worth stealing from wholesale. Its structural model is the opposite
of V1: schema is owned by the container, a page belongs to one database and
inherits its schema entire, and there is no vocabulary above the database, so
`Status` in three databases is three unrelated properties. And V5 rules it out
completely — it is a hosted product and your data is a export away from being
someone else's.

**Obsidian is for V5 and V3 and against the structure half of V1.** Plain
files on disk is the gold standard and the thing your mirror is imitating.
Total freedom on properties is exactly V3. But the app can never help: there is
no gesture that turns a pattern you have repeated forty times into a rule, and
no path from practice to structure. On V4 it is ambivalent in an instructive
way — it has both frontmatter properties *and* a separate tag system, and never
resolved the overlap, which is the same unresolved thing you are pointing at
in Nexus. On V6 Dataview is powerful but it is a query language over untyped
YAML, so every query carries its own defensive coercion.

**AnyType is the closest to your vision, and it is close on the specific
points you raised unprompted.** Property-not-relation (§1.3), tag-as-format
(§1.4), types as bundles rather than owners, Sets as saved queries, and a
graph as the primary representation rather than a tree. Its onboarding also
makes **Views** a first-class named concept with four layouts — table,
calendar, kanban, gallery — which is the same conclusion as "grouping is what
makes a layout": those four are one query rendered four ways, not four
features. Where it falls short of
you: V5 — local-first and encrypted, but stored in its own format rather than
plain files, so "fully owned" is true legally and awkward practically. And V6 —
Sets are good, but there are no rollups and no formulas, so it is weaker at
analysis than Notion by a wide margin.

## 4.3 The finding that matters

**Nexus is already most of the way to AnyType's model without having named
it.** `relation` is already a property format. `properties` is already keyed
globally by name. `links` already carries a relation discriminator. Habits are
already "a type offering two properties" rather than a subsystem. The
architecture you are describing is largely the one already here, half-built.

What is missing is a short list:

| Missing | Where it bites |
|---|---|
| Identity separated from Membership | the root cause — §1.1 |
| Cardinality (a reference holds one target) | "books by this author" |
| Soft target constraints | the relation picker shows every page |
| Real multi-value storage | `multi_select` is JSON in a text column |
| Tags still a parallel system | §1.4, and only collapsible after the above |
| Saved queries | Tables holds sort and filter in React state |
| Rollups | no aggregation across a reference |
| Spaces | one vault, so one property namespace for every context |

**And there is one thing Nexus could have that none of the three do.** Notion
has structure with no path from practice. Obsidian has practice with no path to
structure. AnyType has both but keeps your vault in its own format. A system
with AnyType's model, Obsidian's plain-file ownership, and a first-class
*promote this into schema* gesture is not a compromise between the three — it
is a gap none of them occupies.

---

# Part 5 — Constraints, couplings, and what to do before deciding

## 5.1 Constraints that rule things out before taste does

1. **The mirror needs one path per page** (`mirror.ts:130`) — bounds every
   containment option.
2. **Values are already keyed globally** (`schema.ts:130`) — keeping schema
   per-type is choosing to keep a mismatch.
3. **"Untyped" is not representable** — `pages.type_id` is
   `NOT NULL DEFAULT 'note'` (`schema.ts:105`). Every page is at least a Note.
4. **Projections are the house pattern** — `page_fts`, `tasks`, `links` are all
   rebuilt from source (`schema.ts:203`). Derivable facts should be derived.
5. **BlockNote owns the body** — the first build died fighting the editor
   (`NEXUS.md:15`). Structure lives around the document, not inside it.
6. **One user, one machine, no sync** — no merge conflicts, no coordination.
   Denormalising is cheap and a wrong call is recoverable with a rebuild. This
   is what makes the ambitious stances affordable at all.

## 5.2 Couplings

- **Membership prices tags.** M1 forces tags to stay separate; M2/M3 make them
  collapsible. §1.4.
- **Tags need multi-value storage first.** Collapsing before `property_multi`
  exists is a downgrade from an indexed join table to a JSON string.
- **Facets need global Identity.** T4 on I1 would give one page two unrelated
  `status` properties with no way to reconcile them.
- **Cardinality makes collections free.** Ordered multi-references mean a
  collection is a page, not a table — one fewer concept on the containment
  axis.
- **R-collapse subsumes tags-as-pages and index-pages.** If edges carry roles,
  those three stop being separate ideas.
- **Only one step here is irreversible.** Merging the property namespace (I1 →
  I2) rewrites values. Everything else is additive or rebuildable.

## 5.3 Probes — answer these against the real vault, not in the abstract

1. **Property-name collisions.**
   `SELECT key, COUNT(DISTINCT type) c FROM properties GROUP BY key HAVING c > 1`
   — every row is a case the I1→I2 migration must resolve. **If this returns
   zero, the only real cost of Vocabulary evaporates.**
2. **Pages that want a second type.** Under a dozen and Facets is not paying
   for itself yet.
3. **The ten queries you actually want**, in English, before any filter tree is
   designed. Mostly single-type means E1 plus a better Tables covers it.
4. **Folder depth.** A tree that is one level everywhere is a tag system with
   worse ergonomics, and E3 gets much more attractive.
5. **References you would draw, marked single or multi.** Fewer than a third
   multi and cardinality is not the limit it feels like.
6. **Tag/property overlap.** How many existing tags are really values of one
   unnamed property (`status`, `area`, `medium`)? A high number is direct
   evidence for §1.4.

Probes 1, 2 and 6 are SQL against the vault and need no app code at all.
