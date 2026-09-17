# Design System — NEXUS / Kairos / future projects

Tactical, retro-futurist, terminal-derived. Dark only. Restrained, functional, no decoration for its own sake.

## Typography

- **UI chrome, data, labels:** IBM Plex Mono. Fallback: `"IBM Plex Mono", "SFMono-Regular", Consolas, monospace`.
- **Headings, body, nav:** Chakra Petch. Fallback: `"Chakra Petch", -apple-system, "Segoe UI", sans-serif`.
- Never more than these two families in one screen.

**Scale:**

| Role | Size / weight | Font |
|---|---|---|
| Display | 28 / 600 | Chakra Petch |
| Heading | 20 / 600 | Chakra Petch |
| Panel title | 15 / 600 | Chakra Petch |
| Body | 13 / 400 | Chakra Petch |
| Section label | 10.5 / 600, uppercase, +0.04em | IBM Plex Mono |
| Data / mono values | 11 / 400 | IBM Plex Mono |

## Color

Shared dark neutral base across all projects:

| Token | Value | Use |
|---|---|---|
| bg | `#121316` | app background |
| panel | `#0e0f12` | cards, panels |
| border | `#262832` | hairline borders |
| border-2 | `#2c2e38` | graph edges, subtler lines |
| text | `#e3e4ea` | primary text |
| text-dim | `#6b6d78` | secondary/meta text |
| table-head | `#0a0b0d` | table header row bg |
| row-line | `#1c1e24` | table row dividers |

**Semantic status (shared across all projects):**

| Token | Value | Meaning |
|---|---|---|
| success | `#7fae7a` | active, synced, healthy |
| info | `#7ea3c9` | neutral system messages |
| warning | `#cfa262` *(NEXUS only)* | pending, needs attention |
| critical | `#d9604f` | error, failed, destructive |

**Per-project brand accent** — each project gets its own accent, used for its logotype, primary nav highlight, and primary progress/emphasis. Distinct from the shared semantic tokens above (a brand accent sits close to `success` when it is green, as NEXUS's emerald does — hold them apart on lightness — but never redefine `critical`).

| Project | Accent | Value | Reads as |
|---|---|---|---|
| NEXUS | Emerald | `#69b48a` | cool instrument glass, live and steady |
| Kairos | Signal blue | `#3f8ce8` | live/active market, analytical — its own hue, not the shared `info` blue |
| *(next project)* | — | — | pick per formula below |

**Accent formula for new projects:** `oklch(65–72% 0.08–0.12 <hue>)`. Keep lightness and chroma in that band so every project's accent feels like the same family at a glance; vary only hue, at least ~40° away from hues already in use (emerald ≈ 158°, signal blue ≈ 230°).

## Spacing & radius

Scale: **4, 8, 12, 16, 24, 32** px. 12 = dense panel padding, 16 = roomy panel padding, 24 = section gap, 32 = page margin.

Radius: **2px** on chips/inputs, **3px** on panels/cards. Never above 4px.

Borders are always 1px hairlines. No shadows, no elevation — panels separate by border + fill only.

## Iconography

Two sets, on one grid, at one stroke weight. Nothing else.

**State marks** — square, circle, diamond (`Icon.tsx`). These carry meaning the *app* assigned: which nav item is current, which node is selected, how severe a callout is.

- **1.5px outline stroke** as the default.
- **Filled** reserved for the single "selected/active" state (current nav item, current node) — never for anything else.
- **Callout markers** get distinction from shape × colour rather than from an icon set: three shapes across the four semantic colours is twelve legible variants, which is what an icon picker would have bought. Outline, like everything else — the marker is not a selected state.

**Label glyphs** — the named set in `Glyph.tsx`. These carry meaning the *user* assigned: the mark on a page, a type, a saved view. A closed vocabulary of ~50, drawn on a 16×16 box inside 1.5–14.5, 1.5px stroke, round caps and joins.

- **`currentColor`, always.** A glyph takes the colour of whatever it sits in — dim in a meta row, accent in a selected one — so it belongs to the row rather than sitting on top of it. Never given a colour of its own.
- **Never filled.** Filled still means selected, and a label is not a state.
- **Closed set, not an icon library.** A fixed vocabulary is what makes fifty marks read as one system; a search box over ten thousand is what makes them read as fifty exceptions.
- **No emoji anywhere in the product surface.** They are another vendor's colour artwork at another vendor's metrics — three colour families and a different picture on every machine, in a shell built from two greys and one emerald.

Both sets are `aria-hidden`: a glyph is redundant with the text beside it, and the two things that have no text beside them (state marks) are conveyed by the row's own styling too.

## Motion

Near-instant. Transitions ~80–120ms, linear or ease-out. No bounce, no springy easing — states change, they don't animate in.

## Interactive states

- **Nav item:** default (dim text, no bg) → hover (faint bg lift) → selected (accent-tinted bg + 2px accent left border + accent text) → focus (1.5px accent outline, inset).
- **Table row:** default → hover (bg lift) → selected (accent-tinted bg + 2px accent left border).
- **Button:** default (solid accent, dark text) → hover (lighter accent) → pressed (darker accent) → disabled (flat neutral grey, muted text, no accent).

## Empty & error states

- **Empty:** centered, single outline icon (dim, not accent-colored), one line of primary text, one line of mono meta text. No illustration, no call-to-action unless one is truly needed.
- **Error:** left-aligned, filled critical-colored icon + bold label, one line of dim explanatory text, a bordered "retry" chip in the critical color. Panel border switches to a critical-tinted hairline.

## Open items

- Long-text truncation/overflow rules not yet specified for table cells, directive lists.
- No responsive/mobile breakpoints defined (desktop-first assumed).
- Contrast of brand accents only validated at label/decorative sizes — do not use accent color for body-length text.
