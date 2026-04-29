# Nexus test fixtures

Two fixtures, used together to exercise every feature in the editor without
the user having to author content from scratch.

## Files

- `chemistry.md` — markdown fixture. Imports as one page, auto-creates three
  stub pages from `[[wiki-link]]` references. Use this to test the markdown
  import path, page links, link sync, and backlinks.
- `chemistry.json` — JSON fixture. Single-page, every block type and inline
  style in BlockNote's wire format. Use this to test the JSON import path
  and to verify all block types render correctly.

## How to import

1. `cd nexus && npm install && npm run dev` (Electron app launches).
2. `Cmd+Shift+I` (or click **Import** in the sidebar).
3. Select **both** `chemistry.md` and `chemistry.json` in the file dialog
   (multi-select). They import in one batch and the first imported page
   becomes the active page.

After import you should see in the sidebar:

- `Chemistry` (from chemistry.md)
- `Chemistry — every block type` (from chemistry.json)
- `Acids and Bases` (auto-created stub from `[[Acids and Bases]]`)
- `Periodic Trends` (auto-created stub)
- `Lab Equipment` (auto-created stub)

## Manual QA checklist

Walk this list top-to-bottom. Any line that fails → note it and stop; we
triage in a follow-up. Don't try to fix mid-run.

### Pages and sidebar

- [ ] All five pages appear in the sidebar (3 stubs + 2 imported).
- [ ] `Cmd+N` creates a new untitled page that selects automatically.
- [ ] Double-click a sidebar item → inline rename input appears, focused.
      Type a new name, press Enter → renames. Press Escape → cancels.
- [ ] Right-click a sidebar item → context menu: Rename, Duplicate,
      Export as Markdown, Export as JSON, Delete.
- [ ] Duplicate a page → creates `<title> (copy)` and selects it.
- [ ] Click **Trash** at sidebar bottom → trash view opens with a count.
- [ ] In trash, hover an item → Restore and Delete buttons appear.
- [ ] Restore a page → it returns to the main list. Hard delete → it's gone.
- [ ] Drag the sidebar's right edge → resizes between 220px and 480px,
      persists on reload.
