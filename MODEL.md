# MODEL — vocabulary and open questions

> The working definition of every word Nexus uses for structure, and the
> questions still open. Draft: sections marked **[OPEN]** are waiting on
> decisions, and `ARCHITECTURE_OPTIONS.md` holds the reasoning behind them.
>
> **Naming rule for this whole document: no invented words.** Every term below
> is the ordinary industry word for the thing. If a term needs a glossary entry
> to be understood by someone who has used Notion, Obsidian or AnyType, it is
> the wrong term. A property is a property.

---

## The seven words

**Object** — one thing you are keeping track of. A note, a book, a task, a
person, a workout. Everything in Nexus is an object.

**Type** — what kind of thing an object is. It decides which properties the
object starts with and how it is shown.

**Property** — a named field an object can carry. `status`, `due`, `author`,
`rating`.

**Value** — what one object holds for one property.

**Format** — the kind of value a property holds: text, number, date, checkbox,
select, reference, and so on. *(Called "property type" by Notion; "format" is
used here because "type" is already taken by the word above, and one word
meaning two things is exactly what this document exists to prevent.)*

**View** — a saved way of looking at a set of objects: which objects, in what
order, grouped how, drawn as what.

**Space** — a top-level partition. Everything above lives inside one.

That is the entire model. Everything below is either a format, a kind of view,
or a convenience over these seven.

---

## The rest of the vocabulary

### Around objects

| Term | Means |
|---|---|
| **Body** | The document inside an object. Optional — see "Small objects" below. |
| **Block** | One unit of a body: paragraph, heading, checkbox, image, table. |
| **Title** | An object's name. Every object has one. |
| **Template** | Starting content and property values for new objects of a type. |
| **Trash** | Soft-deleted objects, recoverable until emptied. |

### Around properties

| Term | Means |
|---|---|
| **Reference** | A property whose format points at another object. |
| **Cardinality** | Whether a property holds one value or many. |
| **Option** | One allowed value of a select property, with a colour. |
| **Tag** | A property with format select, cardinality many, available to any object. **Not a separate system** — see `ARCHITECTURE_OPTIONS.md` §1.4. |
| **Default** | A value applied to new objects of a type. |
| **Constraint** | What a property will accept. Advisory unless stated otherwise. |

### Around connections

| Term | Means |
|---|---|
| **Link** | A mention of one object inside another's body. |
| **Backlink** | The reverse of a link or reference, seen from the target. |
| **Graph** | Every object and every connection between them. |

### Around analysis

| Term | Means |
|---|---|
| **Filter** | A condition selecting which objects a view shows. |
| **Sort** | The order a view puts them in. |
| **Group** | The property a view splits objects by. Grouping is what turns one view into a board or a calendar. |
| **Layout** | How a view draws: table, list, board, calendar, gallery, chart. |
| **Formula** | A property computed from other properties on the same object. |
| **Rollup** | A property computed by aggregating across a reference. |
| **Aggregate** | A summary of one column: count, sum, average, min, max. |
| **Dashboard** | A view whose contents are other views. |

### Around storage

| Term | Means |
|---|---|
| **Vault** | The database file and everything in it. |
| **Mirror** | The plain-text copy of the vault written to disk. |
| **Folder** | Where an object sits in the mirror's directory tree. |
| **Import / Export** | Moving data in and out in a standard format. |
| **Source** | External data pulled in and modelled as objects. **[OPEN]** |

### Words deliberately not used

| Not used | Because |
|---|---|
| *Relation* | It means "a property that points at an object" — so it is a **format**, not a concept. AnyType renamed it to Property for this reason. |
| *Set* / *Collection* | AnyType's names for a dynamic and a manual list. Both are **views**; one filters, one lists chosen objects. Two words for one idea. |
| *Database* | Notion's name for a type plus its views. Splits into **type** and **view**, which are separately useful. |
| *Note* / *Page* | An object that has a body. Not a different thing. |
| *Channel* | AnyType's newer word for a space. "Space" is the more common word. |

---

## Small objects **[OPEN]**

> *"Habits to check off, tasks, don't need full pages, they need to exist in
> small."*

The current build makes a task a **checkbox block inside a page's body**, with
`tasks` as a projection of it (`schema.ts:203`). That was deliberate and it is
documented — but it means a task cannot carry properties, cannot be referenced,
and cannot be found by the same machinery as everything else.

**The proposal: "small" is not a different kind of thing. It is an object
whose body is empty and whose type says to render it inline rather than as a
page.**

Nothing structural changes. `pages.content` already defaults to `'[]'`, so an
empty body is already representable. What changes is presentation: a type
carries a flag saying its objects open as a row, not a document. A task is an
object with `done`, `due` and `project`. A habit check-in is an object with a
date and a checkbox. Both are queryable, referenceable and rollup-able exactly
like a book.

