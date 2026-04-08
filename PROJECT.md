# NEXUS — Project Guide

> This file is the authoritative reference for all Claude Code sessions and Claude conversations working on Nexus. Read it in full before writing any code, making any architectural decision, or proposing any feature implementation.

---

## What is Nexus

Nexus is a local-first, desktop personal knowledge management application — a full replacement for AnyType. It is designed for one user: a high-performance individual who needs a powerful second brain, structured data management, and a unified workspace. It is not a SaaS product. It is not designed for teams. It is a personal tool built to last.

The north star: everything AnyType does well, done better, with full ownership of the data and the codebase.

---

## Platform and Stack

**Target platform**: Desktop (Electron), with mobile planned for a later phase. Do not architect decisions that would make mobile impossible, but do not optimize for it yet.

**Data layer**: SQLite. All notes, objects, properties, and metadata live in a local SQLite database. No cloud sync in v1 — the architecture must not assume a network. Design the schema so sync could be added later without a rewrite.

**Frontend**: To be decided at project start. Prefer a framework that works well inside Electron with good component ecosystem (React is the default assumption unless decided otherwise).

**AI integration**: Dual-mode. Local AI (privacy-first, on-device) and API-based (Claude, etc.) — user chooses. This is the last feature built, so do not couple earlier features to any AI dependency.

---

## Core Architectural Decisions

These are settled. Do not reopen them without explicit instruction.

### 1. The atomic unit is a hybrid note-object

A note in Nexus is not purely a document (like Notion) and not purely a typed object (like AnyType). It is a **hybrid**:

- Every note has a body (block-based content) and a title. This is the base "Note" type.
- Any note can be **promoted** to a typed object by assigning it a Type (e.g. "Trade Log", "Book", "Training Session").
- A Type defines a schema: a set of named, typed properties (text, number, date, relation, select, etc.).
- The body is one field among many — it does not have special architectural status.
- This hybrid model means capture is frictionless (just write) and querying is powerful (typed objects are rows in structured tables).

**Why this matters**: Every data pipeline feature — Views, Filters, Queries, Calculations — depends on typed properties existing in the database. Build the type/property schema into the SQLite layer from day one.

### 2. SQLite schema design principles

- Notes and objects are rows in a `pages` table (or equivalent). Type is a foreign key to a `types` table.
- Properties are stored in a `properties` table with columns: `page_id`, `property_key`, `property_type`, `value_text`, `value_number`, `value_date`, `value_relation` (etc.). Sparse columns are fine — do not store a JSON blob for properties.
- Blocks (the body content) are stored in a `blocks` table: `page_id`, `block_id`, `block_type`, `content`, `order`, `parent_block_id`.
- Bidirectional links are stored in a `links` table: `source_page_id`, `target_page_id`, `context` (optional excerpt).
- Tags are a special property type — not a separate system.

### 3. Vault and Section model

- A **Vault** is an isolated SQLite database. Two vaults cannot link to each other by default. Cross-vault linking is a privileged, explicit action.
- A **Section** is a named subgraph within a vault — a logical partition, not a separate file. Sections can link freely to each other.
- The user's primary workspace is one vault. Multiple vaults are for genuinely separate contexts (e.g. personal vs a future company workspace).
- Implement Sections before Vaults. Vaults are a late-roadmap feature.

### 4. Block editing model

- Notion-style drag-and-drop blocks.
- Every block has a type: paragraph, heading 1/2/3, bullet, numbered list, toggle, code, image, file, embed, divider, callout, table.
- Slash command menu (`/`) to insert block types.
- Blocks are reorderable by drag handle.
- Do not implement a custom rich text engine from scratch — evaluate existing block editor libraries (BlockNote, Editor.js, TipTap) before writing one.

---

## Roadmap

Features are built sequentially. A feature is **polished and complete** before the next begins. Features listed side-by-side are small enough to build together in one phase.

Do not skip ahead. Do not partially implement a feature and move on.

```
Phase 01  Note Software                          ← foundation, hybrid model
Phase 02  Block-Based Editing    +  Markdown Editor
Phase 03  Import / Export        +  Bidirectional Links
Phase 04  Media Embedding        +  Web Apps / Tabs         ⚠ see flag below
Phase 05  Tabs and Split View
Phase 06  Dashboard              +  Themes and Aesthetics
Phase 07  Canvas (tldraw)
Phase 08  Workspace Layouts
          ── data pipeline ──────────────────────────────────
Phase 09  Data Management (tags + type schema)   ← pipeline starts here
Phase 10  Data Views
Phase 11  Data Filters / Queries
Phase 12  Data Calculations / Charts
          ── advanced features ────────────────────────────────
Phase 13  Node Graph             +  Notification System
Phase 14  Spaced Repetition                      ← depends on Phase 13
Phase 15  Sections and Vaults
Phase 16  Toggle Features        +  AI Integration
```

### Phase flags and notes

**Phase 01 — Note Software**: Implement the SQLite schema first. Types table, pages table, blocks table, links table, properties table. The schema is the foundation for everything. A basic create/read/edit/delete note UI is the deliverable — not a polished app yet.

