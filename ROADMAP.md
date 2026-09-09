# ROADMAP — what happens before, during and after the schema phases

> The near-term order of work and the decisions behind it. `PHASES.md` is the
> structural plan and outranks this document from Phase 1 onward; this one
> exists for everything that has to be true *before* Phase 1 starts, and for
> the calls made along the way that a phase document has no place to record.
>
> Read with `NEXUS.md` (what Nexus is) and `PHASES.md` (where it is going).

---

## Why anything comes before Phase 1

Phase 1 separates property identity from membership, and every later phase
assumes it. It is also the only irreversible step in the plan. Two things
follow from that, and they point in opposite directions.

**It should happen soon.** Its risk is concentrated in one place: when two
types define the same property key with different formats, the migration
renames one and rewrites `properties.key` for every object of the affected
types. That is cheap at a vault of 15 pages and a handful of types. It is an
afternoon and a restore at 500 pages with a year of property sprawl.

**It should not happen first.** Phase 1's whole payoff is that properties
become easier to define and reuse. Until this branch, a type could not be
created anywhere except a magic entry in a dropdown, and a property could not
be defined except from a page of that type. Improving the management of a
thing that could not be reached is not an improvement. The door came first.

---

## Wave 0 — the blockers (shipped)

Three complaints from daily use, all of which turned out to be one shape of
bug: the app had features with no reachable way to use them.

- **Types have a home.** `TypesPanel` in Settings: create, rename, delete,
  template, add and remove properties, and a one-step *Create as habit* that
  defines the date and checkbox a habit is made of. See `NEXUS.md` on
  Settings for why this is configuration rather than content.
- **Tables and Activity are gone.** Tables is scheduled for demolition in
  Phase 4, which rebuilds it as a view over the view engine — polishing it now
  is work thrown away twice. Activity had one consumer and no dependents; the
  `activity_log` writes stay, and the feed comes back inside Phase 4 rather
  than as a screen of its own.
- **The day-start hour stopped moving the clock.** Home's header shows the
  wall date; the logical day is named in a line underneath, but only during
  the hours the two actually disagree.

## Wave 1 — the editor (shipped)

**Diagnosed and fixed.** "Blocks respond poorly" was one specific thing, and
it is the reason the report was so hard to put into words: it was not slow and
it did not break — a menu simply did not come when called, in two blocks out
of seven, and only after you had started writing in them.

Typing `/` in a `callout` or a `toggle` that already had text inserted a
literal slash and opened nothing. So did `[[`, which meant a callout was a
block you could not link out of. Empty, both blocks behaved; that is what made
it feel intermittent rather than broken.

ProseMirror routes a typed character through `handleTextInput`, which is the
only thing BlockNote's suggestion plugin listens to. For the built-in blocks it
always does. For a custom React block spec it stops once the block has content,
and there is nothing thrown and nothing logged when it does. `Editor.tsx` now
watches for the two trigger characters in those two block types and calls
`editor.openSuggestionMenu` — the editor's own public opener, the one the side
menu's "+" button uses — rather than reaching into the plugin. This build
exists because the last one died fighting the editor's internals; the fix had
to be something BlockNote offers on purpose.

`scripts/probes/blocks.mjs` is the reproduction that was missing, and asks
every block type the same question twice: empty, and with a word in it. Every
row reads `true / true` now; callout and toggle read `true / false` before.
`check-app.mjs` asserts the same thing so it cannot come back.

**The suspect that was eliminated stays eliminated.** `@tiptap/*` resolves
2.11.5 on every path; the pin was not the problem.

## Wave 1b — the deep dive (shipped)

Looking for what else was shaped like Wave 0 — a capability the app had and
no reachable way to use — turned up four more, all of them things a daily
driver does dozens of times a day.

- **⌘K searches what pages say.** It ran Fuse over titles alone, in memory,
  while a full-text index of every body sat in the main process reachable only
  from the Notes sidebar's own filter box. The one global way into a vault
  could not find a sentence you had written. It now runs both matchers — the
  index first, with the excerpt it matched on, then the fuzzy titles the
  index's whole-word matching passes over.
- **Browsing by type came back.** Tables owned two things and only one of them
  was re-homed when it left: type *management* went to Settings, and type
  *browsing* went nowhere. For a fortnight there was no way to ask "show me
  every Book", which is the question a type exists to answer. `TypeFilter` is
  a rail of type chips beside the tag chips, over the page list the store
  already holds — no new query, and nothing that Phase 4's view engine has to
  keep.
- **The autosave stopped re-rendering the editor doing the typing.**
  `patchPage` rebuilt the `pages` array on every content save, so the save your
  typing triggered handed a new object to the folder tree, the properties panel
  and the editor, 600ms after every pause. Measured on a 1500-page vault with
  `scripts/probes/typing.mjs`: three dropped frames in a twelve-second burst,
  worst 117ms, down to none, worst 17ms. Small vaults never felt it, which is
  why this was not the answer to Wave 1 — but it was real, and it was the
  autosave feeding itself.
