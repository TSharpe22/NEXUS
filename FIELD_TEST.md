# Field test — Nexus against three real workloads

**Date:** 2026-09-10
**Build:** `main` @ `457f327` (schema v11, after the widget refactor)
**Method:** a throwaway 30-page vault seeded through the real IPC API and driven
through the real UI under Playwright. Scratch `--user-data-dir`, scratch mirror
folder, both under `/tmp`. The author's own vault was never opened for writing.

---

## Why this exists

Nexus has more features than its vault has data. The live vault is 18 pages, no
tags, one link — so nothing in it exercises views, relations, boards, the graph
or the tracker. Every judgement about what Nexus is good at was therefore a
guess about a screen nobody had filled.

This is that screen, filled. Three workloads were chosen because they stress
different halves of the model:

| Workload | What it stresses |
| --- | --- |
| Engineering student, cross-disciplinary | links, backlinks, the graph, habits |
| Programmer / discretionary trader | typed numeric properties, filters, sorting, aggregation |
| Investigator (case files, OSINT) | relations, entity modelling, tags, evidence records |

## The test vault

30 pages, 9 user-made types, 5 saved views, 16 links, 10 tags, one habit,
mirror enabled.

- **Study** — `Course` (Code, Term, Credits), `Concept` (Field, Confidence,
  Last reviewed, Seen in → relation), `Review` (Day, Done). Three courses, five
  concepts deliberately cross-linked between them, five habit check-ins.
- **Trading** — `Strategy` (Status, Market, Win rate, Expectancy), `Trade`
  (Symbol, Direction, Entry, Exit, Size, PnL, Opened, Closed, Strategy →
  relation). Three strategies, eight trades including one still open.
- **Investigation** — `Case` (Status, Opened, Priority), `Entity` (Kind,
  Aliases, First seen, Linked case → relation), `Source` (URL, Retrieved,
  Reliability). One case, three entities, two sourced documents.

Seeding produced zero renderer errors and zero missing property definitions.

---

## Findings by workload

### 1. Engineering student

**Verdict: strong fit.**

A "Weak concepts" view filtering `Confidence ≤ 2` returned exactly the three
concepts needing work. The `Review` type — a date property and a checkbox —
became a habit with no configuration at all, and its streak rendered on Home.

The cross-disciplinary payoff showed up in two places:

- The **graph** separated into visible clusters by domain without being told to.
- **Backlinks** made an inter-course dependency legible: writing `[[Eigenvector]]`
  inside the Fourier Transform note means the Eigenvector page now reports that
  it is load-bearing in a course it is not taught in. A folder tree cannot say
  that.

**Gap.** `Confidence` is a number typed by hand. Nothing schedules a review,
decays a score, or surfaces what is due. Spaced repetition is possible but it is
operated manually through a view.

### 2. Programmer / trader

**Verdict: capture is excellent, analysis is absent.**

Every trade logged cleanly. Two views worked exactly as a database should:

- *Open trades* — `Closed is empty` → correctly returned the single open position.
- *Losing trades* — `PnL < 0`, sorted ascending → a real worst-first table with
  sortable column headers.

Then the only question that matters — *what is my expectancy on Mean Reversion*
— turned out to be unaskable. **Views have no aggregation.** No sum, no mean, no
count, no footer row. Four losing trades were on screen with no way to total
them.

This is structural rather than cosmetic: `views.run` returns rows and every
layout in `ViewLayouts.tsx` draws rows. It is the single largest gap found.

**Second gap.** Board and gallery cards render the first three properties. The
trade cards showed Symbol / Direction / Entry — not PnL, which is the number the
card exists to communicate. The property set is not selectable.

### 3. Investigator

**Verdict: works, but only if you invert your first instinct.**

The natural model is Case → many Entities. That fails: **a relation holds
exactly one target.** Setting it a second time silently overwrites the first
(verified — see Evidence 1).

Pointing each `Entity` at its `Case` instead works well, because the Case's
backlinks panel then gives the reverse index for free, and names the property
that produced each edge:

```
Falcone (relation:linked_case)
Gotham Docks Ltd (relation:linked_case)
Maroni (relation:linked_case)
```

That is a serviceable case file. `Source` pages carrying a `URL` property and a
`Reliability` select work as evidence records, and a tag-filtered gallery pulls
case, sources and persons into one place.

**Gaps.** An entity appearing in two cases has no clean home. There is no
per-entity timeline, though the Tracker partially covers this.

---

## The under-used feature

**The Tracker is the strongest thing in the app and the navigation undersells
it.** It places *every dated page* on a calendar and labels each one with the
property that put it there:

```
Tue 8 Sep   Convolution          Concept · last_reviewed
            ES 2026-09-08        Trade · opened
            ES 2026-09-08        Trade · closed
            Eigenvector          Concept · last_reviewed
            NVDA 2026-09-04      Trade · closed
            Review — 2026-09-08  Review · day
```

A trade appears twice, on open and on close. Study, trading and casework land on
one timeline with zero configuration, purely because all three carry date
properties. This is the cross-domain view the graph promises and does not quite
deliver.

