# MODEL — the vocabulary, the shape, and the scope

> The reference for what every word means and what was decided. Supersedes the
> question list; `ARCHITECTURE_OPTIONS.md` holds the reasoning behind the
> choices and `STRUCTURE.md` the first sketch.
>
> **Naming rule: no invented words.** Every term here is the ordinary word for
> the thing. If a term needs a glossary entry to be understood by someone who
> has used Notion, Obsidian or AnyType, it is the wrong term.

---

## The seven words

Six define the data. The seventh says where it lives.

### 1. Object

**One thing you are keeping track of.** A note, a book, a task, a person, a
workout, a day. Everything in Nexus is an object.

An object always has an id, a title, a type, and a body. The body may be
empty — that is what makes small things possible — but every object can have
one.

### 2. Type

**What kind of thing an object is.** It decides which properties the object
starts with, how it is shown, and where new ones are filed.

An object has exactly one type. A type is not a container and does not own the
object; changing an object's type changes what it offers, never what it is.

### 3. Property

**A named field an object can carry.** `status`, `due`, `author`, `rating`.

A property exists in its own right, once, for the whole vault. Types point at
properties; they do not own them. That is what lets `status` mean the same
thing on a Book and on a Project, and be renamed once.

### 4. Value

**What one object holds for one property.**

The property is the column; the value is the cell. An object may hold a value
for a property its type never mentioned — the type is advice about what to
expect, not a fence.

### 5. Format

**The kind of value a property holds.** Text, number, date, checkbox, select,
reference, url — and later duration, currency, rating, file.

Called "property type" by Notion. Here it is *format*, because "type" already
means something and one word meaning two things is what a vocabulary exists to
prevent.

### 6. View

**A saved way of looking at a set of objects.** Which objects (filter), in what
order (sort), split by what (group), drawn how (layout: table, board, calendar,
gallery, chart).

A view stores no objects. It is a question, saved.

### 7. Folder

**Where an object lives.** One folder per object, folders nest, and the tree is
written to disk exactly as it reads on screen.

Folder is the seventh word rather than a detail because it is the only one not
derivable from the other six, and because it is what makes the vault portable —
a Nexus folder tree is a working directory tree in Obsidian or anywhere else.

### On the word "space"

Dropped, and you were right to push. It was a partition above everything else,
and since spaces are deferred it was a word doing no work. If separate work and
personal vaults are wanted later, "space" is the word — but it is not part of
the model today.

---

## An object, worked through

One object, in full:

```
Object
  id          01J8F3K2...
  title       Deep Work
  type        Book
  folder      Library / Reading
  body        (your notes on it — an ordinary document)

  properties
    author    → Cal Newport        format: reference (one)
    status    → Reading            format: select
    rating    → 4                  format: number
    started   → 2026-07-14         format: date
    themes    → focus, attention   format: select (many)
```

`author` does not hold the text "Cal Newport" — it points at the **Person**
object named Cal Newport. Open that object and Deep Work appears under its
backlinks without anything being written twice.

### Types of object

Every one of these is the same seven fields above. The type only decides which
properties come as standard.

| Type | What it is | Properties it brings | Shown as |
|---|---|---|---|
| **Note** | the default — anything | none | page |
| **Book** | something you read | author→Person, status, rating, started, finished, themes | page |
| **Person** | someone | role, email, birthday | page |
| **Project** | work with an end | status, due, owner→Person | page |
| **Task** | one action | done, due, project→Project | **inline** |
| **Habit** | something you repeat | cadence, target | page |
| **Check-in** | one day of a habit | habit→Habit, date, done | **inline** |
| **Journal entry** | one day | date | page |

Note what is *not* in that table: there is no Tag type, no Task table, no Habit
subsystem. A tag is a select property with many values. A task is an object. A
habit is an object, and its check-ins are objects pointing at it.

---

## Inline objects

**An inline object is a real object shown inside another object's body instead
of on its own page.**

Three rules, and that is the whole of it:

1. **It is stored like every other object.** Same table, same id, same
   properties, same queries, same backlinks. Nothing about it is special in the
   database.
