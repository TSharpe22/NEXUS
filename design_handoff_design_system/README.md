# Handoff: NEXUS / Kairos Design System

## Overview
A shared visual design system for a family of personal tools: **NEXUS** (a personal knowledge base / file system, Notion+Anytype+Obsidian-style, eventually AI-integrated), **Kairos** (a trading backtesting engine / brand), and future projects in engineering, martial arts, and security. The system defines one shared dark visual language — typography, color, spacing, icon style, motion, states — with each project getting its own brand accent color on top of shared neutrals.

## About the Design Files
The files in this bundle are **design references created in HTML** — mockups showing intended look, type, color, spacing, and state behavior. They are not production code. The task is to **recreate this system in the target codebase's actual environment** (React, SwiftUI, Electron, whatever NEXUS/Kairos are actually built in) using that environment's own component patterns — not to copy the HTML markup directly. If no frontend framework is chosen yet, pick whatever's appropriate for the project and implement the tokens/components there.

## Fidelity
**High-fidelity.** Colors, type sizes/weights, spacing, radius, and state styling below are final decisions, not placeholders. Copy (labels, sample data) in the mockups is illustrative filler standing in for real app content — not final UI copy.

## Design Tokens

### Typography
- UI chrome / data / labels: **IBM Plex Mono**. Fallback: `"IBM Plex Mono", "SFMono-Regular", Consolas, monospace`.
- Headings / body / nav: **Chakra Petch**. Fallback: `"Chakra Petch", -apple-system, "Segoe UI", sans-serif`.
- Only these two families anywhere in the system.

| Role | Size / weight | Font |
|---|---|---|
| Display | 28 / 600 | Chakra Petch |
| Heading | 20 / 600 | Chakra Petch |
| Panel title | 15 / 600 | Chakra Petch |
| Body | 13 / 400 | Chakra Petch |
| Section label | 10.5 / 600, uppercase, +0.04em letter-spacing | IBM Plex Mono |
| Data / mono values | 11 / 400 | IBM Plex Mono |

### Color — shared neutrals
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

### Color — shared semantic status
| Token | Value | Meaning |
|---|---|---|
| success | `#7fae7a` | active, synced, healthy |
| info | `#7ea3c9` | neutral system messages (shared across all projects — not a brand color) |
| critical | `#d9604f` | error, failed, destructive |

### Color — per-project brand accent
Each project's accent is used for its logotype, primary nav highlight, and primary emphasis (progress bars, active markers). A project's accent can double as its own `warning`/attention color, but must never override the shared `critical` red.

| Project | Accent | Value |
|---|---|---|
| NEXUS | Amber | `#c9a26b` |
| Kairos | Signal blue | `#3f8ce8` (its own hue — deliberately distinct from the shared `info` blue above) |

**Formula for any new project's accent:** `oklch(65–72% 0.08–0.12 <hue>)`. Keep lightness/chroma in that band so every project's accent feels like the same family; vary only hue, at least ~40° from hues already in use (amber ≈ 70°, signal blue ≈ 230°).

### Spacing & radius
Scale: **4, 8, 12, 16, 24, 32** px. 12 = dense panel padding, 16 = roomy panel padding, 24 = section gap, 32 = page margin.
Radius: **2px** on chips/inputs, **3px** on panels/cards. Never above 4px.
Borders: always 1px hairline. No shadows, no elevation — panels separate by border + fill only.

### Iconography
Simple geometric forms only (square, circle, diamond) — no illustrative icon sets.
- **1.5px outline stroke** is the default treatment.
- **Filled** is reserved for the single "selected/active" state (current nav item, current node) — never elsewhere.

### Motion
Near-instant. Transitions ~80–120ms, linear or ease-out. No bounce or springy easing — states change, they don't animate in with flourish.

## Interactive states
- **Nav item:** default (dim text, no bg) → hover (faint bg lift) → selected (accent-tinted bg + 2px accent left border + accent text) → focus (1.5px accent outline, inset).
- **Table row:** default → hover (bg lift) → selected (accent-tinted bg + 2px accent left border).
- **Button:** default (solid accent bg, dark text) → hover (lighter accent) → pressed (darker accent) → disabled (flat neutral grey, muted text, no accent).

## Empty & error states
- **Empty:** centered, single outline icon (dim/neutral, not accent-colored), one bold line of primary text, one line of mono meta text below it. No illustration; no call-to-action unless genuinely needed.
- **Error:** left-aligned. Filled critical-colored diamond icon + bold label, one line of dim explanatory text below, a bordered "retry" chip in the critical color. Panel border switches to a critical-tinted hairline.

## Screens / Views referenced
- **NEXUS dashboard** (`references/01-nexus-dashboard.png`): sidebar nav + knowledge-graph panel + data table (name/tags/modified/status) + vault storage / command directives / flow panels.
- **Kairos panel** (`references/02-kairos-panel.png`): same shell, signal-blue accent, backtest progress example.
- **Interactive states** (`references/03-interactive-states.png`): nav item, table row, and button across default/hover/selected/pressed/disabled/focus.
- **Type scale** (`references/04-type-scale.png`).
- **Spacing & radius** (`references/05-spacing-radius.png`).
- **Iconography** (`references/06-iconography.png`): outline weight comparison + filled treatment.
- **Empty state** (`references/07-empty-state.png`).
- **Error state** (`references/08-error-state.png`).

## Assets
No external image assets — all visuals are CSS/SVG (simple shapes only: lines, circles, polygons). Fonts are Google Fonts (IBM Plex Mono, Chakra Petch), loaded via standard `<link>` — replace with your codebase's font-loading convention (self-hosted, next/font, etc.) as appropriate.

## Files
- `NEXUS Design System.md` — the full portable spec (same content as this README's Design Tokens section, meant to be pasted into other chats/projects).
- `references/` — screenshots of the locked mockups, for visual context alongside the token spec.
- The full interactive exploration (all considered/rejected options, with rationale) lives in `Type & Color Exploration.dc.html` in the main project, not included in this handoff — this bundle only contains the final, decided system.

## Open items (unresolved — flag to whoever implements this)
- Long-text truncation/overflow rules not yet specified for table cells or directive lists.
- No responsive/mobile breakpoints defined (desktop-first assumed).
- Brand accent contrast only validated at label/decorative sizes — do not use accent color for body-length text.
