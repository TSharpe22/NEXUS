import { useEffect, useState } from 'react'
import { ContextMenu, MENU_SEPARATOR, type MenuEntry, type MenuState } from './ContextMenu'

/**
 * One right-click menu for the whole window.
 *
 * Electron draws no context menu of its own, so until a component builds one,
 * right-clicking does nothing at all — not even Copy over selected text. The
 * page tree had a menu; nothing else did. Anything can now open one with
 * `openMenu`, and anything that does not still gets the edit menu below when
 * there is text to act on.
 *
 * A module-level slot rather than context: the canvas, the graph and the
 * editor are far apart in the tree, and there is only ever one menu open.
 */

let show: ((state: MenuState | null) => void) | null = null

export function openMenu(x: number, y: number, entries: MenuEntry[]): void {
  show?.({ x, y, entries })
}

export function closeMenu(): void {
  show?.(null)
}

function isEditable(el: Element | null): el is HTMLElement {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  if (el instanceof HTMLInputElement) {
    const textual = ['text', 'search', 'url', 'email', 'tel', 'password', 'number', ''].includes(el.type)
    return textual && !el.readOnly && !el.disabled
  }
  return (el as HTMLElement).isContentEditable
}

/**
 * Cut, Copy, Paste and Select all, for whatever has focus. They run in the
 * main process (`edit:run`), because a page cannot read the system clipboard
 * for Paste, and so all four behave exactly like their shortcuts.
 */
export function editEntries(target: Element | null): MenuEntry[] {
  const editable = isEditable(target)
  const hasSelection = (() => {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return target.selectionStart !== target.selectionEnd
    }
    return !!window.getSelection()?.toString()
  })()
  return [
    { label: 'Cut', disabled: !editable || !hasSelection, onSelect: () => void window.api.edit.run('cut') },
    { label: 'Copy', disabled: !hasSelection, onSelect: () => void window.api.edit.run('copy') },
    { label: 'Paste', disabled: !editable, onSelect: () => void window.api.edit.run('paste') },
    MENU_SEPARATOR,
    { label: 'Select all', onSelect: () => void window.api.edit.run('selectAll') }
  ]
}

/**
 * Mounted once, in App. Draws the menu, and listens for right-clicks nothing
 * else claimed: a component that opens its own menu calls `preventDefault`,
 * and React's handlers run before this window listener sees the event.
 */
export function MenuHost() {
  const [state, setState] = useState<MenuState | null>(null)

  useEffect(() => {
    show = setState
    return () => {
      if (show === setState) show = null
    }
  }, [])

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return
      const target = e.target instanceof Element ? e.target : null
      const field = target?.closest('input, textarea, [contenteditable="true"]') ?? null
      if (!isEditable(field) && !window.getSelection()?.toString()) return
      e.preventDefault()
      setState({ x: e.clientX, y: e.clientY, entries: editEntries(field) })
    }
    window.addEventListener('contextmenu', onContextMenu)
    return () => window.removeEventListener('contextmenu', onContextMenu)
  }, [])

  return <ContextMenu state={state} onClose={() => setState(null)} />
}
