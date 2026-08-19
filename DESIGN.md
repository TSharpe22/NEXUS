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
| warning | `#c9a26b` *(NEXUS only — see below)* | pending, needs attention |
| critical | `#d9604f` | error, failed, destructive |

**Per-project brand accent** — each project gets its own accent, used for its logotype, primary nav highlight, and primary progress/emphasis. Distinct from the shared semantic tokens above (a brand accent can visually double as `warning`/`success` within its own app, as NEXUS's amber does, but never redefine `critical`).

| Project | Accent | Value | Reads as |
|---|---|---|---|
| NEXUS | Amber | `#c9a26b` | warm instrument panel, calm attention |
| Kairos | Signal blue | `#3f8ce8` | live/active market, analytical — its own hue, not the shared `info` blue |
| *(next project)* | — | — | pick per formula below |

**Accent formula for new projects:** `oklch(65–72% 0.08–0.12 <hue>)`. Keep lightness and chroma in that band so every project's accent feels like the same family at a glance; vary only hue, at least ~40° away from hues already in use (amber ≈ 70°, signal blue ≈ 230°).

## Spacing & radius

Scale: **4, 8, 12, 16, 24, 32** px. 12 = dense panel padding, 16 = roomy panel padding, 24 = section gap, 32 = page margin.

Radius: **2px** on chips/inputs, **3px** on panels/cards. Never above 4px.

Borders are always 1px hairlines. No shadows, no elevation — panels separate by border + fill only.

## Iconography

Simple geometric forms only (square, circle, diamond) — no illustrative icon sets.

- **1.5px outline stroke** as the default.
- **Filled** reserved for the single "selected/active" state (current nav item, current node) — never for anything else.
- **Callout markers** get distinction from shape × colour rather than from an icon set: three shapes across the four semantic colours is twelve legible variants, which is what an icon picker would have bought. Outline, like everything else — the marker is not a selected state.

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