**The cost is real and has to be decided rather than discovered.** A year of
daily check-ins is 365 objects. That is 365 rows in the graph, 365 entries in
search, 365 files in the mirror. Three ways to handle it, and Q1–Q6 below ask
which:

- **Small objects are ordinary objects.** Simplest model, noisiest vault.
- **Small objects carry a visibility flag** — present in queries and rollups,
  excluded by default from graph, search and per-file mirroring; written to
  the mirror as rows in one table file per type instead.
- **Small things are not objects at all** but rows in a side table. Cheapest,
  and it forfeits properties, references and uniform querying — which is most
  of the point.

---

## Leaving room **[OPEN]**

Three commitments that cost little now and are expensive to retrofit. Each is
a direct consequence of *"we cannot limit ourselves."*

**1. Formats are a registry, not an enum.** `PropertyType` is currently a
closed union (`shared/types.ts:62`). Adding a format — currency, duration,
rating, file, colour, location, or one supplied later by an extension — should
mean registering a descriptor (how to store, render, edit, sort, filter,
aggregate), not editing a union and hunting every `switch` that matched it.

**2. Layouts are a registry, not a list.** A chart is a layout over a view, not
a separate feature. If table, board and calendar are registered the same way, a
chart, a timeline and a map are the same shape of addition.

**3. Everything a view does is expressible as data.** Filters, sorts, groups
and layout config serialise to JSON and compile to SQL in exactly one place.
Anything that can only be expressed in React cannot be saved, embedded in a
body, or generated by an extension.

---

## Open questions

Numbered for answering. Grouped by what they decide.

### A. Small objects

1. Should every object be *able* to have a body, or should some types be
   permanently bodyless?
2. When a task needs to become a real note, is that a conversion, a type
   change, or does it simply gain a body?
3. Today a checkbox block in a note creates a task. If tasks become objects,
   does that stay true — and is the checkbox *the object rendered inline*, or a
   reference to an object stored elsewhere?
4. Should small objects appear in the graph, in search, and in the trash?
5. A habit: is it one object per day (365 check-ins a year), or one object per
   habit carrying a set of dates?
6. How should small objects appear in the mirror — one file each, or rows in
   one table file per type?

### B. Terminology

7. **Object** for the atomic unit — or keep **page**? Nexus says "page"
   everywhere today; AnyType says "object"; Obsidian says "note".
8. **Format** for the kind of value a property holds — or "field type", or
   Notion's "property type" despite the collision with **Type**?
9. **Reference** for a property pointing at an object — or keep **relation**,
   which is more familiar even if less accurate?
10. **View** for a saved filtered list — or "query", or Notion's "database
    view", or AnyType's "set"?
11. **Space** for the top-level partition — and does **vault** keep meaning the
    database file?

### C. Structure

12. Should a type ever *enforce* anything (reject a write), or is it always
    advisory?
13. Can one object have more than one type?
14. Do you want spaces (work / personal separated) — and soon, or later?
15. Do folders survive once views exist, or do they become mirror-only?
16. Tags: collapse into a property now, later, or never?
17. Should a type be able to say "objects of this type live in this folder by
    default"?

### D. Analysis — the goal

18. Name the five analytical questions you actually want answered. Concrete
    ones, e.g. "hours per project per week", "longest streak per habit".
19. Formulas: a spreadsheet-like expression language, or a visual builder?
20. Can a formula reach through a reference to another object's properties, or
    only see its own object?
21. Are formulas stored (recomputed on write) or computed on read?
22. Do you want **history** — the value a property held over time, not just its
    current value? Nothing in the three systems does this well, and habits,
    tasks and any log imply it.
23. Where do charts live: as a layout on a view, as a block in a body, or on a
    dashboard that holds several?
24. Should a view be able to aggregate across *types* (all objects with a
    `duration`, whatever they are), or only within one?

### E. Plain text and longevity

25. Does the mirror stay one-way, or should editing a file eventually flow
    back in?
26. Is SQLite still the source of truth with files as an export — or should
    files become the source of truth?
27. Should the mirror aim to be a working Obsidian vault specifically
    (frontmatter plus wiki-links), or just human-readable Markdown?
28. Formulas and rollups are computed. Does the mirror write their computed
    values, their definitions, or both?

### F. Extension

29. What does "plug in data" mean concretely — importing files, connecting live
    sources, or just custom property formats?
30. A real extension API eventually, or "extensible" meaning the built-in model
    is general enough that you never need one?
31. Should there be **generated objects** — a weekly summary object produced by
    a query rather than typed by hand?
32. Do you want the vault queryable from outside — a read-only API or a CLI, so
    other tools can ask it questions?

### G. Sequencing

33. How large is the vault now, and what is the appetite for a migration that
    rewrites values in place?
34. Would you accept a clean rebuild — export everything, change the model,
    reimport — instead of migrating in place?