**Phase 04 — Web Apps / Tabs (⚠ risk)**: Embedding arbitrary URLs in Electron requires a deliberate security decision. Evaluate `<webview>` tag vs `BrowserView` vs sandboxed `<iframe>`. Document the choice and its security implications before implementing. Do not use `nodeIntegration: true` in any embedded web context.

**Phase 07 — Canvas**: Use tldraw as the rendering library. The canvas is a view type — a page can be opened as a canvas. Objects placed on canvas are real Nexus objects (pages), not canvas-only primitives. Links drawn on canvas create real bidirectional links.

**Phase 09 — Data Management**: This is the most critical phase in the pipeline. The type schema, property types, and query infrastructure built here are the foundation for Phases 10–12. Do not rush it. Every property type must be: Text, Number, Date, Boolean, Select, Multi-select, Relation (link to another page), URL, File.

**Phase 13 — Notification System + Node Graph**: These are independent and can be built in parallel or either order. The notification system must exist before Spaced Repetition (Phase 14).

**Phase 14 — Spaced Repetition**: Any note or object can be flagged for spaced repetition review. The system schedules reviews using a standard SM-2 or FSRS algorithm. At review time, a popup/notification interrupts the user with the flagged content. The user rates recall quality and the next review is scheduled. This is not a flashcard app — it is review of actual notes and objects.

**Phase 16 — AI Integration**: Two modes, user-selectable in settings:
- Local: run a local model (Ollama or equivalent) — no data leaves the machine.
- API: call an external provider (Claude API, etc.) — user provides their own key.
AI features: semantic search across notes, summarization, inline generation, Q&A against the knowledge base. Do not design AI features that only work in API mode.

---

## Feature Specifications

### Media Embedding
- Local file attachments: images, PDFs, video, audio. Stored in a local `attachments/` directory adjacent to the SQLite database, referenced by path in the database.
- Files render inline in the block editor with a visual preview.
- PDF blocks show a rendered preview, click to open full view.
- No automatic cloud upload of attachments.

### Import / Export
Primary: raw file I/O.
- Export: Markdown (`.md`) per page, JSON dump of full database, CSV export of any data view.
- Import: `.md` files, plain text, JSON (Nexus format), CSV (into a typed object collection).
Secondary (lower priority): migration importers for AnyType and Notion export formats.

### Canvas
- tldraw embedded as a view mode.
- Pages can be opened in canvas view or document view — both are valid ways to view the same object.
- Placing a note on canvas = linking it, not duplicating it.
- Draw connections on canvas = creates bidirectional link in the database.
- Canvas state (positions, zoom) is stored per-page in the database.

### Spaced Repetition
- Flag any page or block for review via right-click context menu.
- System uses SM-2 scheduling algorithm (well-documented, simple to implement).
- Review sessions surface as desktop notifications (Phase 13 dependency) or forced modal.
- User rates: Again / Hard / Good / Easy.
- Review history stored in a `reviews` table: `page_id`, `reviewed_at`, `rating`, `next_review_at`, `interval`, `ease_factor`.

### Sections and Vaults
- Sections: logical groups within a vault. Implemented as a `section_id` foreign key on pages. A page belongs to one section. Sections can have sub-sections (tree structure, stored with parent_section_id).
- Cross-section links: always allowed.
- Vaults: separate SQLite files. Cross-vault links: stored in a special `cross_vault_links` table with explicit user confirmation required to create.

### Themes and Aesthetics
- Dark mode by default. Light mode available. System-follows optional.
- CSS custom property system — all colors, radii, spacing through variables.
- Accent color: user-selectable from a curated set (not arbitrary color picker in v1).
- Font: user-selectable body font from a small curated list. Code blocks always monospace.
- No third-party theme marketplace in v1.

---

## What Nexus is NOT

Do not implement these unless explicitly instructed:

- Not a cloud product. No sync server, no user accounts, no subscription.
- Not a team tool. No multiplayer, no comments, no sharing links.
- Not a web app. The browser version is not a goal.
- Not a replacement for a task manager (yet). No due dates, assignees, or project management in v1.
- Not a calendar. Date properties exist, calendar views may come later — not in scope.

---

## Development Principles

**Polish before progress.** A feature is done when it feels done — edge cases handled, UI states covered (empty, loading, error), keyboard shortcuts working. Do not leave rough edges and move on.

**Schema changes are expensive.** Think through the SQLite schema before writing it. A migration that breaks existing data is a serious problem. Plan ahead.

**Privacy by default.** No telemetry, no analytics, no external requests except explicit user actions (web app tabs, AI API calls with user-provided keys). The app works fully offline.

**Keyboard-first.** Every core action should be reachable by keyboard. Command palette (`Cmd+K`) from day one.

**No premature abstraction.** Build the feature, then extract the pattern. Do not build a plugin system, extension API, or theme engine until the core is complete.

---

## Session Protocol for Claude Code

When starting a Claude Code session on Nexus:

1. Read this file first.
2. Identify the current phase from the roadmap.
3. Check for a `PHASE_XX.md` spec file in the project root if one exists.
4. State the current phase and what you are about to build before writing any code.
5. Ask for clarification on anything ambiguous before starting — not mid-implementation.
6. After completing a phase, note what was built, what decisions were made, and any open questions in a `CHANGELOG.md` or session note.

When in doubt: do less, do it well.
