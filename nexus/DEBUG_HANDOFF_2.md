# Nexus — Lasso + Columns Debug Handoff (round 2)

Context transfer after commits `7d1623f` and `b260c67` on
`claude/debug-lasso-columns-A7GxJ`. Two previous handoff rounds landed
partial fixes; these problems still persist and need a fresh eye.

---

## Project

- **Repo**: `tsharpe22/nexus` (GitHub: https://github.com/TSharpe22/NEXUS)
- **Active branch**: `claude/debug-lasso-columns-A7GxJ`
- **Stack**: Electron + Vite + React, Notion-style local-first notes
- **Editor**: BlockNote 0.24 (`@blocknote/core`, `@blocknote/react`,
  `@blocknote/mantine`, `@blocknote/xl-multi-column`)
- **State**: Zustand (`src/renderer/stores/app-store.ts`)
- **Styles**: Tailwind + CSS custom properties in
  `src/renderer/styles/globals.css`
- **Local dev path**: `/home/sharpe/nexus/nexus`
- **Run**: `cd /home/sharpe/nexus/nexus && npm run dev`

---

## What has been shipped so far on this branch

### `3681157` — first pass
- Rewrote `.nx-block-selected` as a full-width overlay with left rail.
- Moved lasso rect from Zustand to local `useState` (stops 60 Hz editor
  re-renders).
- Relaxed lasso start guard.
- Diff-based selection-class updates in `Editor.tsx`, skipping headings.
- Deselect-before-remove in delete handler.
- Clamp lasso rect to editor viewport bounds.

### `24814cb` — second pass
- Replaced dead `[data-content-type="column*"]` CSS with real
  `.bn-block-column` / `.bn-block-column-list` selectors.
- `preventDefault()` on mousedown + `body.nx-lassoing` class with
  `user-select: none !important`.
- Suppressed nested-block indent guide `::before`.

### `7d1623f` — third pass (this round)
- **ColumnResizeHandles.tsx**: replaced dead `isColumnContainer()` with a
  real-DOM walk of `.bn-block-column-list > .bn-block-column`. Added
  `getColumnId()` fallback for uncertain `data-id` placement. Forces
  inline flex on the column-list.
- **globals.css (columns)**: broadened indent-guide + margin-left
  suppression to both `.bn-block-column*` and `[data-node-type=
  "column"|"columnList"]`; stripped `border-left`/`padding-left`; added
  a last-resort `display: flex !important` on the column-list.
- **globals.css (lasso)**: `body.nx-lassoing .nx-page-title::selection {
  background: transparent !important }` so the textarea's native
  selection paints transparent.
- **LassoSelect.tsx**: blur active element + clear selection ranges on
  mousedown before `preventDefault()`.

### `b260c67` — fourth pass (this round)
- **LassoSelect.tsx**: added `.bn-side-menu`, `[data-test-id=
  "dragHandle"]`, `[draggable="true"]` to the mousedown guard so clicks
  on BlockNote's six-dots drag handle and `+` button no longer start
  a lasso.
- **Editor.tsx**: walk up from `.bn-block[data-id]` to `.bn-block-outer`
  via `.closest()` before toggling `.nx-block-selected` (BlockNote
  places `data-id` on the inner `.bn-block`, so the class was landing
  on the wrong element where descendant backgrounds hid the fill).
- **globals.css**: bumped `.nx-block-selected` specificity, opacity
  (0.14 / 0.18), and rail width (3px) with `!important`.

---

## ✅ Confirmed working now

- Page title `<textarea>` no longer gets blue-highlighted when the
  lasso drags over it (`L1` — fixed by `::selection { background:
  transparent !important }` during `body.nx-lassoing`).

---

## ❌ Problems still reported by the user

### 1. Selected blocks STILL don't visibly highlight

User says: "I want it to highlight selected blocks" — implying the
`.nx-block-selected` class either isn't being applied, or the CSS
still isn't painting anything visible after `b260c67`.

Current flow:
- `LassoSelect.tsx` → `selectBlocks(ids)` updates Zustand state.
- `Editor.tsx` effect runs (deps: `[selectedBlockIds]`):
  - Looks up `[data-node-type="blockContainer"][data-id="<id>"]`
    (this is `.bn-block`).
  - Calls `.closest('.bn-block-outer')` and applies
    `.nx-block-selected` to that outer.
- `globals.css`:
  - `.bn-block-outer.nx-block-selected { background-color: rgba(165,
    123, 255, 0.14) !important; ... }`
  - `.nx-block-selected::before { ... background: rgba(...0.18);
    border-left: 3px solid var(--nx-accent); ... }`

Possible remaining causes:
1. **The class is never applied.** The inner `.bn-block[data-id]`
   query returns nothing. Either (a) the block IDs `selectBlocks()`
   writes don't match any `data-id` in the DOM, or (b) the Zustand
   state isn't updating. Add a `console.log` inside the effect to
   verify `nextSelected` and whether `findOuter(id)` returns an element.
2. **Class IS applied, CSS doesn't render.** BlockNote may set an
   opaque background or `overflow: hidden` on `.bn-block-outer` that
   clips/hides our overlay. Or `--nx-accent` is undefined (check the
   CSS variables defined near the top of `globals.css`).
3. **`.bn-block-outer` is `display: contents`.** Elements with
   `display: contents` don't paint backgrounds. Verify via DevTools.
4. **Selection state is being wiped immediately.** Something else
   (e.g., `deselectAllBlocks()` on a page-change effect, or a stray
   click handler) may be clearing `selectedBlockIds` right after the
   lasso commits.

First diagnostic step: open DevTools while dragging a lasso, watch
the Elements panel for `.bn-block-outer` to receive the
`nx-block-selected` class, and check the computed styles panel for
that element to see whether `background-color` is actually applied.

### 2. Columns — untested / likely still broken

The user said they "can't grab blocks to test the column feature."
That side-menu guard is now in place (commit `b260c67`), so they
should be able to drag a block onto another to form columns. As of
this handoff, **the column feature has not been tested post-fix**.

Prior reported column symptoms (may or may not still exist):
- C1. Column 2 looks nested / indented under column 1.
- C2. No drag-to-resize handles appear between columns.
- C3. Column 2 vertically staggered below column 1.
- C4. Vertical indent line at the start of column 2.

If any persist after `7d1623f`'s fixes, the most likely cause is that
BlockNote 0.24's actual column DOM differs from what the first
handoff claimed. Worth verifying in DevTools:
- Does `.bn-block-column-list` exist?
- Are `.bn-block-column` elements its DIRECT children, or nested
  inside a `.bn-block` / `.bn-block-content` wrapper?
- Where does `data-id` live on each column?
- What does BlockNote apply `border-left` / `::before` to, exactly?
  (Inspect each ancestor of column 2's first block.)

---

## Key files (all paths relative to `/home/sharpe/nexus/nexus`)

```
src/renderer/components/LassoSelect.tsx         — full lasso implementation
src/renderer/components/ColumnResizeHandles.tsx — draggable column dividers
src/renderer/components/Editor.tsx              — BlockNote mount + selection class effect (~line 378–409) + keyboard handlers (~line 411–495)
src/renderer/stores/app-store.ts                — selectedBlockIds, isLassoActive, selectBlocks, deselectAllBlocks
src/renderer/styles/globals.css                 — column rules (~line 295–345), lasso + selection rules (~line 1080–1140)
src/renderer/blocks/schema.ts                   — nexusSchema = withMultiColumn(...)
```

---

## Current state of `Editor.tsx` selection effect

```ts
const findOuter = (id: string): Element | null => {
  const inner = container.querySelector(
    `[data-node-type="blockContainer"][data-id="${CSS.escape(id)}"]`,
  )
  if (!inner) return null
  return inner.closest('.bn-block-outer') ?? inner
}

for (const id of prevSelected) {
  if (nextSelected.has(id)) continue
  findOuter(id)?.classList.remove('nx-block-selected')
}

for (const id of nextSelected) {
  if (prevSelected.has(id)) continue
  const el = findOuter(id)
  if (!el) continue
  const isHeading = el.querySelector(
    '.bn-block-content[data-content-type="heading"]',
  )
  if (isHeading) continue
  el.classList.add('nx-block-selected')
}
```

## Current state of `.nx-block-selected` CSS

```css
.bn-editor .bn-block-outer.nx-block-selected,
.bn-block-outer.nx-block-selected,
[data-node-type="blockContainer"].nx-block-selected,
.nx-block-selected {
  position: relative !important;
  background-color: rgba(165, 123, 255, 0.14) !important;
  border-radius: var(--nx-radius-sm);
}

.nx-block-selected::before {
  content: '' !important;
  position: absolute !important;
  left: -8px;
  right: -8px;
  top: 0;
  bottom: 0;
  background: rgba(165, 123, 255, 0.18);
  border-left: 3px solid var(--nx-accent);
  border-radius: var(--nx-radius-sm);
  pointer-events: none;
  z-index: 0;
}

.nx-block-selected > * {
  position: relative;
  z-index: 1;
}
```

## Current state of `LassoSelect.tsx` mousedown guard

```ts
if (
  target.isContentEditable ||
  target.closest('[contenteditable="true"]') ||
  target.tagName === 'INPUT' ||
  target.tagName === 'TEXTAREA' ||
  target.tagName === 'BUTTON' ||
  target.tagName === 'A' ||
  target.tagName === 'SELECT' ||
  target.closest('[role="menu"]') ||
  target.closest('.nx-col-resize-handle') ||
  target.closest('.bn-side-menu') ||
  target.closest('[data-test-id="dragHandle"]') ||
  target.closest('[draggable="true"]')
) {
  return
}
```

---

## Suggested first debugging moves for the next model

1. **Stop speculating about DOM shape — capture it.** Ask the user to
   open DevTools, right-click a block in the editor, "Inspect", then
   paste the outerHTML of the 2–3 ancestors. Same for a column-list.
   Everything else is blind guessing until this is known with
   certainty.
2. **Add temporary instrumentation** in the `Editor.tsx` selection
   effect:
   ```ts
   console.log('selection effect', { nextSelected: [...nextSelected], found: [...nextSelected].map(id => ({ id, outer: findOuter(id) })) })
   ```
   Ask the user to lasso a few blocks and paste the console output.
3. **Verify `--nx-accent`** is defined and not empty — grep for it
   in `globals.css`.
4. **Test column reflow specifically**: ask user to (a) drag one
   block onto another to form columns, (b) check column-list DOM in
   DevTools, (c) report whether `.bn-block-column-list` exists and
   whether `.bn-block-column` elements are its direct children.
5. **Don't add more `!important` layers** without evidence that the
   class is actually being applied — that path has been exhausted.

---

## Approved UX decisions (still in force)

- Selected block visual: full-width accent fill + left rail (purple).
- Lasso starts anywhere except live text, interactive controls, and
  BlockNote's side menu / drag handle / `+` button.

---

## How to get the code

```bash
cd /home/sharpe/nexus/nexus
git fetch origin claude/debug-lasso-columns-A7GxJ
git checkout claude/debug-lasso-columns-A7GxJ
git pull origin claude/debug-lasso-columns-A7GxJ
npm run dev
```
