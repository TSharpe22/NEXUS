# QA scan — Nexus, 2026-08-20

> **Status: every finding below is fixed** except §6's scope question, which
> was resolved by implementing it. See "What was done" at the end for the
> after-numbers and what is deliberately left open.

Scan of the daily-driver build: `main` at `831308a` **plus** the unmerged
`claude/nexus-home-page-jcf28c` (Home rebuilt as the day, pinning, quick
capture, stale rule), merged locally to scan what is about to be on `main`.
The merge is clean and needs no conflict resolution.

## Build health

Everything the repo already checks is green on the merged tree:

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `check:migration` | all pass, including the new v10 pin cases |
| `check:backup` | all pass |
| `check:app` | **281/281 pass**, no uncaught renderer errors |

Nothing below was caught by those 281 assertions — every finding is a gap in
what is asserted, not a regression against it.

Measured on a seeded vault (400 and 1500 pages, `scripts/probes/`, run under
xvfb):

| | 400 pages | 1500 pages |
|---|---|---|
| view switch | 57–84ms | — |
| `pages.list` | 6ms | 76ms |
| `stats.getGraph` | 9ms | 65ms |
| FTS search | 3ms | — |
| editor typing, p95 frame | — | 17ms (60fps) |

The data layer is fast and the editor stays at 60fps under a 1500-page vault.
The problems are elsewhere.

---

## 1. Silent data loss: an edit inside the autosave window dies on quit

**Severity: highest. This is the one to fix before daily use.**

Type something and close the window within the 600ms content debounce (or the
400ms title debounce) and the edit is gone. Verified both ways a user can
close the app:

```
window close (X):
   body edit survived:  false
   title edit survived: false
app.quit() — Ctrl+Q / menu Quit:
   body edit survived:  false
   title edit survived: false
```

`Editor.tsx` does have a `beforeunload` flush, and it fires. The failure is
ordering in the main process. From the instrumented run:

```
[renderer] [probe] beforeunload fired
[main:err] pages:update TypeError: The database connection is not open
    at updatePage (out/main/index.js:753)
[renderer] [probe] invoke rejected ... 'pages:update': The database connection is not open
```

`app.on('before-quit')` runs `closeDatabase()` synchronously, and the flush's
`ipcRenderer.invoke` is async — so the write arrives at a closed handle. It
rejects, `setSaveStatus('error')` fires into a renderer that is being torn
down, and nobody ever sees it. `src/main/index.ts:66` is the line.