- **The window comes back where it was left.** It opened 1280×820 wherever the
  window manager felt like, every launch.

## Wave 1c — the daily loop (shipped)

Everything wave 1b found and deliberately left, built once the decisions behind
each one had been made.

- **Capture from anywhere, and from outside.** `CaptureBar` moved out of Home
  and the overlay mounts the same component; `⌘⇧K` opens it over any screen.
  The system-wide key is off by default, spelled by the user, and says so when
  another application already holds the combination. The action Nexus exists
  for no longer costs finding the window first.
- **A real keyboard map.** One list, dispatched by the handler and rendered by
  Settings — capture, today's entry, the inbox, each of the five views, and the
  notes search box. There were five bindings, three of which were BlockNote's.
- **Several pages at once.** ⌘/Ctrl-click and Shift-click in the Notes list,
  then move, tag, export or trash the lot. Filing a week of captures was twenty
  drags.
- **A page can be exported on its own** — which is what the same control does
  with one page selected. `io.exportPageMarkdown` and `exportPageJSON` had been
  implemented, tested, and reachable from nothing.
- **A tag's colour can be chosen**, from the rename state on the chip.
  `tags.setColor` was the other channel nothing called.

**Left, deliberately:** `search.rebuildIndex` still has no button — a drifted
index has never actually happened, and a repair control for a fault nobody has
seen is a button that gets clicked when something *else* is wrong. And
collapsing a toggle still counts as editing the page: `open` lives in
`block.props`, so folding one bumps `updated_at` and moves the page in every
recency list. Reading should not be writing, and the fix is for the autosave to
ignore a change that only moved an `open` prop.

## Wave 2 — Views (shipped, out of order)

**Phase 4 came first.** The plan had it fifth, behind three schema phases, on
the argument that a view needs properties worth filtering. What beat that
argument is that until this shipped, nothing in the app could show a *set* of
typed objects at all: Tables had been removed in wave 0, so a type could be
defined, filled in, and never looked at again. Everything a type is *for* was
unreadable, which is the same mistake wave 0 found in types themselves — a
capability with no door.

What shipped, at schema v11:

- **The filter tree, in the shape `PHASES.md` fixes it**, plus one field kind
  it did not have (`tag`, because tags are their own tables until phase 2b).
  `repo.compileFilter` is the only place it becomes SQL, and nothing in the
  renderer interprets a filter — the builder edits the tree and hands it back.
- **Four layouts over one query.** Table, list, board, gallery, registered in
  one map. A board is the rows grouped by a field; a gallery is the same rows
  as cards. Adding a calendar is a function and a line, not a second query.
- **A table's columns are the type's own schema in the type's own order**, when
  the view names one type — the order the properties panel shows and the mirror
  writes. Sorting a column writes the view, so the order survives leaving it.
- **"Save as a view"** on the Notes filter rail, which is what turns the chips
  from a gesture into somewhere you go back to.

What it costs, and where it is written down: phase 1 renames property keys to
resolve format collisions and must rewrite every saved filter that names one;
phase 2b turns tags into a property and must rewrite every `tag` condition.
Both are recorded in `PHASES.md` under the phases that owe them.

## Wave 2b — Phase 1 (schema v12)

In this order, and the order is the point:

1. A fixture in `scripts/check-migration.mjs` carrying a **deliberate format
   collision**, written and failing *before* the migration exists.
2. The migration.
3. `PropertiesPanel` reading the object's own rows merged with its type's.

`PHASES.md` has the DDL, the six migration steps and the Do-not list.

## Wave 3 — multi-block selection

**Decided: it gets built.** A modern editor lets you select several blocks and
act on them, and the absence is felt daily. Scheduled after Phase 1 rather
than before it because it changes no data and blocks nothing.

**One constraint, and it is not negotiable.** It goes through BlockNote's own
multi-block selection, not a custom overlay drawn over ProseMirror. The
distinction is the entire reason this build exists: the first one died in a
debugging loop against a hand-rolled selection overlay and a multi-column
layout, both fighting the editor's internals instead of using what it already
gave. Same feature, and it survives a BlockNote upgrade.

## Deferred

**Tracker.** Known to be weaker than it should be. Left alone deliberately:
Phase 3 turns tasks and check-ins into real objects and Phase 4 gives the
view engine, and most of what the Tracker is missing arrives as a consequence
of those rather than as a Tracker rewrite.

---

## One-vault hygiene

Six git checkouts on one machine, all pointing at one vault in
`~/.config/nexus`, is how three weeks of confusion happened: whichever
directory `npm run update` last ran from is what `/opt/Nexus` became, and two
of those checkouts sit at `SCHEMA_VERSION` 8 and 9.

Today an old build mis-stamps `user_version` and the next current-build launch
silently re-corrects it — every step is guarded, nothing is lost. **After
phase 1 that stops being true**: a vault carrying its key rewrite, stamped back
to 8 or 9 by an older build, gets its
irreversible key-collision rewrite run a second time, against data that has
already been through it.

Collapse to one working copy before phase 1 lands.
