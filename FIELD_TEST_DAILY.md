# Field test II — Nexus against its own author's day

**Date:** 2026-09-10
**Build:** `main` @ `e500440` (schema v11), fixed on `claude/daily-driver-blockers` (schema v12)
**Method:** a synthetic 30-day vault seeded through the real IPC API and driven
through the real UI under Playwright, in a bubblewrap namespace with `tmpfs`
over `~/.config/nexus` and over the live mirror folder. Scratch
`--user-data-dir`, scratch mirror, nested X server. No real note was read or
written.

---

## Why a second one

The first field test asked what Nexus can do, using three workloads chosen to
stress different halves of the model: a student, a trader, an investigator.
It was right about most of what it found and it missed the thing that decides
whether the app gets used, because none of those three people is the person
who has to open it tomorrow morning.

So this one seeds one workload — the author's — and asks a different question.
Not *does this feature work* but *is this still usable on day thirty*.

## The vault

30 journal entries with a top three and a task section, 12 trades across 3
setups with one still open, 59 habit check-ins across breathwork / grip /
training with realistic gaps, 5 projects matching the sections of the Anytype
space this replaces, an inbox, 5 saved views. 113 pages, 42 links, 520 KB.

Seeding produced zero renderer errors, and every query stayed under 12 ms.
Speed was never the problem.

---

## What a month does to a build that passes every smoke test

### 1 — Overdue meant "written on a day that has passed"

**58 overdue tasks. 53 of them inherited.**

A checkbox with no date of its own takes its page's, which is what makes a
journal entry's todo list work with no syntax at all. `getOverdueTasks` used
that inherited date, so every unticked line was overdue from the day it was
written and stayed that way forever. The oldest was accusing from 12 August.

There was no way to answer one of them except to tick it dishonestly. No
defer, no cancel, no "not today".

A counter that says 58 when five things are actually late is a counter you
stop reading, and it is the first thing on the morning screen.

**Fixed.** A date on the block is a commitment; a date on the page is a
timestamp. Only the first can be missed. 58 → 5, and the other 53 became
*loose ends* — reachable in the tracker, counted quietly on Home, in neither
red nor bold.

### 2 — The fast path made an orphan

`CAPTURE_TARGETS` listed `page` first and the box opened on it. Global key,
type, return — a titled, untyped page per stray thought. Thirty days of
capturing produced thirty pages nothing linked to, which is the exact outcome
a capture box exists to prevent.

**Fixed.** The default is `task`, and it is a stored preference, because the
right answer differs per person.

### 3 — `properties.set` ignored its own type argument

```
set(pageId, 'pnl', 'number', '-750')
  → type = 'number', value_text = '-750', value_number = NULL
```

The column was chosen by `typeof value`. The row displayed correctly
everywhere and matched nothing in `compileFilter`, which compares
`value_number` — so `pnl < 0` over a page of losses returned zero rows,
silently.

The properties panel coerces with `Number()` before it calls, which is why the
UI never showed it. Every other caller had it.

**Fixed**, with a v12 repair for rows already written. The first draft of that
repair used a SQL round-trip guard and repaired nothing, because
`CAST(CAST('-750' AS REAL) AS TEXT)` is `'-750.0'` — the migration test caught
it.

### 4 — No aggregation

The only question a trade log exists to answer had no way to be asked. Five
losing trades on screen and no way to add them up.

**Fixed.** A footer under the table, one cell per column, cycling
none → sum → mean → filled → min → max. It runs as its own unlimited query:
totalling the rows the renderer received would make the sum of the first 500
trades look like the sum.

### 5 — Boards printed uuids

`propertyText` returned `value_relation` verbatim. `mirror.ts` had resolved
the same field to `[[Title]]` the whole time — the export was more legible
than the screen. **Fixed.**

### 6 — Home could not hold your own questions

Every widget answered a question the app chose. `views.is_pinned` had been in
the schema since views shipped and was read by nothing. So the dashboard this
app is meant to replace — a page of hand-typed links and a hand-typed top
three — could not actually be replaced, only re-typed.

**Fixed.** A `view` widget, and pinned views in the sidebar. Neither can go
stale, because there is nothing in either to keep up to date.

### 7 — The escape hatch opened one way

The mirror wrote `pnl: "-1500"` as a string and `multi_select` as escaped JSON
beside a `tags` list in proper YAML. And `importMarkdown` read `# title` and
the body and dropped everything else: a mirrored `Project` came back as an
untyped `Note` with nothing on it.

**Fixed** in both directions. Numbers, booleans, dates and lists are written
as what they are, decided by declared type; frontmatter is read back on
import, relations included.

---

## What was already right

- **The Tracker.** Still the strongest screen in the app.
- **Capture → projection → tick-off.** The whole loop works, and the block
  stays the source of truth throughout.
- **Habits from any type with a date and a boolean.** Three new types became
  three habit strips with no configuration.
- **The widget contract.** Unknown kinds surviving a round trip is the right
  call, and it made adding a `view` widget an entry in a table.
- **Speed.** 113 pages, every query under 12 ms.

## Still open

- **A view cannot ask a question about tasks.** `FilterFieldKind` has no
  `task` kind: views query pages, tasks are blocks. So "my top three, as a
  query" is still not expressible.
- **Relations hold one target.** Invert and use backlinks. Widening later is
  additive, which is why this is not urgent.
- **Views reference vault-local uuids**, so a view cannot be shared between
  vaults. Cheaper to change while there are six of them.
- **Card property sets are not selectable** — board and gallery cards show the
  first three, so a trade card shows symbol / direction / entry and not PnL.
- **Ad-hoc per-page properties** are stored and mirrored but not displayed.
- **Habits are boolean only.** No hours, no weight, no R-multiple.

## Regression cover

`npm run check:daily` is this test, kept. It seeds the same shaped month and
asserts on proportion rather than presence — that overdue returns a number
worth reading, that a total covers the whole match, that a mirrored file comes
back with the properties it left with.