The comment in `Editor.tsx` ("Quitting or reloading mid-debounce would
otherwise drop the last edit") describes an intent the current shutdown order
defeats.

**Fix shape:** the database has to outlive the flush. Take over `before-quit`
once — `e.preventDefault()`, ask each window to flush and wait for the ack
with a short timeout, then `flushMirror()`, `closeDatabase()`, `app.exit()`.
A `will-quit` move alone is not enough; the invoke still has to be awaited.

Same class, same fix: Ctrl+R (the default menu's Reload) drops the pending
edit too.

---

## 2. Two instances share one vault, with no lock

Launching Nexus twice — double-clicking the desktop entry while it is already
running — opens a second window against the same `nexus.db`. Verified:

```
SECOND INSTANCE ALSO OPENED A WINDOW on the same vault
  second instance sees the first instance page: "instance A"
  after B writes, A reads: "written by B"
```

WAL plus `busy_timeout` keeps the file intact, but each process holds its own
renderer-owned `pageContent` cache. Instance A's editor is now sitting on a
document that B has already replaced, and A's next keystroke saves that stale
copy over B's work — exactly the failure the store's comments are written to
prevent, arriving from outside the process instead of inside it.

`app.requestSingleInstanceLock()` plus focusing the existing window is the
whole fix, and it belongs next to the fix for §1.

---

## 3. Quick capture loses focus after every capture

The capture box is the new Home's fastest path in, and it only works once per
click. Verified:

```
focus after capture: {"active":"BODY","value":""}
value after typing again without clicking: ""
```

`CaptureBar` sets `busy` before the await, which renders the input
`disabled`; the browser blurs a disabled element. `inputRef.current?.focus()`
then runs while the element is still disabled, so it is a no-op, and
`setBusy(false)` re-enables an input nobody is focused on. A second thought
typed straight after the first goes to `document.body` and is silently lost.

**Fix shape:** don't disable the input (guard on `busy` inside `submit`
instead), or move the refocus into an effect that runs after `busy` clears.

---

## 4. Home's graph is the app's landing screen and does not scale

At 1500 pages, mounting Home:

```
{"totalMs":6058,"worstFrameMs":201,"p95FrameMs":97,"frames":89}
```

89 frames in 6 seconds — roughly 15fps for several seconds after every visit
to Home. Typing into the capture box during that window costs 58ms per frame
(30 input frames in 1742ms). The app opens on this screen.

Two separate causes:

- **The simulation is O(n²) per tick × 420 ticks**, on the main thread.
  `GraphView.tsx:20` says so honestly — "tuned for a personal vault, tens to
  low hundreds of pages" — but Home now puts it on the screen the app opens
  to, which changes what it has to survive.
- **Every node draws a label unconditionally** (`GraphView.tsx:396`). At 400
  nodes in the 210px Home panel it is already an unreadable smear; at 1500 it
  is solid text. Labels also run under the +/−/fit controls and the legend
  line overlaps the nodes.

**Fix shape, cheapest first:** label only hovered/active/high-degree nodes
below some node count; cap ticks (or freeze the layout) past a threshold;
consider a node budget for the Home panel with "open the full graph" as the
escape hatch. Nothing here needs d3-force.

---

## 5. Export overwrites pages that share a title, and reports success anyway

`io.exportAllMarkdown()` builds `${title}.md` per page with no dedup, and
`fs:writeFiles` writes each straight into the folder. Two pages called
"Untitled" — or two "Meeting notes" — produce one file: the last one wins.
The toast then reports `files.length`, so it claims to have exported pages
that are not on disk.

The mirror already solved this properly (`computePaths` disambiguates with a
suffix in creation order). Export should use the same rule, or at minimum
dedup and report what it actually wrote.

Related, in the same file: `exportPageMarkdown` does a bare
`JSON.parse(page.content)`. One unparseable body throws and takes the whole
export with it — `parseDocument()` exists in `shared/document.ts` for exactly
this and tolerates it everywhere else.

---

## 6. Markdown import flattens every document to paragraphs

`importMarkdown` is a line-to-paragraph mapper: headings arrive as literal
`## Heading` prose, bullets as `- item` prose, checkboxes as `- [ ] todo`
prose. A Nexus export re-imported does not round-trip.

It also emits blocks with no `id`. Nothing reads that today, but `extractTasks`
skips any block without one — so the moment import learns to make
`checkListItem`s, those tasks are invisible to the Tracker and to Home until
the page is opened and re-saved. (I hit this while seeding: id-less checkboxes
projected zero tasks; with real ids, 1500 pages projected 1000 open tasks
correctly.)

For a tool meant to replace Notion/AnyType, import is the migration story.
Worth deciding whether it is in scope now or explicitly deferred in NEXUS.md —
right now the code says "naive" and the docs say nothing.

---

## 7. Activity view has not kept up with the new event types

Visible in a screenshot of the current build:

- **Trashed pages lose their names.** `titleFor` looks only in `pages`, never
  `trashed`, so every historical row for a page you trashed renames itself to
  "Untitled".
- **`EVENT_LABEL` is missing `pinned`, `unpinned`, `folder` and `tag`**, so
  those rows show the raw enum in lowercase next to properly-cased "Edited"
  and "Created". Pinning is new on this branch; the label map was not updated.
- **Event and Detail are the same string** on most rows — "Edited / edited",
  "pinned / pinned". `logActivity(id, 'edited', 'edited')` and the pin call
  both pass the event as the message. The Detail column earns nothing on those
  rows.
- The comment about "rows for pages that were deleted for good" is stale:
  `activity_log.page_id` is `ON DELETE CASCADE`, so those rows are gone.

---

## 8. Smaller edges

- **The save indicator never goes idle.** Nothing calls
  `setSaveStatus('idle')`, so the topbar reads "saved" permanently after the
  first save, on every view. Worse: a failed save leaves "could not save" on
  screen forever, with no way to clear it and no way to retry.
- **Nothing is restored on relaunch.** Every launch lands on Home with no page
  selected. The tree's expansion is persisted; the view and the open page are
  not. For a daily driver, reopening where you left off is cheap and expected.
- **Two global shortcuts only** (⌘K, ⌘N). No ⌘S-to-flush, no view switching by
  number, no ⌘Enter on the capture box. MVP-acceptable, but Settings lists
  shortcuts as if the set were considered done.
- **`dialog:showSelectFolder` returns null when no window has focus**
  (`BrowserWindow.getFocusedWindow()`), and both callers treat null as "user
  cancelled" — so choosing an export or mirror folder can silently do nothing.
- **`mirror.scheduleSync()` sits in `finally`** on most IPC handlers, so a
  rejected operation (a folder-cycle move, say) still schedules a sync. Only
  wasted work, but on the un-narrowed handlers that is a full vault pass.
- **`Notes` destructures the whole store** with no selector, and `FolderTree`
  is not memoized, so every autosave re-renders the entire tree. At 1500 pages
  that is the single 175ms hitch visible in the typing trace. Invisible at
  normal sizes; the cheap fix is selectors.
- **No list virtualization** in Notes or Tables. 1500 rows mount in ~1.5s and
  scroll fine, so this is a watch-item, not a bug.

---

## Checked and found correct

Worth recording so the next scan doesn't redo it:

- Task projection from real BlockNote documents: 1500 pages → 1000 open tasks,
  `@YYYY-MM-DD` due dates parsed, `openTaskCount` correctly excludes trash.
- The v10 pin migration: additive, idempotent, never invents or clears a pin.
- `journal.peek()` does not create the entry or the Journal type — Home
  renders without writing to the vault.
- Hard delete and empty-trash: every derived table cascades, `page_fts` is
  cleaned explicitly.
- Launch snapshots: first launch takes none, an unchanged vault is not
  re-snapshotted, rotation drops oldest-first.
- Folder cycle prevention, tag-rename merging, relation-property backlinks,
  the tiptap 2.11.5 pin (callout/toggle text lands in the right block).
- Search sequence-guarding, `loadPageContent`'s post-await cache re-check.

---

## Suggested order

1. **§1 shutdown flush** and **§2 single-instance lock** — both are data loss,
   both are small, both live in `src/main/index.ts`.
2. **§3 capture focus** — one-line class of fix, and it breaks the newest
   feature's main path.
3. **§4 graph labels** (cheap) then the tick budget (less cheap) — Home is the
   first screen every session.
4. **§7 Activity** and the **§8 save indicator** — visible polish, an hour.
5. **§5 export dedup**; then decide whether **§6 import** is in scope or gets
   written down as deferred.


---

# What was done

All of it, on `claude/nexus-qa-scan-4h6ozm` (which also carries the merge of
the Home branch, since §3 lives in code that is not on `main` yet). The suite
is green at **372 assertions**, up from 281 — the two failures worth guarding
are now assertions rather than notes.

| § | Fix | Verified by |
|---|---|---|
| 1 | Window close is held open while the renderer flushes; the database closes on `will-quit`, not `before-quit` | new assertions in `check:app`; `probes/quit.mjs` |
| 2 | `requestSingleInstanceLock()`, second launch focuses the existing window | `probes/quit.mjs` |
| 3 | Capture input is no longer disabled mid-capture; focus restored after `busy` clears | new assertion in `check:app` |
| 4 | Positions painted imperatively; grid repulsion; clamped impulses; hub-only labels; proportional fit padding | `probes/scale.mjs`, `probes/graph.mjs` |
| 5 | Export filenames disambiguated; `parseDocument` instead of a bare `JSON.parse` | `probes/roundtrip.mjs` |
| 6 | Markdown import parses headings, lists, checkboxes, quotes and fences, and emits block ids | `probes/roundtrip.mjs` |
| 7 | Activity: pin/folder/tag labels, trashed titles, no more duplicated detail column | screenshot |
| 8 | Save indicator returns to idle; dialogs no longer need a focused window; mirror syncs moved out of `finally`; `Notes` uses store selectors | typecheck + suite |

## The numbers, before and after

Home at a 1500-page vault, over six seconds from mounting it:

| | before | after |
|---|---|---|
| frames rendered | 89 (~15fps) | 349 (~58fps) |
| worst frame | 201ms | 43ms |
| p95 frame | 97ms | 21ms |
| typing in the capture box (30 frames) | 1742ms | 488ms |

An edit typed inside the autosave debounce, then quit:

| | before | after |
|---|---|---|
| window close (X) | lost | survives |
| `app.quit()` (Ctrl+Q / menu) | lost | survives |

## Two things worth knowing about §4

**The layout was unstable, and nobody could see it.** `REPULSION / distSq` has
a singularity: a close pair got an impulse in the thousands, and at
`DAMPING` 0.86 a node carries a kick about seven times as far as the kick. The
layout sprawled to ~98,000px wide. It had never shown up because the
simulation was too slow at those sizes to reach `MAX_TICKS` — it was always
being looked at mid-expansion. Making it fast is what exposed it. Clamping the
denominator and capping per-tick speed fixed it; the graph now settles inside
its panel at both 400 and 1500 pages.

**Home's graph panel is honest now, and small.** 400+ nodes framed inside a
441×210 panel is a dense disc of dots — correct, fitted, 60fps, hubs labelled
and everything else named on hover. Whether that panel should instead show a
*subset* (the connected core, say, with "open the full graph" beside it) is a
design call about what Home is for, not a defect, so I have left it. It is the
one thing in this scan I would still change.

## Left open deliberately

- **Restoring the last view and open page on relaunch.** Flagged in §8, not
  done: the Home branch's own reasoning is that "Nexus opens here" is the
  point of the screen, and quietly reopening somewhere else would undo that.
  Restoring only the open *page* within Notes would not conflict — worth a
  decision rather than a guess.
- **Keyboard coverage** beyond ⌘K/⌘N (§8). Still two shortcuts.
- **List virtualization** (§8). 1500 rows mount in ~1.5s and scroll fine; a
  watch-item, not a bug.
