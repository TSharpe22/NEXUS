import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'
import { ipcMessage } from '../ipc-error'
import './PasswordDialog.css'

export interface PasswordField {
  key: string
  label: string
  /** Shown under the field while it is empty. */
  hint?: string
}

export interface PasswordOptions {
  /** Short, in the imperative — "Set a password for this page". */
  title: string
  /** One or two lines saying what actually happens. */
  message?: string
  confirmLabel?: string
  /** Whether accepting takes protection away, which colours the button. */
  danger?: boolean
  fields: PasswordField[]
  /**
   * Checked before `submit` runs. Return a message to show, or null.
   * For anything the renderer can decide on its own — two fields that do not
   * match, an empty one — so a typo never costs a round trip.
   */
  validate?: (values: Record<string, string>) => string | null
  /**
   * The action. Throwing keeps the dialog open and shows the message, which is
   * what makes a wrong password a retry rather than a dismissal and a toast.
   */
  submit: (values: Record<string, string>) => Promise<void>
}

interface Pending {
  options: PasswordOptions
  resolve: (completed: boolean) => void
}

let present: ((options: PasswordOptions) => Promise<boolean>) | null = null

/**
 * Ask for a password and act on it. Resolves true when the action completed.
 *
 * The same imperative shape as `confirmDialog`, for the same reason — the call
 * sites stay one-liners — with one addition it needs and confirm does not: the
 * action runs *inside* the dialog. A wrong password is the expected answer to
 * this question, not an error, and it has to be answerable by typing again in
 * the box that is already open.
 *
 * There is no fallback to a native dialog the way `confirmDialog` has one.
 * `window.prompt` is disabled in Electron, and a password typed into something
 * that echoes it in the clear would be worse than not asking.
 */
export function passwordDialog(options: PasswordOptions): Promise<boolean> {
  if (!present) return Promise.resolve(false)
  return present(options)
}

/** Put a password on something. Asks twice, because a typo here is unrecoverable. */
export function askNewPassword(
  title: string,
  message: string,
  submit: (password: string) => Promise<void>
): Promise<boolean> {
  return passwordDialog({
    title,
    message,
    confirmLabel: 'Set password',
    fields: [
      { key: 'password', label: 'Password' },
      { key: 'confirm', label: 'Repeat it' }
    ],
    validate: (v) => {
      if (!v.password) return 'A password is required.'
      if (v.password !== v.confirm) return 'Those do not match.'
      return null
    },
    submit: (v) => submit(v.password)
  })
}

export function askPassword(
  title: string,
  message: string,
  confirmLabel: string,
  submit: (password: string) => Promise<void>,
  danger = false
): Promise<boolean> {
  return passwordDialog({
    title,
    message,
    confirmLabel,
    danger,
    fields: [{ key: 'password', label: 'Password' }],
    validate: (v) => (v.password ? null : 'A password is required.'),
    submit: (v) => submit(v.password)
  })
}

/** Mounted once, at the app root. */
export function PasswordHost() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const firstFieldRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    present = (options) =>
      new Promise<boolean>((resolve) => {
        setValues({})
        setError(null)
        setBusy(false)
        setPending({ options, resolve })
      })
    return () => {
      present = null
    }
  }, [])

  useEffect(() => {
    if (pending) firstFieldRef.current?.focus()
  }, [pending])

  if (!pending) return null

  const { title, message, confirmLabel, danger, fields, validate, submit } = pending.options

  const settle = (completed: boolean) => {
    // Cleared on the way out rather than on the way in as well, so a typed
    // password does not sit in React state behind whatever opens next.
    setValues({})
    pending.resolve(completed)
    setPending(null)
  }

  const attempt = async () => {
    if (busy) return
    const problem = validate?.(values) ?? null
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await submit(values)
      settle(true)
    } catch (e) {
      setError(ipcMessage(e))
      // Cleared on a refusal: retyping is the next step, and a field still
      // holding the password that was just rejected has to be emptied first.
      setValues({})
      setBusy(false)
      firstFieldRef.current?.focus()
    }
  }

  return (
    <div
      className="nx-pwd"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) settle(false)
      }}
    >
      <form
        className="nx-pwd__panel"
        onSubmit={(e) => {
          e.preventDefault()
          void attempt()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation()
            settle(false)
          }
        }}
      >
        <div className="nx-pwd__title">{title}</div>
        {message && <div className="nx-pwd__message nx-type-data">{message}</div>}

        {fields.map((field, i) => (
          <label className="nx-pwd__field" key={field.key}>
            <span className="nx-type-label">{field.label}</span>
            <input
              ref={i === 0 ? firstFieldRef : undefined}
              className="nx-input"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              disabled={busy}
              value={values[field.key] ?? ''}
              onChange={(e) => {
                const next = e.target.value
                setValues((current) => ({ ...current, [field.key]: next }))
                setError(null)
              }}
            />
            {field.hint && <span className="nx-pwd__hint nx-type-data">{field.hint}</span>}
          </label>
        ))}

        {/* aria-live so the reason a submit did nothing is announced, not just
            drawn — this is the one message in the dialog that appears late. */}
        <div className="nx-pwd__error nx-type-data" role="alert" aria-live="polite">
          {error}
        </div>

        <div className="nx-pwd__actions">
          <Button variant="quiet" type="button" onClick={() => settle(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'critical' : 'primary'} type="submit" disabled={busy}>
            {busy ? 'Working…' : (confirmLabel ?? 'Confirm')}
          </Button>
        </div>
      </form>
    </div>
  )
}
