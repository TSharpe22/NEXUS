# STABILIZE — a period of fixing, not adding

> Written 2026-10-10. **A consideration list, not a plan.** Nothing here is
> committed to, ordered for certain, or scheduled. It records a decision about
> *posture*, and a set of candidates to pick from while that posture holds.
>
> Read with `ROADMAP.md` and `PHASES.md`. Neither is cancelled; both are paused.

---

## The decision

**Stop shipping new capability. Tie up loose ends, fix bugs, secure the app,
and recentre.**

Nexus has outrun its own use: the field test found more features than the
vault has data (18 pages, no tags, one link). Each wave since the MVP added a
door; this period is for walking through the ones that exist and fixing what
is found there.

### The test for any change in this period

*Does this make something that already exists correct, safe, or pleasant to
use?* If it adds a capability, a schema version, or a new screen, it waits.

- **In:** bug fixes, wrong or confusing output, security hardening, dependency
  hygiene, performance on existing paths, polish of existing screens, tests
  that pin existing behaviour.
- **Out:** Phase 1 and every later phase, aggregates, rollups, multi-value
  references, the trading view, new widgets, multi-block selection.

### When it ends

Not by date. Candidates for an exit signal:
- The vault is in real daily use for a stretch, and the bugs that use surfaces
  stop arriving.
- The security items below are settled one way or the other.
- One working copy, one install, verified.

---

## Candidates — loose ends and bugs

Each is something that already exists and is wrong. Severity is a guess.

| Candidate | Where | Notes |
|---|---|---|
| Collapse to one working copy and one install | machine, not repo | `ROADMAP.md` "One-vault hygiene". Prerequisite for Phase 1 whenever it comes; cheap now. |
| Board grouped by a reference shows UUIDs | `ViewLayouts.propertyText` | Field test #3. Correct resolution already in `mirror.ts`. Wrong output, not a feature. |
| Ad-hoc properties stored but invisible | `PropertiesPanel` | Field test #5. Arguably a fix: the vault file shows a value the app cannot. Borderline — decide whether it counts. |
| Mirror frontmatter quotes numbers; `multi_select` written as escaped JSON | `mirror.ts` `renderPage` | Field test #7. Inconsistent with `tags` on the same page. |
| Tracker header reads `0 open · 0 done` beside twenty dated items | `Tracker.tsx` | Counter counts checkbox tasks only. Relabel or recount. |
| Folding a toggle counts as an edit | autosave / `block.props.open` | Bumps `updated_at`; reading becomes writing. `ROADMAP.md` wave 1c. |
| Relation set twice silently overwrites | properties | Field test Evidence 1. The *fix* in this period is to make it not silent (warn or show), not to make it multi-valued — that is Phase 2. |
| Saved filters hold vault-local UUIDs | `repo.compileFilter` | Field test #4. A change of shape rather than a bug — include only if done before more views exist. Otherwise leave. |

---

## Candidates — security

Nexus is local and single-user, but it renders pasted and imported content
and runs with Node available to the preload. Found by reading `main` at
`d460fe0`; none verified as exploitable.

| Candidate | Where | Notes |
|---|---|---|
| `shell.openExternal` on any URL | `index.ts` `setWindowOpenHandler` | No scheme check. A link in a note or an imported page could hand `file:`, `smb:` or an app-registered scheme to the OS. Allowlist `http`, `https`, `mailto`. |
| No navigation guard | `index.ts` | No `will-navigate` handler; the main window could be navigated away from the app. Deny all navigation that is not the app itself. |
| `shell:openPath` takes any path from the renderer | `ipc.ts` | Restrict to the paths it exists for (data dir, backups, mirror folder). |
| `sandbox: false` | `index.ts` `webPreferences` | `contextIsolation` is on and `nodeIntegration` off, which is the important pair. Check whether the preload needs Node; if not, turn the sandbox on. |
| `prosemirror-view` paste XSS (high) | dependency | `npm audit`: GHSA-c8x8-7fp4-3x9w. Arrives through BlockNote/Tiptap, which are pinned on purpose (`@tiptap/*` 2.11.5). Check whether an `overrides` entry can lift `prosemirror-view` alone without moving BlockNote — and run `probes/blocks.mjs` after. |
| 26 moderate advisories | dependencies | Mostly dev/build chain (`electron-builder`, `@electron/rebuild`) plus `markdown-it`, `uuid`, `@tiptap/core`. Triage: runtime first, build chain second, ignore what cannot reach the packaged app. |
| Electron `^33` | `package.json` | Likely past its support window by now. Check the current supported line; upgrading is a fix here, not a feature — but it is the riskiest item on this page, so it goes last and on its own. |
| CSP | `renderer/index.html` | Already strict (`script-src 'self'`). `style-src 'unsafe-inline'` is the one loosening; leave unless it is free to remove. |
| Attachment protocol | `index.ts` `protocol.handle` | Confirm a name with `../` cannot escape `data/files`. `ipc.ts` comments suggest it is handled — verify with a test rather than a reading. |

---

## Candidates — polish

Smaller, and only from use: keep a running note in the vault of anything that
annoys, and pull from it here. Seed list:

- Board and gallery cards show the first three properties, which may not be
  the ones that matter. (Making them *selectable* is a feature — out. Choosing
  a better default is polish — in.)
- Empty states and error states against `DESIGN.md`.
- Anything in `QA_SCAN.md` still open.

---

## Parked, not dropped

Considered on 2026-10-10 and deliberately left for after this period:

- **Aggregates in views (Phase 5a).** The field test's largest gap. No schema,
  so it could jump the queue like Views did — but it is new capability.
- **Phase 1** and everything after it in `PHASES.md`.
- **The trading view.** `TRADING.md` already says it waits for `trading.db`
  to have data. Work on `trading.db` itself lives outside this repo and is not
  governed by this note.
- **Model change to weigh:** Trade and Prop Account as Nexus types are
  superseded by `trading.db` under `TRADING.md`; Daily Log, Lift Benchmark and
  Weekly Review still fit as ordinary Nexus types.
