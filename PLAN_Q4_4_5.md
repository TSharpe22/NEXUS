# Plan — Q4 items 4 and 5

> Draft for approval, 2026-10-06. Nothing here is built yet. ROADMAP.md
> describes the goal ("Next — queued"). This file says how to get there.

## What the vault actually holds (read-only check, schema v14)

- 30 pages. Five types: Note, Journal, Training, Meditation, Trading, Early Wake Up.
- Two folders: `Journal` (15 entries) and `Templates` (2).
- **Loose at root:** 4 Training logs (one titled `26-09-08`), 2 Trading logs,
  1 Meditation, 1 Early Wake Up. They sit beside the hubs (Inbox, Training,
  NEXUS Development, all pinned) and two notes (Trading Revival, Edge of the
  Abyss Media).
- One saved view, `Training Log` (a table of the Training type).
- **The Tracking v1 types aren't in this vault**, and that's on purpose. The
  user dropped some parts, added others and changed the rest. The vault as it
  stands is the source of truth: log types carrying `date` + `done`, and
  Journal carrying `date`.
- Code facts that shape the plan:
  - Journal is filed by hardcoded names (`repo.ts:952`).
  - There is no per-type default folder, although MODEL.md decided on one.
  - There is no reference format and no mermaid rendering.
  - The Tracker already has Week, Quarter and Habits modes over tasks and
    `date`-carrying pages (`date-range.ts`, `Tracker.tsx`).

---

## Item 4a — Organising Pages

**Rule:** hubs on top, logs filed by type, logs read through views.

1. **A type can set a folder (schema v15).** Add `types.folder_id`. New pages of
   that type are filed there. Journal's hardcoded filing becomes a row of
   data, set by a migration. The type editor in `TypesPanel` gets a folder
   picker. This is the MODEL.md decision, built.
2. **"File by type"** is a one-click action on a type: it moves that type's
   pages into the type's folder. It uses the existing multi-select move, and
   nothing is filed without the user's click.
3. **Sidebar order:** Pinned hubs, then folders, then loose pages. Inside a
   folder whose pages carry a `date`, pages sort newest first. A long log
   folder stays collapsed until opened.
4. **The one-time tidy, done in the app:**
   - Folders `Logs/Training`, `Logs/Trading`, `Logs/Habits` (Meditation and
     Wake).
   - Rename `26-09-08` to `Training — 2026-09-08`.
   - The Training hub links its `Training Log` view.
5. **Not in this item:** embedding a view inside a page body. PHASES lists it
   as "not yet". It would make a hub show its own log, which is worth doing,
   but as a separate step after this one.

## Item 4b — The note-taking framework, adapted from `learn`

What carries over from the teach skill: knowledge is a dependency graph. The
roots are **unconditional truths**, accepted as-is with no caveats. Every
other note is **derived**, with its edges written out as "how could I have
discovered this?". Each node gets checked before anything is built on it.
In Nexus terms the graph view and the canvas are the map, and links are the
edges.

**In the vault**: no new formats needed.

| Object | Type | Properties | Body template |
|---|---|---|---|
| A topic (Spanish) | **Topic** (hub, pinned) | goal (text), status | Goal, in your words · Roots (links) · The map (a canvas) · Open questions |
| One idea | **Concept** | topic (select), kind (truth / derived), status (new / shaky / solid) | **Claim**: one line, no caveats · **Why it has to be so** · **Builds on** [[…]] · Examples · **Check**: a question, with the answer in a toggle |
| One session | **Lesson** (filed under `Logs/Lessons`) | date, topic, done | Covered · Missed in checks · Next |

- **Edges are body links** ("Builds on: [[…]]"). Links already feed backlinks
  and the graph, so the dependency map exists without a reference format. A
  multi-reference property can replace them later.
- **Lessons (your own study sessions) carry `date` + `done`**, so they show up in the Tracker and the
  week view like any other log.
- **For Spanish,** concepts hold the rules (for example "a Spanish verb's
  ending names its subject", a universal statement). Vocabulary is not a
  Concept. It goes in one table per lesson, so the graph isn't flooded with
  word nodes.

**No AI teaching by default.** The `learn` method shapes the templates
above, and you write the notes yourself. A `teach` skill (the method minus
pi) gets built only if you ask, and it would run only when you call `/teach`.

## Item 5 — Week and quarter

Both are built inside the existing Tracker modes, not as a new screen.

**Week.**
- **Week page:** a type, `Week`, with `date` set to the Monday, filed in
  `Plans/Weeks`, titled `Week — 2026-10-05`. Its template has two sections:
  Plan (a few intentions plus tasks with due dates, written at the weekly
  review) and Review.
- **Tracker → Week** gets a plan column beside the seven days. It shows that
  week's page, or a "Plan this week" button that creates it from the
  template, the same way `openTodayEntry` does. Each day shows what was
  logged (dated pages by type, done marks).
- No week is made ahead of time. Only the current week offers a button.
- It stands in for v1's dropped Weekly review type.

**Quarter.**
- **Quarter page:** a type, `Quarter`, filed in `Plans`, titled `Q4 2026`.
  - Its body has one section per goal area: direction, floor and signal
    (Body, Trading, MMA, Spanish, Systems).
  - Milestones are dated tasks in that body, kept loose and few.
- **Tracker → Quarter** shows 13 week rows. Each row has:
  - the week page's link,
  - per-type log counts as a strip (Training, Trading, Meditation, Wake,
    Lessons),
  - milestones on their due weeks.
- **Trend lines:** one sparkline per numeric property, once some log
  carries one. Today none does (`done` is a checkbox, so it's counted, not
  trended). Weight is the obvious first one if you add it.

**Calendar view layout:** not part of this. The Tracker already answers
"what's on which day". Per PHASES, calendar waits until it's the shortest
route to something.

---

## Order and size

| # | Step | Size |
|---|---|---|
| 1 | 4a: type folder (v15), File by type, sidebar order, then the tidy | small–medium |
| 2 | 5 week: Week type + plan column | medium |
| 3 | 5 quarter: Quarter type + week rows + strips (trend lines once Journal has numbers) | medium |
| 4 | 4b: Topic/Concept/Lesson types and templates | small, no code |

Each code step follows the existing practice: measure, a probe, and an entry
in ROADMAP. Install with `npm run dist` + `sudo dpkg -i` once Nexus is quit.
