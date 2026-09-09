import type { View } from './store/app-store'

/**
 * Every keyboard shortcut, in one list.
 *
 * One list because there were two: a hand-written table in Settings and a
 * `keydown` handler inside the command palette, and the table was the one that
 * could go stale in silence. Settings renders this, the window-wide handler
 * dispatches it, and a binding that exists in neither place cannot exist at
 * all — the same argument `VIEW_META` settles for the nav.
 */

export type ShortcutAction =
  | 'search'
  | 'capture'
  | 'newPage'
  | 'todayEntry'
  | 'inbox'
  | 'focusSearch'
  | { go: View }

export interface Shortcut {
  action: ShortcutAction
  /** `event.key`, lowercased. */
  key: string
  /** Meta on a Mac, Control everywhere else — one binding, either keyboard. */
  mod: boolean
  shift?: boolean
  /** How it is written in Settings. */
  display: string
  /** What it does, in Settings. */
  label: string
}

export const SHORTCUTS: Shortcut[] = [
  { action: 'search', key: 'k', mod: true, display: 'Cmd/Ctrl + K', label: 'Search pages and their text' },
  {
    action: 'capture',
    key: 'k',
    mod: true,
    shift: true,
    display: 'Cmd/Ctrl + Shift + K',
    label: 'Capture a thought, from any screen'
  },
  { action: 'newPage', key: 'n', mod: true, display: 'Cmd/Ctrl + N', label: 'New page' },
  {
    action: 'todayEntry',
    key: 'j',
    mod: true,
    shift: true,
    display: 'Cmd/Ctrl + Shift + J',
    label: "Open today's journal entry"
  },
  {
    action: 'inbox',
    key: 'i',
    mod: true,
    shift: true,
    display: 'Cmd/Ctrl + Shift + I',
    label: 'Open the Inbox'
  },
  { action: 'focusSearch', key: 'f', mod: true, display: 'Cmd/Ctrl + F', label: 'Search within the notes list' },
  { action: { go: 'home' }, key: '1', mod: true, display: 'Cmd/Ctrl + 1', label: 'Go to Home' },
  { action: { go: 'notes' }, key: '2', mod: true, display: 'Cmd/Ctrl + 2', label: 'Go to Notes' },
  { action: { go: 'views' }, key: '3', mod: true, display: 'Cmd/Ctrl + 3', label: 'Go to Views' },
  { action: { go: 'tracker' }, key: '4', mod: true, display: 'Cmd/Ctrl + 4', label: 'Go to Tracker' },
  { action: { go: 'settings' }, key: '5', mod: true, display: 'Cmd/Ctrl + 5', label: 'Go to Settings' }
]

/** The editor's own bindings, which BlockNote owns — listed, not handled. */
export const EDITOR_SHORTCUTS: { display: string; label: string }[] = [
  { display: '/', label: 'Block menu (headings, lists, toggle, callout…)' },
  { display: '[[', label: 'Link to another page' },
  { display: 'Cmd/Ctrl + B / I / U', label: 'Bold, italic, underline' }
]

export function matches(shortcut: Shortcut, event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== shortcut.key) return false
  if (shortcut.mod !== (event.metaKey || event.ctrlKey)) return false
  return Boolean(shortcut.shift) === event.shiftKey
}
