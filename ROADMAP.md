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

## Wave 4 — Canvas (schema v14)

Asked for from daily use, alongside the graph fixes: somewhere to arrange
pages and thoughts spatially, the way Obsidian's canvas does. Three calls were
made before building, by the user:

- **Its own section, not a kind of page.** Canvases do not sit in the Notes
  tree and carry no tags or pins. The table is shaped so folders or tags can be
  added as columns later without touching a document, and that rebuild is
  deliberately not done yet.
- **React Flow, not hand-rolled.** See `NEXUS.md` on Canvas for why this is the
  exception to the graph's hand-written physics.
- **A mix of card kinds.** Markdown text cards for speed, page cards that open
  the real block editor in place, one editor mounted at a time.

Followed by pictures on canvases (paste, drop, or pick; stored as
attachments and counted by reclaim) and canvases as hubs on the Home graph.

Then the feel pass: edges that resize, corners on hover, a 4px click
tolerance, and copy, cut and paste of cards within and between canvases.

**Left, deliberately:** web-link cards, and folders or tags for canvases.
Each is additive to the stored format.

## Wave 5 — App lock

A password to open Nexus, idle lock, lock on sleep, lock now. Deliberately a
lock on the app and not on the files; `NEXUS.md` on Settings has the four
decisions behind it, and `scripts/probes/app-lock.mjs` checks each one.

## Wave 6 — feel, the editor upgrade, right-click (shipped)

Asked for from daily use as "clicks should feel crisp, like grabbing
something". Measured first: typing was already fast, so the softness was
feedback, not speed.

- **Press states everywhere** — a press is never eased and is stronger than
  hover (DESIGN.md states the rule). Graph hover without fades, drift that
  holds still under the pointer; canvas edges that resize, a 4px click
  tolerance, copy/cut/paste of cards between canvases.
- **BlockNote 0.24 → 0.55** on tiptap 3, tested against a copy of the real
  vault (structure only): no text changes on save, and 0.24 reads 0.55's
  documents, so a rollback is safe. NEXUS.md has what changed and why.
- **The editor's feel** — a handle you take hold of, the carried block
  marked in place, a landing line that jumps instead of gliding, 0.24's
  spacing restored.
- **Right-click** in the editor, every text field, the canvas and the graph,
  through one menu host.

## Wave 7 — a type files its pages (schema v15, shipped)

Q4 item 4, first half. The plan for items 4 and 5 is in `PLAN_Q4_4_5.md`.

- **`types.folder_id`.** New pages of a type land in its folder. A
  top-level page that is retyped follows it there. Settings → Types has the
  picker and a "File N" button for pages already loose. Templates are never
  moved.
- **Journal is ordinary data now.** It used to be filed by a hardcoded
  folder name. The migration writes its folder into its row once, so
  clearing it later sticks.
- **Deleting a folder** hands its types to the parent, as it does its pages.
- **Sidebar:** pinned top-level pages (hubs) sit above the folders. Inside a
  folder, dated pages sort newest date first, not most recently edited.

## Wave 7b — the week, planned as it goes (shipped)

Q4 item 5, first half.

- **A Week page per week**, dated by its Monday and titled `Week — <date>`.
  It's made from a Week template (two headings, Plan and Review) and filed
  in Plans / Weeks through the type's folder. It's created lazily, like the
  journal.
- **Tracker → Week** shows the week's plan above the days:
  - the lines under Plan, then the week's undated tasks;
  - a "Logged" line counting each type's logs (done of total when the type
    has a done box).
- **"Plan this week" and "Plan next week" buttons.** Next week is offered so
  a review held on Sunday can plan it. Nothing further ahead.
- **Plan tasks belong to the week, not to Monday.** Otherwise they would
  inherit the page's date, pile up on Monday and count as "left open" on
  Tuesday. A plan task given its own `@date` moves onto that day.
- **Done marks.** Logs with a `done` box show it on their day: filled when
  done, quieter when not.

## Wave 7c — the week on Home (shipped)