2. **Its type says to show it inline.** That is the only difference from a
   Book. One flag on the type.
3. **A body holds a reference to it, not a copy.** Editing it in the body edits
   the object. Removing it from the body removes the *display*; the object
   survives and is still found by its type's view.

Because every object can have a body, inline is a display choice and never a
restriction. A task that turns out to need a page **just gains a body** — no
conversion, no retyping, no new object.

**What this replaces.** Today a task is a checkbox *block* inside a document,
with the `tasks` table as a projection of it. That is why a task cannot carry
properties, cannot be referenced, and cannot be rolled up. Under this model the
checkbox you see in a note *is* the object, rendered where you put it.

**One rule deliberately deferred:** typing a checkbox in a note does not create
a Task object. It stays an ordinary checkbox block. Turning that on is a
setting for later, not a default — otherwise every scratch list silently
becomes data.

---

## Decisions

Settled, with the reasoning where it is not obvious.

### Shape

- Every object can have a body. Small is a display choice.
- One type per object. No multi-type, no facets, no inheritance.
- Properties are global; types reference them. Renaming a property renames it
  everywhere.
- An object may carry a property its type never declared, and promoting that
  into the type is one click.
- **A type may enforce.** Enforcement is opt-in per property (`required`,
  `constrained`) and off by default — so a type stays advice unless you
  deliberately make one strict. Worth knowing the tradeoff: every enforced
  property is a place the app can refuse a note you are trying to write.
- Tags are gone as a system. A tag is a select property with many values,
  available to any object. This can only happen *after* multi-value storage is
  real — today `page_tags` is an indexed join table and `multi_select` is JSON
  in a text column, so collapsing early would be a downgrade.
- Folders survive and matter. A type may set the folder its new objects land
  in.
- Spaces deferred.
- No generated objects.

### Words

Object · Type · Property · Value · Format · View · Folder. **Reference** for a
property that points at an object — "relation" is not used at all.

### Analysis

- Formulas: both an expression language and a builder over it. The builder
  writes expressions; there is one engine, not two.
- A formula may reach through a reference to another object's properties.
- **Computed on read**, not stored. Correct by construction, nothing to
  invalidate, and SQLite on one machine is fast. A cache table is a fix for a
  measured slow query, not a starting design.
- Views may aggregate across types — every object carrying a `duration`,
  whatever it is.
- Charts are a layout. The same view drawn as a chart, embedded in a body, or
  placed on a dashboard is one thing in three places, not three features.
- **History**: the value a property held over time is kept, not just its
  current value. This is the one item on this page that none of Notion,
  Obsidian or AnyType does well.

### Plain text

- The mirror should eventually flow **both ways**.
- The mirror should aim to be a working Obsidian vault.
- Imports are the extension story for now. No plugin API yet; an outside
  read-only query path is wanted eventually.

---

## Three answers I owed you

### Q5 — how to model a habit

Two ways, and the difference decides whether habits are data or a feature.

**One object per habit, holding a list of dates.** Ten habits is ten objects.
Compact, and the year grid reads one row. But the dates are a list inside one
object: you cannot attach anything to a single day, cannot ask "days I did both
X and Y", cannot roll anything up. This is roughly today's design, and it is
why habits are a special case in the code rather than ordinary data.

**One object per day.** A check-in carries a date, a checkbox, and anything
else you want — reps, duration, how it felt, a note. Streaks become a query.
"Did I read on days I also ran" becomes a filter. The cost is volume: one habit
is 365 objects a year.

**Recommended: both, split.** A **Habit** is a real object — name, cadence,
target, notes, its own page. A **Check-in** is an inline object pointing at it.
Exactly the Project/Task relationship, which means one mechanism covers both
and there is no habit subsystem to maintain. Given that analysis is the goal,
the list-of-dates model forecloses most of what you said you want.

On volume: check-ins are inline objects, excluded by default from the graph and
from search, and mirrored as rows (below). 3,650 rows a year is nothing to
SQLite — it is a UI question, not a storage one.

### Q6 — how inline objects land on disk

