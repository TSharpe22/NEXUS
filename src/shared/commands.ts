/**
 * Command pages — Home, and the dashboards beside it.
 *
 * Home was one dashboard, and `widgets.ts` said that when a second existed,
 * `Dashboard` was the shape it would hold. This is the second, third and
 * fourth: Exec (the day, what Home used to be), Trading and Learning. Each is
 * a `Dashboard` stored on its own; this file is only the list of them — names,
 * order, and which one Nexus opens on.
 *
 * Same contract as `widgets.ts`: serialised into the vault, so adding a key is
 * safe and renaming one is not. A build that meets an id it does not know
 * keeps it.
 */
import type { Dashboard } from './widgets'
import { DEFAULT_DASHBOARD } from './widgets'

/** Home's id. Home is always first, cannot be removed, and keeps its old storage key. */
export const HOME_ID = 'home'

/** The colours a command page can carry — the same four a tag can. */
export const COMMAND_COLORS = ['accent', 'info', 'success', 'critical'] as const
export type CommandColor = (typeof COMMAND_COLORS)[number]

export interface CommandPage {
  /** Lowercase letters, digits and dashes — it is part of a settings key. */
  id: string
  name: string
  /** Its marker in the sidebar and in Command navigation. Optional; none is neutral. */
  color?: CommandColor
}

export interface CommandIndex {
  version: 1
  /** In sidebar order. Home is always the first entry. */
  pages: CommandPage[]
  /** The command page Nexus opens on. */
  start: string
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/

export function isCommandId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

/** A command page's id, from its name, not clashing with any in `taken`. */
export function commandIdFor(name: string, taken: string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'page'
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}

export const DEFAULT_COMMANDS: CommandIndex = {
  version: 1,
  pages: [
    { id: HOME_ID, name: 'Home' },
    { id: 'exec', name: 'Exec' },
    { id: 'trading', name: 'Trading' },
    { id: 'learning', name: 'Learning' }
  ],
  // The exec page on a day with no room for anything else — so Nexus opens there.
  start: 'exec'
}

/** Repair whatever was stored into a usable list. */
export function normaliseCommands(raw: unknown): CommandIndex {
  if (!raw || typeof raw !== 'object') return DEFAULT_COMMANDS
  const candidate = raw as Partial<CommandIndex>
  if (!Array.isArray(candidate.pages)) return DEFAULT_COMMANDS

  const pages: CommandPage[] = [{ id: HOME_ID, name: 'Home' }]
  for (const entry of candidate.pages) {
    if (!entry || typeof entry !== 'object') continue
    const { id, name, color } = entry as Partial<CommandPage>
    if (!isCommandId(id) || id === HOME_ID || pages.some((p) => p.id === id)) continue
    pages.push({
      id,
      name: typeof name === 'string' && name.trim() ? name.trim() : id,
      ...(COMMAND_COLORS.includes(color as CommandColor) ? { color } : {})
    })
  }
  const start = pages.some((p) => p.id === candidate.start) ? (candidate.start as string) : HOME_ID
  return { version: 1, pages, start }
}

/** The settings key a command page's layout is stored under. Home keeps the key it always had. */
export function dashboardKey(id: string): string {
  return id === HOME_ID ? 'home.dashboard' : `dashboard.${id}`
}

/**
 * Home as the hub: the capture box, the list of command pages, and the next
 * thing to do. The day lives on Exec.
 */
export const HUB_DASHBOARD: Dashboard = {
  version: 1,
  widgets: [
    { id: 'w-quote', kind: 'quote', config: {}, span: 12 },
    { id: 'w-capture', kind: 'capture', config: {}, span: 12 },
    { id: 'w-tiles', kind: 'tiles', config: {}, span: 4 },
    { id: 'w-next', kind: 'next-task', config: {}, span: 4 },
    { id: 'w-review', kind: 'review', config: {}, span: 4 }
  ]
}

export const LEARNING_DASHBOARD: Dashboard = {
  version: 1,
  widgets: [
    { id: 'w-review', kind: 'review', config: {}, span: 12 },
    { id: 'w-pinned', kind: 'pinned', config: {}, span: 4 },
    { id: 'w-concepts', kind: 'view', config: {}, span: 8 }
  ]
}

/**
 * Trading (TRADING.md): the ledger's panels — simulated until `trading.db`
 * exists — and, under them, the notes that live in Nexus (strategies, firms)
 * through saved views picked on the page.
 */
export const TRADING_DASHBOARD: Dashboard = {
  version: 1,
  widgets: [
    { id: 'w-ops', kind: 'trading.ops', config: {}, span: 12 },
    { id: 'w-accounts', kind: 'trading.accounts', config: {}, span: 7 },
    { id: 'w-strategies', kind: 'trading.strategies', config: {}, span: 5 },
    { id: 'w-portfolio', kind: 'trading.portfolio', config: {}, span: 8 },
    { id: 'w-income', kind: 'trading.income', config: {}, span: 4 },
    { id: 'w-capital', kind: 'trading.capital', config: {}, span: 4, stack: true },
    { id: 'w-tester', kind: 'trading.tester', config: {}, span: 7 },
    { id: 'w-pipeline', kind: 'trading.pipeline', config: {}, span: 5 },
    { id: 'w-practice', kind: 'trading.practice', config: {}, span: 5, stack: true },
    { id: 'w-strategy-notes', kind: 'view', config: {}, span: 6 },
    { id: 'w-firm-notes', kind: 'view', config: {}, span: 6 }
  ]
}

/** What a command page shows before anything has been saved for it. */
export function defaultDashboardFor(id: string): Dashboard {
  switch (id) {
    case HOME_ID:
      return HUB_DASHBOARD
    case 'exec':
      return DEFAULT_DASHBOARD
    case 'learning':
      return LEARNING_DASHBOARD
    case 'trading':
      return TRADING_DASHBOARD
    default:
      return { version: 1, widgets: [] }
  }
}
