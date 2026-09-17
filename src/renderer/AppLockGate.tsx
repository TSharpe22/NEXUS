import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppLockStatus } from '@shared/types'
import { flushPendingWrites } from './pending-writes'
import { ipcMessage } from './ipc-error'
import { useAppStore } from './store/app-store'
import { Button } from './design/Button'
import './AppLockGate.css'

/**
 * The app, or the lock screen — never both.
 *
 * Locking unmounts the whole app rather than drawing over it, so nothing a page
 * said is left in the DOM behind a curtain. The main process is what actually
 * enforces the lock (see `main/app-lock.ts`); this is the half that makes it
 * look like one, and the half that notices you have walked away.
 */
export function AppLockGate({ children }: { children: ReactNode }) {
  const [lockStatus, setLockStatus] = useState<AppLockStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.appLock.status().then((s) => {
      if (!cancelled) setLockStatus(s)
    })
    const off = window.api.appLock.onChanged((s) => {
      if (s.locked) forgetOpenPages()
      setLockStatus(s)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  useIdleLock(lockStatus)

  // Quitting asks the window to write out pending edits and waits for the
  // answer. The app that normally answers is unmounted while locked, and there
  // is nothing pending — so answer at once rather than hold the quit for the
  // two-second timeout.
  useEffect(() => {
    if (!lockStatus?.locked) return
    return window.api.lifecycle.onFlushRequest(() => undefined)
  }, [lockStatus?.locked])

  // Asking main takes a frame; showing the app for that frame and then taking
  // it away would flash exactly what the lock is for.
  if (!lockStatus) return <div className="nx-applock nx-applock--pending" />
  if (lockStatus.locked) return <LockScreen status={lockStatus} onUnlocked={setLockStatus} />
  return <>{children}</>
}

/**
 * Drop what the store holds for password-protected pages. Main forgets their
 * keys when the app locks; the renderer's decrypted copies go with them, so
 * unlocking the app does not quietly reopen a page that needs its own password.
 */
function forgetOpenPages(): void {
  useAppStore.setState((state) => {
    const shut = new Set(state.unlockedPageIds)
    const pageContent: Record<string, string> = {}
    for (const [id, body] of Object.entries(state.pageContent)) if (!shut.has(id)) pageContent[id] = body
    return { pageContent, unlockedPageIds: [] }
  })
}

/** Ask for a lock: pending writes first, then main — which flushes again, harmlessly. */
export async function lockApp(): Promise<void> {
  await flushPendingWrites()
  await window.api.appLock.lock()
}

/**
 * Lock after `idleSeconds` with no input in Nexus.
 *
 * Input in Nexus, not in the system: time spent in another app counts as time
 * away from this one, which is the point. Activity is a timestamp in a ref,
 * written by listeners that do nothing else, so moving the mouse costs no
 * render; a slow interval compares it against the clock.
 */
function useIdleLock(status: AppLockStatus | null): void {
  const lastInput = useRef(Date.now())
  const active = !!status?.enabled && !status.locked && status.idleSeconds > 0

  useEffect(() => {
    if (!active || !status) return
    lastInput.current = Date.now()
    const mark = (): void => {
      lastInput.current = Date.now()
    }
    const events = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const
    for (const name of events) window.addEventListener(name, mark, { passive: true, capture: true })

    const limitMs = status.idleSeconds * 1000
    let locking = false
    const timer = setInterval(
      () => {
        if (locking || Date.now() - lastInput.current < limitMs) return
        locking = true
        void lockApp().finally(() => {
          locking = false
        })
      },
      Math.min(15_000, Math.max(1000, limitMs / 5))
    )

    return () => {
      clearInterval(timer)
      for (const name of events) window.removeEventListener(name, mark, { capture: true })
    }
  }, [active, status?.idleSeconds]) // eslint-disable-line react-hooks/exhaustive-deps
}

function LockScreen({ status, onUnlocked }: { status: AppLockStatus; onUnlocked: (s: AppLockStatus) => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // The window coming back to the front is when somebody means to type here.
  useEffect(() => {
    const focus = (): void => inputRef.current?.focus()
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [])

  const submit = async () => {
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.api.appLock.unlock(password)
      onUnlocked(next)
    } catch (e) {
      setError(ipcMessage(e, 'Could not unlock.'))
      setPassword('')
      setBusy(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  return (
    <div className="nx-applock">
      <form
        className="nx-applock__panel"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="nx-applock__logo">NEXUS</div>
        <div className="nx-type-label">Locked</div>
        <input
          ref={inputRef}
          className="nx-applock__input"
          type="password"
          placeholder="Password"
          aria-label="Password"
          autoComplete="current-password"
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" disabled={!password || busy}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
        <div className={`nx-applock__message nx-type-data ${error ? 'is-error' : ''}`} role="status">
          {error ?? (status.retryInMs > 0 ? 'Too many attempts. Wait a moment.' : ' ')}
        </div>
      </form>
    </div>
  )
}