- **A Week widget.** A Mon–Sun strip, where each day shows its logs as
  diamonds (filled when done) and its task count. Below it are the plan's
  lines and its tickable tasks, then the Logged line. It offers "Plan this
  week" when the week has no page. The rules for what belongs to the week
  live in `views/week.ts`, which the Tracker shares, so the two can't
  disagree.
- **The Vault panel is retired.** Saved layouts drop the `stats` kind on load
  rather than drawing it as "not installed". The default Home is now Today
  next to Week.

## Wave 7d — calendars, read from a link (shipped)

- **Settings → Calendars.** Paste an ICS link (Proton's "share with anyone"
  link, or any other) into a password field. It's stored in `settings`, in
  the main process only, and the renderer is only told the host. You can add
  several feeds.
- **Fetching.** Feeds are fetched on demand, at most every 10 minutes. The
  last good copy is kept, so Nexus works offline, and a feed that fails is
  named and doesn't block the others. Links must be https (or `webcal`), or
  http to localhost.
- **Expansion** uses `ical.js` (MPL-2.0): recurrence, EXDATE, moved
  occurrences, VTIMEZONE, plus an `Intl` fallback for a TZID the feed names
  but doesn't define. `scripts/check-calendar.mjs` covers it.
- **A Calendar widget** shows Mon–Sun with week arrows. All-day items come
  first. Events that are over are dimmed. Clicking an event with a link opens
  it in the browser.
- **Tracker → Week** shows each day's events above its tasks.
- **Monday first everywhere.** Home's habit strip now shows last week and
  this one, Monday to Sunday, instead of the last 14 days. Days still ahead
  are drawn but can't be clicked.

**Later — a calendar an AI fills.** Feeds are read-only, and Proton has no
write API. So the shape is: the AI writes its own ICS feed, Proton
subscribes to it, and Nexus reads both. Nothing here needs to change for
that.

## Wave 7e — one surface for the days (shipped)

- **No more sunken days.** Calendar and Week cells for past days were
  filled near-black, future ones weren't, so every week read as two slabs
  split at today. All days now sit on the panel's own fill behind one
  hairline. Past is told by a dimmer day name, not a darker box. The empty
  "No plan for this week yet" card lost its black well too.
- **Finished events dim by colour, not opacity.** At 50% the text and edge
  came out an off-green grey. Upcoming timed events carry a soft accent
  edge, finished ones a neutral one.
- **Habit squares by colour, not depth.** Empty is an outline, done is
  emerald, and a recorded "no" is a critical-red tint (Home strip and the
  Tracker year grid alike; the legend says "not done"). Days still to come
  are the faintest outline, no dashes.
- `scripts/probes/home-look.mjs` seeds habits and a calendar feed and
  screenshots Home and the year grid, for looking at rather than asserting.

## Wave 7f — the quarter, read as its weeks (shipped)

Q4 item 5, second half.

- **A Quarter page per quarter**, titled `Q4 2026`, filed in Plans, made
  lazily from a Quarter template: a section per area (Body, Trading, MMA,
  Spanish, Systems) with Direction / Floor / Signal lines, then Milestones.
- **No date on it, on purpose.** An undated task inherits any date its page
  carries, so a quarter page dated 1 October would pile its lines onto that
  day and call them left open on the 2nd. It's found by a text property
  (`quarter` = `2026-Q4`) instead. Milestones carry their own `@date`, so
  they land on their day and go overdue like any commitment. Undated lines
  stay in the quarter and out of "No date".
- **Tracker → Quarter** shows the areas as cards with the milestones under
  them, then one row per week the quarter touches (13 or 14): the week
  page (open, or plan for this week and next), tasks done of total (plan
  items excluded), a column per log type (done of total, emerald when all
  done), and the milestones due that week, tickable. The week you're in is
  marked like today is in the week view. The 90-day list of days is gone;
  the week rows replace it.
- "Plan this quarter" and "Plan next quarter", never further ahead.
- **Trend lines** still wait until a log carries a number.

## Wave 8 — the phone: reminders and the morning briefing (shipped)

