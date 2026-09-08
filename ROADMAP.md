# ROADMAP — what happens before, during and after v11

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

## Wave 2 — Phase 1 (schema v11)

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
silently re-corrects it — every step is guarded, nothing is lost. **After v11
that stops being true**: a v11 vault stamped back to 8 or 9 gets its
irreversible key-collision rewrite run a second time, against data that has
already been through it.

Collapse to one working copy before v11 lands.
