# Milestone D — The tracker

> Handoff for the session that builds D. Read `NEXUS.md` and `DESIGN.md` first —
> they are authoritative on architecture and scope. This file is the delta:
> what D is, what already exists to build it on, and the traps that cost real
> time in A/B/C/E.

---

## 1. Where the codebase is

Everything before D is on `main`. Milestones A (search), B (journal +
templates), C (data layer) and E (vault mirror) are all merged.

- Schema is at **`SCHEMA_VERSION = 7`** (`src/main/schema.ts`).
- `npm run check` is green: typecheck + `check:migration` + **194** end-to-end
  assertions driving the real Electron app (`scripts/check-app.mjs`).

Verify that before you touch anything. If it is red on a clean checkout, fix
that first — you are not looking at the tree this document describes.

What C and B left you, all of which D is meant to consume:

| Thing | Where | Why D cares |
|---|---|---|
| Typed properties, all 8 types working | `PropertiesPanel.tsx`, `repo.setProperty` | `date` and `boolean` properties are the habit substrate |
| Relations that round-trip | `value_relation`, `RelationField` | linking a task to a project/subject |
| Sortable, filterable Tables | `Tables.tsx` | the generic browser D's views specialise |
| Journal entries with a `date` property | `repo.getOrCreateTodayEntry` | already a date-scoped page per day |
| Per-type templates | `types.template_page_id` | the prompts D's tracking needs are already on the page |

---

## 2. What D is

From the original roadmap, which is the authoritative statement of scope:

> 8. **Tasks.** Keep the checkbox block as the capture surface — writing a todo
>    should never mean leaving the page. On block save, project checkbox blocks
>    into a `tasks` table (`page_id`, `block_id`, `text`, `is_done`,
>    `due_date`, `completed_at`). The block stays the source of truth; the
>    table is a queryable index.
>
> 9. **Date-scoped views.** "This week" and "This quarter" views over that
>    table plus any page with a date property. This is the tracker, and it is
>    mostly a query plus a layout once step 8 exists.
>
> 10. **Habits.** Resist building a bespoke habit engine. A Habit type with a
>     date and a boolean, rendered as a year grid, covers it and reuses
>     Milestone C entirely.

Take point 10 seriously. A Habit type with a `date` and a `boolean` property
is already fully supported by what shipped in C — the year grid is a *view*,
not a subsystem. If you find yourself adding tables for habits, stop.

**The old scope conflict is already resolved.** The roadmap warned that
`PROJECT.md` forbade due dates and calendar views, and said to amend it before
D. `PROJECT.md` no longer exists; `NEXUS.md` superseded it, and its
out-of-scope list does not mention tasks, dates or date-scoped views. Nothing
blocks D. Do not go looking for `PROJECT.md`.

---

## 3. The roadmap predates this architecture — translate it

That roadmap was written against the *first* build. Several nouns in it no
longer exist. Read it for intent, not for identifiers.

| Roadmap says | Actually is now |
|---|---|
| `database.ts` | `src/main/repo.ts` |
| `blocks` table, "on block save" | `pages.content`, one JSON blob of the whole BlockNote document |
| `property_values` | `properties`, keyed by `(page_id, key)` |
| `ipc-handlers.ts` | `src/main/ipc.ts` — still a dispatch table, keep it that way |

The consequence for point 8: **there is no `blocks` table to hook.** A task
projection has to walk the document JSON. That is a solved problem here —
`extractLinkTargets` in `src/renderer/editor/link-menu.tsx` already walks the
block tree recursively and is the pattern to copy. BlockNote block ids are
stable across saves and live in the JSON, so `block_id` works as the roadmap
intends.

`checkListItem` ships in BlockNote's `defaultBlockSpecs`, which `nexusSchema`
spreads — so the capture surface already exists as a block type. There is **no
slash-menu entry for it** (`slash-items.ts` only adds Toggle and Callout);
confirm how a user actually inserts one before designing around it.

---

## 4. The one architectural decision to get right

**Project tasks in the main process, inside `updatePage` — not from the
renderer.**

There are two projections in this codebase today and they are wired
differently:

