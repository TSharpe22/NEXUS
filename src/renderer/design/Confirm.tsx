import { useEffect, useState } from 'react'
import { Button } from './Button'
import './Confirm.css'

export interface ConfirmOptions {
  /** Short question, in the imperative — "Delete this page?" */
  title: string
  /** One line saying what actually happens. Skipped when the title says it all. */
  message?: string
  /** Label on the accepting button. Defaults to "Confirm". */
  confirmLabel?: string
  /** Whether accepting destroys something, which colours the button. */
  danger?: boolean
}

interface Pending {
  options: ConfirmOptions
  resolve: (accepted: boolean) => void
}

/**
 * Set by `<ConfirmHost />` while it is mounted.
 *
 * An imperative call rather than a piece of state threaded through every view
 * — the same shape as the `toast()` this app already uses, and the reason the
 * call sites could stay one-liners when they moved off `window.confirm`.
 */
let present: ((options: ConfirmOptions) => Promise<boolean>) | null = null

/**
 * Ask before doing something irreversible. Resolves true when accepted.
 *
 * `window.confirm` blocks the renderer on a native OS dialog that ignores
 * every token in the design system, and Playwright dismisses it by default —
 * so the destructive paths behind one could not be driven in the smoke test at
 * all. Falls back to the native dialog if the host somehow isn't mounted,
 * because silently proceeding with a delete would be the worst outcome here.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (!present) return Promise.resolve(window.confirm(options.message ?? options.title))
  return present(options)
}

/** Mounted once, at the app root. */
export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null)

  useEffect(() => {
    present = (options) => new Promise<boolean>((resolve) => setPending({ options, resolve }))
    return () => {
      present = null
    }
  }, [])

  if (!pending) return null

  const settle = (accepted: boolean) => {
    pending.resolve(accepted)
    setPending(null)
  }

  const { title, message, confirmLabel, danger } = pending.options

  return (
    <div
      className="nx-confirm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // Clicking away is a cancel; it is the non-destructive answer, so it is
      // the safe one to give to a stray click.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) settle(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') settle(false)
      }}
    >
      <div className="nx-confirm__panel">
        <div className="nx-confirm__title">{title}</div>
        {message && <div className="nx-confirm__message nx-type-data">{message}</div>}
        <div className="nx-confirm__actions">
          <Button variant="quiet" onClick={() => settle(false)}>
            Cancel
          </Button>
          {/* Focused on open so Enter accepts and Escape cancels without
              reaching for the mouse. */}
          <Button variant={danger ? 'critical' : 'primary'} autoFocus onClick={() => settle(true)}>
            {confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  )
}
