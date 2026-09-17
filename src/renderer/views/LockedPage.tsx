import { useEffect, useRef, useState } from 'react'
import type { PageListItem } from '@shared/types'
import { Button } from '../design/Button'
import { Glyph } from '../design/Glyph'
import { useAppStore } from '../store/app-store'
import { ipcMessage } from '../ipc-error'
import './LockedPage.css'

/**
 * What a locked page looks like when you open it.
 *
 * A dialog was the obvious shape and is the wrong one: a modal over an empty
 * editor implies there is a document behind it that the app is choosing not to
 * show you, and the moment you press Escape you are looking at that lie. There
 * is nothing behind this. The body does not exist in a readable form anywhere
 * in the process until the password is typed, and the screen should say so.
 *
 * So it takes the whole panel, states plainly what is and is not protected —
 * the title above it is in the clear, and pretending otherwise is how somebody
 * ends up putting a name in one — and holds the field that opens it.
 */
export function LockedPage({ page }: { page: PageListItem }) {
  const unlockPage = useAppStore((s) => s.unlockPage)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fieldRef = useRef<HTMLInputElement>(null)

  // Refocused per page, not just on mount: this component is not keyed, so
  // clicking a second locked page reuses it and would otherwise leave the
  // field behind wherever the last click landed.
  useEffect(() => {
    setPassword('')
    setError(null)
    setBusy(false)
    fieldRef.current?.focus()
  }, [page.id])

  const attempt = async () => {
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      await unlockPage(page.id, password)
      // No state reset on the way out: the store swaps this component for the
      // editor, and the effect above handles the next locked page.
      setPassword('')
    } catch (e) {
      setError(ipcMessage(e))
      setPassword('')
      setBusy(false)
      fieldRef.current?.focus()
    }
  }

  return (
    <div className="nx-locked">
      <div className="nx-locked__mark">
        <Glyph name="lock" size={28} strokeWidth={1.2} />
      </div>

      <h1 className="nx-locked__title">{page.title || 'Untitled'}</h1>
      <p className="nx-locked__meta nx-type-data">
        This page is password-protected. Its contents are encrypted and are not in
        search, the tracker, exports or the vault folder until you open it.
      </p>

      <form
        className="nx-locked__form"
        onSubmit={(e) => {
          e.preventDefault()
          void attempt()
        }}
      >
        <input
          ref={fieldRef}
          className="nx-input nx-locked__field"
          type="password"
          autoComplete="current-password"
          spellCheck={false}
          placeholder="Password"
          disabled={busy}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError(null)
          }}
        />
        <Button type="submit" disabled={busy || !password}>
          {busy ? 'Opening…' : 'Open'}
        </Button>
      </form>

      <div className="nx-locked__error nx-type-data" role="alert" aria-live="polite">
        {error}
      </div>

      <p className="nx-locked__foot nx-type-data">
        The title, tags and properties above are not encrypted — the page list is
        built from them. There is no recovery: without the password this page
        cannot be read, by you or by anyone.
      </p>
    </div>
  )
}