- `page_fts` — `reindexPage(id)` is called *inside* `repo.updatePage` when
  `content` changes (`repo.ts`). Any path that changes a page reindexes it.
- `links` — `syncLinks` is called from the **renderer**, in `Editor.tsx`,
  after the save round-trips.

The second is the wrong one, and it already has a visible consequence:
`io.importMarkdown` creates a page and calls `updatePage` without ever calling
`syncLinks`, so **imported pages contribute no backlinks.** Nothing else in
the app can fix that, because the projection lives in a component that
imported pages never mount.

Follow `reindexPage`. A task projection driven from the editor would silently
miss pages created by import, by a template, by the journal button, and by
whatever integration surface comes later. Same rule the roadmap already
states: *never let a projection become the only home for user data* — and its
corollary, never let the only writer of a projection be one UI component.

While you are there, moving link extraction to the same place is a small,
well-scoped fix. It is not required for D, but it removes the bad example.

---

## 5. Decisions D has to make

Flagging these rather than pre-deciding them — each changes the shape of the
work.

**Where does `due_date` come from?** The capture surface is a checkbox block,
which has text and a checked flag and nowhere to put a date. The options are
inline syntax in the block text (`@2026-08-20`, parsed by the projector), the
owning page's `date` property (every journal entry already has one), or a real
per-block property (which BlockNote supports via a custom block spec, at the
cost of a custom block). The first two are cheap; the third is the one that
turns into a debugging loop, and this project has a history with those.

**Do relations feed backlinks?** Deliberately unresolved in C. `syncLinks`
deletes any link for a page not in that page's document mention set, so a
relation-created row in `links` would be erased on the next content save.
Giving relations backlinks needs a `source` discriminator on `links`. If D
wants "tasks linked to a project, visible from the project", this is the
decision.

**`io.ts` JSON export drops properties entirely.** `exportPageJSON` writes
only title, icon and content — so exporting a typed page and reimporting it
loses all its typed data, for every property type. This predates B and C. It
also is not a one-liner: importing a relation into a *different* vault is
meaningless, since the target uuid will not exist there. It needs a call —
resolve by page title, drop relations on import, or export a portable
reference — and it is the same question the mirror already answers with
`[[Title]]`. **Settle this before D leans on export.**

---

## 6. Conventions that cost time when ignored

Every one of these was a real bug in A–C, not a style preference.

**Check `main` before claiming a schema version.** B and C both shipped as
version 6 from separate branches. A version number meaning two different
things to two databases is not recoverable afterwards; it was only survivable
because the later step was additive and idempotent. Bump `SCHEMA_VERSION`,
add your entry to the log comment above it, and add a case to
`check-migration.mjs`.

**`setProperty` owns which column a value lands in.** Read values back through
`propertyValue()` in `repo.ts`, never by reaching for `value_text` yourself.
Two separate copiers hand-rolled that read and both forgot `value_relation`,
so relations silently vanished when a page was duplicated or created from a
template.

**A comment describing behaviour the code does not have is a bug.**
`getKnownPropertyValues` documented a plain-value branch that a dangling
`else` made unreachable. `setTypeTemplate` documented a rule it did not
enforce. Both read as correct for months.

**Test the reopen.** The relation bug — saving to one column, reading from
another — looked like it worked until you left the page and came back. Any
feature that writes and reads back needs an assertion that navigates away and
returns. Assert against the database, not the DOM, wherever "did it actually
save?" is the question.

**Empty states are part of done.** `NEXUS.md`'s "polish before progress" is
enforced in review. Blanks sort last, filters say when they match nothing,
destructive actions go through `confirmDialog` rather than `window.confirm`
(the native one is invisible to the smoke test, which is how several
destructive paths went untested for months).

---

## 7. Definition of done

- `npm run check` green, with new assertions in `scripts/check-app.mjs`
  covering each thing you built — this codebase tests its features.
- Any schema change additive, versioned, and covered in
  `check-migration.mjs`.
- `NEXUS.md` updated. It is what the *next* session reads.
- Work feature by feature, pushing each for review, rather than landing the
  whole milestone at once.
