# Plan + handoff: the note-taking framework (Topic, Concept, Lesson, review)

> Written 2026-10-07 as the handoff for the next chat. **Step 1 is built**
> (ROADMAP Wave 9); the open questions are answered at the end.
> It extends `PLAN_Q4_4_5.md` item 4b (the original design) with an
> architecture and a review loop. Paste the block below to start.

```
We're starting the next Nexus feature: the note-taking framework.
Read first: PLAN_NOTES.md (this plan), then PLAN_Q4_4_5.md (item 4b), ROADMAP.md
("Next — queued"), MODEL.md and STRUCTURE.md for the data model. Code to know:
src/main/repo.ts (ensureWeekSetup / ensureBriefingSetup are the pattern for seeding
a type), src/main/schema.ts, src/shared/types.ts, src/renderer/views/Tracker.tsx.
Repo: ~/Desktop/NEXUS Files Loose/nexus-app, branch claude/daily-driver-blockers.
I like ~80% done then polish later. Plain explanations, a recommendation not a survey.
Start by answering the open questions at the end of PLAN_NOTES.md with me.
```

## The goal

Learn things properly in Nexus, Spanish first: a topic broken into small
ideas, each idea written so it could have been worked out from what it builds
on, checked before anything is built on it, and reviewed on a schedule so it
stays learned. You write the notes; there's no AI teaching unless asked.

The method (from `learn`, per PLAN_Q4_4_5.md 4b): knowledge is a dependency
graph. Roots are **unconditional truths**, accepted as-is. Everything else is
**derived**, with its edges written as "how could I have discovered this?".

## What already exists to build on

| Need | Nexus already has | Where |
|---|---|---|
| Types with properties and templates | Types, templates per type, `types.folder_id` filing (v15) | `repo.ts` `createPage`, `getTypeTemplate`; Settings → Types |
| Seeding a type from code | Journal, Week, Quarter, Briefing all do it lazily | `repo.ts` `ensureWeekSetup`, `ensureBriefingSetup` |
| Property types | text, number, date, boolean, select, multi_select, relation, url | `shared/types.ts` `PropertyType` |
| Edges between ideas | Page mentions → backlinks and the graph | `shared/document.ts`, `GraphView.tsx`, `BacklinksPanel.tsx` |
| A map per topic | Canvas (v14), page cards | Wave 4 in ROADMAP |
| Hidden answers | `toggle` block | `schema.ts` `KNOWN_BLOCK_TYPES` |
| Vocabulary lists | `table` block | same |
| Logs in the week | Pages with `date` + `done` show in the Tracker and week view | `Tracker.tsx`, `date-range.ts` |
| Lists of pages | Saved views (table, etc.) with filters | `Views.tsx`, `shared/views.ts` |
| Phone | The morning briefing snapshot | `src/main/briefing.ts` `buildSnapshot` |

## The model

| Type | Filed in | Properties | Template body |
|---|---|---|---|
| **Topic** (hub, pinned) | Notes / Topics | goal (text), status (select: active / paused / done) | Goal, in your words · Roots · The map (link to its canvas) · Concepts (link to its view) · Open questions |
| **Concept** | Notes / Concepts | topic (relation → Topic), kind (select: truth / derived), status (select: new / shaky / solid), due (date), interval (number, days) | **Claim** (one line, no caveats) · **Why it has to be so** · **Builds on** @mentions · Examples · **Check**: a question, the answer in a toggle |
| **Lesson** (a study session) | Logs / Lessons | date, topic (relation → Topic), done | Covered · Missed in checks · Next · Vocabulary (a table) |

Decisions this makes, each a recommendation to confirm:

1. **Seed the three types in code**, the way Week and Briefing are, so the
   templates are exact and a fresh vault gets them. Lazy: nothing is
   created until the first "New topic".
2. **"New topic"** (command palette / sidebar) makes the Topic hub, pins
   it, makes its canvas, and a saved view "Concepts: <topic>" filtered on
   the relation. That's the only new UI in step 1.
3. **File by type, group by relation.** `types.folder_id` gives one folder
   per type, so concepts of every topic share Notes / Concepts; the topic
   relation and the per-topic view do the grouping. This avoids fighting
   Wave 7's filing rule.
