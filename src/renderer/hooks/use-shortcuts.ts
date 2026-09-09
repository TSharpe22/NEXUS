import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { useAppStore } from '../store/app-store'
import { SHORTCUTS, matches } from '../shortcuts'

/**
 * The window-wide keyboard map.
 *
 * One listener on `document`, dispatching the list in `shortcuts.ts`. It used
 * to be a handful of `if`s inside the command palette, which is why every
 * binding that was not about the palette — capture, today's entry, reaching a
 * view — did not exist.
 *
 * Every binding carries a modifier, so nothing here can swallow a keystroke
 * meant for the editor or a text field. The two that could — the palette's own
 * Escape, and Enter inside a capture box — are handled by the thing showing
 * them and stopped there.
 */
export function useShortcuts({
  onSearch,
  onCapture
}: {
  onSearch: () => void
  onCapture: () => void
}): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = SHORTCUTS.find((candidate) => matches(candidate, event))
      if (!shortcut) return

      const store = useAppStore.getState()
      const { action } = shortcut

      if (typeof action === 'object') {
        event.preventDefault()
        store.setActiveView(action.go)
        return
      }

      switch (action) {
        case 'search':
          event.preventDefault()
          onSearch()
          return
        case 'capture':
          event.preventDefault()
          onCapture()
          return
        case 'newPage':
          event.preventDefault()
          void store.createPage()
          return
        case 'todayEntry':
          event.preventDefault()
          store.openTodayEntry().catch((e) => {
            console.error('[nexus] could not open today\'s entry', e)
            toast.error("Could not open today's entry")
          })
          return
        case 'inbox':
          event.preventDefault()
          store.openInbox().catch((e) => {
            console.error('[nexus] could not open the inbox', e)
            toast.error('Could not open the Inbox')
          })
          return
        case 'focusSearch': {
          event.preventDefault()
          // The box lives in the Notes list, so this goes there first. Focus
          // is taken from the DOM rather than routed through the store: a flag
          // that means "please focus" has to be cleared again, and a stale one
          // steals the caret from whatever you type next.
          store.setActiveView('notes')
          requestAnimationFrame(() => {
            const box = document.querySelector<HTMLInputElement>('.nx-notes__search')
            box?.focus()
            box?.select()
          })
          return
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onSearch, onCapture])
}