- [ ] `Cmd+\` toggles sidebar collapsed/expanded.
- [ ] Type in the sidebar search box → filters to matching titles.

### Command palette (`Cmd+K`)

- [ ] Opens with input focused. `Esc` closes.
- [ ] `Cmd+K` again toggles closed.
- [ ] Type "Chem" → both Chemistry pages match (fuzzy).
- [ ] Page rows show an **icon** (not the literal string `doc`).
      *(This was a real bug — `CommandPalette.tsx` was rendering `page.icon`
      as text instead of using the `<PageIcon>` component.)*
- [ ] Action: New Page — creates and opens.
- [ ] Action: Toggle Sidebar — toggles.
- [ ] Action: Go to Trash — opens trash view.
- [ ] Action: Export Current Page — opens save dialog, writes a .md file.
- [ ] Action: Import — opens import dialog.
- [ ] Action: Export All Pages — opens folder picker, writes one .md per page.

### Editor — title

- [ ] Title textarea grows as you type multiple lines.
- [ ] Status bar shows "Saving…" then "Saved" with a checkmark on edit.

### Editor — block types (open the chemistry.json page)

For each block, verify it renders as expected:

- [ ] H1 "Chemistry — every block type" at the top.
- [ ] Paragraph with **bold**, *italic*, <u>underline</u>, ~~strike~~,
      `code`, purple text, and yellow highlight all visibly distinct.
- [ ] Bullet list (3 subatomic particles).
- [ ] Numbered list (3 lab steps, auto-numbered 1/2/3).
- [ ] Check list (one checked, one unchecked, both togglable).
- [ ] Code block with Python syntax highlighting.
- [ ] Quote block with vertical rule and italic Marie Curie attribution.
- [ ] **Callout** (red, warning icon) — H₂SO₄ safety note. Click the icon
      → icon picker opens. Pick a different icon → updates inline.
- [ ] **Callout** (blue, bulb icon) — OIL RIG mnemonic. The "OIL RIG" inside
      should be bold.
- [ ] **Toggle** — "Detailed pH derivation" with chevron. Click chevron →
      collapses children. Click again → expands. Reload page → toggle is
      back open (toggle state is intentionally ephemeral).
- [ ] **Table** — 4 columns × 4 rows, header row bold, cell editing works.
- [ ] **Two-column layout** (Reactants / Products). Drag the divider
      between them → columns resize live. *(Column resize uses BlockNote's
      flex-grow; if columns look misaligned this is the deferred bug from
      `DEBUG_HANDOFF_2.md` — column 2 nested/indented under column 1.)*

### Editor — slash menu

In any paragraph, type `/`:

- [ ] Menu opens with grouped sections: Headings, Basic blocks, Lists,
      Advanced.
- [ ] **No** entries for File, Image, Video, Audio, Emoji (intentionally
      dropped — see `slash-items.ts:17`).
- [ ] Toggle and Callout appear under "Advanced".
- [ ] Type `/cal` → narrows to Callout. Press Enter → inserts a callout.
- [ ] Type `/h1` → narrows to Heading 1. Click → converts.

### Editor — formatting toolbar

Select some text with the mouse:

- [ ] Floating toolbar appears above selection.
- [ ] **Bold (`Cmd+B`)**, **Italic (`Cmd+I`)**, **Underline (`Cmd+U`)**,
      Strikethrough, Inline code — each toggles correctly.
- [ ] Highlight button → opens color popover. Pick a color → applies.
      Pick same color again → keeps it (active swatch). Click "Clear" →
      removes highlight.
- [ ] `Cmd+Shift+H` → toggles yellow highlight without opening popover.
- [ ] Text color → same flow as highlight, separate state.
- [ ] **External link** button → native prompt for URL. Type `https://example.com`.
      Verify the selection becomes a clickable link.
      *(Sloppy: uses `window.prompt`. Real bug if the URL has no protocol —
      it gets stored as relative and treated like a nexus:// link on click.
      Deferred — see `DEBUG_FINDINGS.md`.)*
- [ ] **Page link** button → search popover. Type "Acid" → "Acids and Bases"
      appears. Click → selection becomes a clickable nexus:// link.

### Editor — `[[` page-mention chip

- [ ] In a paragraph, type `[[`. Suggestion menu opens with all pages.
- [ ] Type `Lab` → narrows to "Lab Equipment".
- [ ] Click "Lab Equipment" → inserts a chip with icon + title.
- [ ] Click the chip → navigates to Lab Equipment.
- [ ] Type `[[NewPageName]]` → "Create new page: NewPageName" appears.
      Click → creates page + chip in one action.
- [ ] Soft-delete the linked page → chip becomes strikethrough.
- [ ] Hard-delete the linked page → chip becomes plain (non-clickable) text.

### Editor — block selection (lasso confirmed working)

- [ ] Click-drag in margin (outside text) → translucent lasso rect.
- [ ] Lasso over 3 paragraphs → all three highlight (purple overlay).
- [ ] **Headings do NOT highlight** during lasso (intentional).
- [ ] `Esc` → clears selection.
- [ ] With selection: `Backspace` → deletes selected blocks.
- [ ] With selection: `Cmd+C` → copies plaintext join of those blocks.
- [ ] With selection: `Cmd+X` → copies + deletes (no neighboring block
      should briefly inherit the highlight before disappearing).
      *(This was a real bug — Cmd+X removed before deselect; fixed.)*
- [ ] With selection: `Cmd+D` → duplicates each selected block in place.
- [ ] `Cmd+A` (focus outside text) → selects every non-heading block.

### Editor — block right-click menu

Right-click any block:

- [ ] Menu shows: Delete, Duplicate, Copy, Cut, Copy link to page,
      Move Up, Move Down.