Nexus's half of the Exec-Bot (`~/Desktop/exec-bot`, plan in its
`PLAN_BRIEFING.md`).

- **Settings → Phone.** An ntfy topic, kept in the main process like a
  calendar link and never shown again, with a test button.
- **Remind** in the capture bar: "1600 armored mma", "tomorrow 4pm …",
  "fri 0800 …", "30m …". Sent to ntfy at once as a Unix timestamp (ntfy.sh
  reads words in UTC). Further out than ntfy's 3-day window, it's held in
  Nexus and handed over once inside it.
- **`!1600` lines** in any page. Sent once the line has stopped changing for
  45 s, or on quit; dated by the page's `date`, a day on under "Plans for
  tomorrow". Fire-and-forget: deleting the line after it's sent doesn't stop
  it; deleting it before does. The log lives in `settings` (no schema change).
- **The hand-off** (off until switched on): after edits settle, Nexus writes
  `snapshot/<day>.json` for the next 8:30 briefing (the evening's plans,
  tasks due, overdue, week plan and logs, milestones, recent training,
  reminders, calendar) and pushes it to the Exec-Bot repo with the machine's
  git login. It pulls `briefings/` every 30 min.
- **A Briefing widget on Home**: the routine's message, plus upcoming pings.
  The briefing goes into today's entry once, the first time it's opened
  after the briefing arrives, and on demand.
- `scripts/check-phone.mjs` runs it all against a fake ntfy and a bare repo.

**Not forgotten:** adding events to the Proton calendar by command. Waits for
the calendar feed (Exec-Bot event finder).

## Next — queued, in no fixed order

**Lasso and tools on the canvas.** A left-button drag on empty canvas draws
a freehand lasso; every card whose centre lies inside is selected, and
Ctrl/Shift adds to the selection rather than replacing it. Panning stays
available as a second tool: **double-clicking empty canvas switches between
the lasso and the hand** — it used to make a text card, which the
right-click menu ("New text card here") now covers. The current tool shows
in the canvas bar and in the cursor (crosshair / open hand). Drawn as an
accent hairline over a faint tint, gone on release, no fade.

**Lasso in the editor.** Wanted, but a ProseMirror selection is one
contiguous range, so a lasso there can only select from the first block it
crosses to the last. And a left drag inside text is already text selection;
the lasso has to start somewhere text is not — the left gutter beside the
blocks is the obvious place. Design that before building it.

**Columns in the editor.** `@blocknote/xl-multi-column`, the library's own
column blocks — check its licence first (BlockNote's XL packages have been
GPL-3 or commercial). The first build died fighting a hand-rolled column
overlay, so the rule is the multi-block-selection rule: the library's
blocks or nothing. `schema.ts` still unwraps legacy `column` / `columnList`
in the v1 migration and leaves them out of `KNOWN_BLOCK_TYPES`; both change.

**A note-taking framework.** The rest of item 4: Topic, Concept and Lesson
types with templates, in which the learn-repo method is written by hand
(Spanish first). There's no AI teaching unless asked. See `PLAN_Q4_4_5.md`.

## Future — an encrypted vault

The app lock's stated limit is that the files are readable. The feature that
removes the limit, wanted and not yet scheduled:

- **The database encrypted at rest**, with a key derived from the password:
  SQLCipher through `better-sqlite3-multiple-ciphers` in place of
  `better-sqlite3`. The app lock becomes the key prompt rather than a gate.
- **Attachments and launch snapshots** encrypted too, or the pictures and
  every backup are the plaintext the database no longer is.
- **The mirror** turned off, or written only somewhere encrypted — a plain
  Markdown copy of an encrypted vault undoes it.
- **No recovery.** A forgotten password is a lost vault, by design, so it
  needs an explicit exported recovery key and a first-run flow that says so.
- **A migration** that encrypts an existing vault in place, with a verified
  copy first — the most dangerous step Nexus would ever run.

It touches opening the database, backups, restore, the mirror and every
check that reads `nexus.db` directly, so it is a phase with its own plan in
`PHASES.md` before any code.

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