Note one inconsistency: the header reads `0 open · 0 done` while twenty dated
items are listed, because that counter counts checkbox tasks only.

---

## Limitations, ranked by cost

| # | Limitation | Severity | Notes |
| --- | --- | --- | --- |
| 1 | No aggregation in views | **High** | Blocks all quantitative work. Structural. |
| 2 | Relations are single-valued | **High** | Shapes the whole data model. Workaround: invert, use backlinks. |
| 3 | Board grouped by relation shows UUIDs | Medium | ~5-line fix; correct code already exists in `mirror.ts`. |
| 4 | Views reference vault-local UUIDs | Medium | Blocks portable/shareable views. Matters for open-source. |
| 5 | Ad-hoc properties stored but not displayed | Medium | Storage and mirror already correct; only the panel isn't. |
| 6 | Card property set not selectable | Low | Board/gallery show the first three. |
| 7 | Mirror frontmatter is untyped | Low | Numbers quoted; `multi_select` written as escaped JSON. |
| 8 | Habits are boolean only | Low | No hours, weight, R-multiple. |

### 3 — relation labels

`ViewLayouts.propertyText` returns `prop.value_relation` verbatim, so a board
grouped by a relation prints raw UUIDs as its column headers:

```
B6A16567-959A-4304-9454-6C4B8A293B12     ← should read "Mean Reversion — ES"
EB245BDE-7B71-4CCD-B5EA-A18C07DC2A80     ← should read "Momentum Breakout"
```

The resolution already exists elsewhere: `mirror.ts` renders the same value as
`[[Mean Reversion — ES]]`.

### 4 — views are not portable

`repo.compileFilter` matches tags on `pt.tag_id = ?`. A filter written with tag
*names* returned 0 rows; the identical filter written with tag *ids* returned 5.
The same is true of type, folder and backlink conditions.

Inside one vault this is correct — it survives renames. But it means **a saved
view or dashboard cannot be shared between vaults**, because it is a bag of
UUIDs that mean nothing anywhere else. This lands directly on the plan for
community add-ons: if an add-on is to be a file rather than code, filter
conditions need name-based references or an import-time resolver.

Cheaper to change now, with six views in existence, than later.

### 5 — ad-hoc properties

`properties.set(pageId, 'adhoc_note', 'text', 'one-off')` on a page whose type
has no such definition:

- saved without error
- persisted across a reload
- **appeared in the vault file** as `adhoc_note: "one-off"`
- and is invisible in the properties panel, which renders type definitions only

So the app cannot display a property that its own exported markdown shows. The
storage layer and the mirror are already right; this is a UI gap alone, which
matches the earlier read of the schema (`properties` is keyed by
`(page_id, key)`, never by definition id).

---

## What the mirror gets right

The exported markdown is genuinely good for an assistant to read. Frontmatter
carries identity, type, timestamps, tags and every property, and relations are
resolved to titles rather than ids:

```yaml
---
id: "c3ebc476-7776-4967-a536-ba6c66d43af1"
title: "ES 2026-09-03"
type: "Trade"
tags: ["trade"]
symbol: "ES"
direction: "Short"
entry: "5640"
pnl: "-1500"
strategy: "[[Mean Reversion — ES]]"
path: "ES 2026-09-03.md"
---
```

Two defects worth fixing, both small, both in `renderPage`:

- **Everything is quoted.** `pnl: "-1500"` is a YAML string. Any consumer — an
  assistant, a Dataview query, a script — must coerce before comparing. Numbers,
  booleans and dates should be emitted unquoted.
- **`multi_select` is written as escaped JSON**, e.g.
  `aliases: "[\"The Roman\",\"C.F.\"]"`, while `tags` on the same page is
  written as a proper YAML list. The two should agree.

Fix both and the vault becomes directly queryable rather than merely readable.

---

## Recommended order

1. **Aggregation in views** — a footer row offering sum / mean / count / min /
   max per numeric column. Contained work, and it is what turns the trading half
   from a diary into an instrument. Highest value found.
2. **Resolve relation labels in `ViewLayouts`** — small, and the correct
   implementation is already in the repository.
3. **Ad-hoc per-page properties in the panel** — already queued; this test
   confirms the storage needs no change.
4. **Name-based filter references** — before more views exist, and before any
   add-on can depend on the current shape.
5. **Type the mirror frontmatter** — cheap, and it directly raises the ceiling
   on anything reading the vault, local model or otherwise.

## Evidence

**1 — relation cardinality**

```json
{ "before": "2d078220-a187-4c32-88a0-6bf8b1df708d",
  "after":  "SECOND-TARGET-ID" }
```

**2 — tag filter by name vs id**

```
filter by tag name → 0 rows
filter by tag id   → 5 rows
```

**3 — ad-hoc property persisted**

```json
["symbol","direction","entry","size","opened","strategy",
 "exit","pnl","closed","adhoc_note"]
```

**4 — full-text search reaches body text**

```
search "contango" → ["SPX vol", "Vol Carry"]
```

**5 — totals**

```
30 pages · 16 links · 0 open tasks · 332 KB
mirror: 31 files written, 0 deleted
renderer errors: none
```