**An inline object is written where it is shown.** A task inside a note is
`- [ ] Buy milk` in that note's file, with its properties as inline fields — the
natural Markdown, and exactly what Obsidian expects. A check-in appears as a
row in a table in its habit's file.

An inline object with no body displaying it goes into one table file per type
(`Tasks.md`, `Check-ins.md`) as a Markdown table.

This is better than one-file-each for two reasons: 3,650 files a year is not a
vault anyone wants to open, and a checkbox in the file where you wrote it is
what makes the mirror readable by a person rather than only by a machine.

### Q18 — the analytical questions, proposed

You said you were not sure. Here are five drawn from what you are actually
doing; correct them and they become the spec.

1. *"How many tasks did I finish this week, by project?"* — count, grouped
2. *"What is my completion rate for each habit over 90 days?"* — aggregate over
   check-ins
3. *"Which projects have had no activity in 30 days?"* — date arithmetic
4. *"What am I reading, and how long has each been open?"* — a formula
   (`today − started`)
5. *"Where does my time go?"* — aggregate a `duration` property **across types**

Those five need, in order: **aggregates, rollups, date formulas, cross-type
views.** Which is the build order for the analysis work, derived rather than
guessed.

---

## Scope

You are using this daily. That is now the hardest constraint on this page, and
it changes two things.

**Do not rebuild.** You said you would accept an export-and-reimport (Q34).
Given daily use and a vault you intend to grow, don't — every step should be an
additive migration that ships without downtime. The MVP's migration discipline
already supports this; a rebuild throws it away for no gain.

**Taken literally, these answers describe a system larger than Notion.**
Formulas with reference traversal, cross-type aggregation, property history,
charts in three places, two-way plain-text sync and Obsidian compatibility —
any one of those is a milestone. That is fine as a destination. It is not an
order of work, so here is one.

### The cluster that needs its own decision

**Q25 (flow back), Q26 (source of truth) and Q27 (Obsidian vault) are one
question, not three**, and the answer to the middle one dissolves or creates
the other two.

- **Database is the truth, files are an export** *(today)*. Two-way means
  watching files, parsing edits back, and resolving conflicts against a
  database that may have changed too. `mirror.ts:4` calls two-way "a genuinely
  hard problem" and it is right.
- **Files are the truth, the database is an index.** Then there is nothing to
  sync. SQLite becomes a derived projection that can be deleted and rebuilt —
  exactly what `page_fts`, `tasks` and `links` already are, applied one level
  up. Editing a file in Obsidian is not a sync event, it is just an edit, and
  Q27 stops being ambitious because you *are* an Obsidian vault.

The second is the better architecture and it has one gating problem: a
BlockNote document must round-trip losslessly through Markdown, and today it
does not — `importMarkdown` is a line-to-paragraph mapper and a Nexus export
re-imported does not survive (`QA_SCAN.md:180`). A real Markdown ↔ BlockNote
converter is the single hardest piece of work implied by any answer you gave.

**Neither answer blocks anything else on this page.** Everything below is
compatible with both, so this decision can wait until the model work is done —
but it should be made deliberately, not arrived at.

### Proposed order

Each phase ships on its own and leaves the app usable.

| | Phase | Why here |
|---|---|---|
| 1 | **Property vocabulary** — global properties, types as bundles, ad-hoc properties, promote-to-type | Everything else assumes it |
| 2 | **Values that hold more than one thing** — multi-value storage, reference cardinality, select options with colour; then tags collapse | Blocks tags, boards, and rollups |
| 3 | **Inline objects** — tasks and check-ins as real objects; Habit/Check-in split | Needs 2 for references |
| 4 | **Views** — filter tree, layouts, grouping; Tables rebuilt as a view | Needs 1–3 to have anything to filter |
| 5 | **Analysis** — aggregates, then rollups, then formulas, then charts as a layout | The Q18 order |
| 6 | **History** — an append-only log of value changes | Wants a settled property model first |
| 7 | **Plain text** — the decision above, then the converter | Independent; hardest; last |

Phases 1 and 2 are the ones that unlock the most per unit of work, and neither
changes anything you can see immediately — which is the usual sign that they
are the right place to start.