- [ ] Transform-to: paragraph, h1/h2/h3, bullet/numbered/check, code,
      callout, toggle.
- [ ] Active type is highlighted.
- [ ] On a callout: extra "Color" submenu with swatches.

### Editor — keyboard shortcuts

- [ ] `Cmd+D` (cursor in a block) — duplicates that block.
- [ ] `Cmd+Shift+Backspace` (cursor in a block) — deletes that block.
- [ ] `Cmd+Shift+T` (cursor in a toggle) — collapses/expands it.

### Editor — page width slider

- [ ] Top-right of editor: width icon. Click → slider popover.
- [ ] Drag → width changes live (no stutter).
- [ ] Click "Full" → width becomes "Full" (calc(100% - 48px)).
- [ ] Reload page → width persists.

### Backlinks

Open the `Acids and Bases` stub page (created by chemistry.md import):

- [ ] At the bottom: "Backlinks (1)" with a chevron.
- [ ] Click chevron → expands. Shows `Chemistry` with surrounding context.
- [ ] Click the row → navigates to Chemistry, scrolling to the link area.
- [ ] Expansion state persists when navigating between pages.

### Import / Export

- [ ] Imported `chemistry.md` produced a page titled "Chemistry"
      (from the H1) with all sections.
- [ ] Three stub pages were auto-created from `[[...]]` references.
- [ ] On the Chemistry page (the .md one), the table appears as plain
      paragraph rows of `| col | col |` text — *known md→block lossiness*.
- [ ] Inline `**bold**` / `*italic*` in the imported markdown appears as
      literal text — *known md→block lossiness*.
- [ ] Export `Cmd+Shift+E` from the chemistry.json page → check resulting
      .md file. Callouts export as `> **icon** text` (lossy), toggle as
      `<details><summary>...`, table as plain text rows. Reimporting that
      file does **not** round-trip cleanly. *(Documented; deferred.)*

### Drag-and-drop import

- [ ] Drag a `.md`, `.txt`, or `.json` file onto the sidebar → imports.
- [ ] Drag a non-supported file (e.g. `.pdf`) → silently ignored.
      *(Sloppy: no toast, no drop-zone visual. Deferred.)*

### Status bar

- [ ] On any page: shows "NOTE" lower-left.
- [ ] Edit a block → "Saving…" with animated dot.
- [ ] After 1.2s → "Saved" with checkmark, fades after 2s.

---

## Known issues (deferred — do not test, do not fix this round)

These are documented for awareness; reports against them won't surprise us.

1. **Markdown round-trip lossiness.** Callouts, toggle children, inline
   styles, tables, columns do not round-trip through `.md` export/import.
   `md-convert.ts` needs a structural rewrite before round-trip is honest.
2. **Block clipboard format.** `Cmd+C` / `Cmd+X` of multi-block selection
   write only plaintext to the clipboard. Pasting back into the editor
   gives raw text, not blocks.
3. **`created_at` timestamp.** `database.ts:saveBlocks` deletes + reinserts
   every block on each save. If `block.created_at` is empty (the runtime
   path), it gets the current timestamp — so created_at == updated_at on
   every save. Schema-level concern; not user-visible today.
4. **`duplicatePage` skips `page_width`.** Duplicated pages always start
   at default width regardless of source.
5. **Renderer chunk size.** The main JS bundle is 2.6 MB because Shiki's
   syntax highlighter eagerly imports every supported language inside the
   BlockNote code block. Real perf concern; needs lazy-loading.
6. **External link URL validation.** Formatting toolbar's link button
   accepts any string from `window.prompt` — no protocol check, no native
   modal. Bare `google.com` becomes a relative link.
7. **`postcss.config.js` typeless warning** at build time. Cosmetic; would
   need `"type": "module"` in `package.json` which is risky in an Electron
   project.
8. **Columns layout.** Column 2 nesting/indent visual bugs from
   `DEBUG_HANDOFF_2.md` are still untested in this round per user
   instruction. Test the JSON fixture's two-column block and report what
   actually happens.