4. **Edges are body mentions** ("Builds on: @…"), which already feed
   backlinks and the graph, so the dependency map exists on day one. A
   multi-page "builds on" relation can come later if queries need it.
5. **Topic is a relation, not a select**, so a new topic needs no options
   maintained, and the Topic page's backlinks list its concepts for free.
6. **Vocabulary isn't a Concept.** It goes in the Lesson's table, so the
   graph isn't flooded with word nodes. Rules ("the verb ending names the
   subject") are Concepts.

## Review (spaced repetition), the second half

A Concept's **Check** is the card: the question is the line, the answer is
the toggle's content.

- **Schedule on the Concept itself**, in two properties: `due` (date) and
  `interval` (days). A Leitner-style ladder: 1, 3, 7, 16, 35, 80 days.
  *Good* moves up a rung, *Again* drops to 1 and sets status to shaky,
  three Goods in a row at 16+ sets solid. No ease factor, no hidden table:
  the schedule is visible and editable on the page.
- **A Review surface**: a Tracker mode or a Home widget "Due for review (N)".
  It shows one question, reveals the answer on a key, takes Again / Good, and
  writes `due` and `interval`. Keyboard-first, a few seconds a card.
- **A review is logged** to today's Lesson for that topic (made if missing)
  as "Reviewed N, missed: …", so missed checks feed the next session.
- **The briefing**: the snapshot gains `reviewsDue` (count per topic), and
  the briefing's Plan gets one line, "Review: 6 Spanish concepts due".
  Needs a small change in exec-bot's `prompts/briefing.md` too.

## Order and size

| # | Step | Size |
|---|---|---|
| 1 | Seed Topic / Concept / Lesson types + templates; "New topic" (hub, canvas, view) — **done** | small–medium |
| 2 | You write the first Spanish topic by hand: ~10 concepts, roots first | yours |
| 3 | Review surface + the schedule properties | medium |
| 4 | Review logged to the Lesson; `reviewsDue` in the snapshot and briefing | small |
| 5 | Later: a "builds on" relation, a check-before-build warning (a derived concept whose roots are still new/shaky) | small each |

Each code step: a probe or check script like `scripts/check-phone.mjs`, an
entry in ROADMAP.md (it would be Wave 9), `npm run typecheck`, then
`npm run update` (the user runs it; sudo).

## Open questions (answer these first)

1. **Where is `learn`?** PLAN_Q4_4_5.md adapts "the learn-repo method" and a
   `teach` skill. Neither is on this machine or in its notes; if it's a
   GitHub repo or a skill, reading it would sharpen the templates.
2. **Spanish only to start,** or another subject alongside (the Library
   folder has Polya, Hurley's logic, networking)?
3. **What's a Lesson for Spanish:** your own study session, a Pimsleur
   lesson, or both?
4. **Review where:** a Home widget, a Tracker mode, or both?
5. **Grades:** Again / Good only (recommended), or Again / Hard / Good / Easy?

### Answers (2026-10-07)

1. **`learn`:** go without it. Item 4b's summary is the method.
2. **Subjects:** Spanish should be ready to go, and the framework should
   work for any subject. So the types are generic, and a topic is made by
   name ("New topic").
3. **Lesson:** both. Any study session is a Lesson. A Pimsleur one fills
   the `source` property (e.g. "Pimsleur 1-07").
4. **Review where:** both. A Home widget "Due for review (N)" and a Tracker
   mode, sharing one review component.
5. **Grades:** Again / Good (the default, not pushed back on).

### What step 1 built (and how to use it)

- ⌘K, type **Spanish**, pick **New topic "Spanish"**. This makes the
  pinned hub, the canvas "Spanish — map", and the view "Concepts: Spanish".
- With the hub (or any Spanish concept) open: ⌘K → **New concept** opens a
  Concept already set to Spanish, status new, kind derived. Change kind to
  `truth` for roots. ⌘K → **Today's lesson** opens (or makes)
  "Spanish — <date>".
- With only one topic in the vault, both work from anywhere.
- Not built yet: the review surface and schedule logic (step 3), lesson
  logging and the briefing (step 4). `due` and `interval` exist but are
  only set by hand for now.
