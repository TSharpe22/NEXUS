import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import type { CaptureTarget, Page } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { Panel } from './Panel'
import { Button } from './Button'
import { Icon } from './Icon'

/**
 * Capture a line, wherever you are.
 *
 * Lifted out of Home unchanged rather than copied: this is the action the
 * application exists for, and it lived on one screen, so getting a thought down
 * while writing in Notes meant leaving the page you were writing. Two copies of
 * it would have been two behaviours a week later.
 */

export const CAPTURE_TARGETS: { value: CaptureTarget; label: string; hint: string }[] = [
  { value: 'page', label: 'New page', hint: 'A page of its own, ready to type or link' },
  { value: 'journal', label: "Today's entry", hint: "Appended to today's journal entry" },
  {
    value: 'task',
    label: 'Task',
    hint: "A checkbox under today's entry's task heading — @2026-08-22 sets a due date"
  },
  { value: 'inbox', label: 'Inbox', hint: 'A checkbox on the Inbox page — no date, no home yet' }
]

export const CAPTURED_MESSAGE: Record<CaptureTarget, string> = {
  page: 'Captured as a new page',
  journal: "Added to today's entry",
  task: "Added to today's entry",
  inbox: 'Added to the Inbox'
}

export function CaptureBar({
  onCapture,
  onCaptured,
  openPage,
  autoFocus = false,
  onDone
}: {
  onCapture: (text: string, target: CaptureTarget) => Promise<Page>
  onCaptured: () => void
  openPage: (id: string) => void
  /** The overlay opens straight into the box; Home's copy does not steal focus. */
  autoFocus?: boolean
  /** Called after a capture lands, so an overlay can close itself. */
  onDone?: (opened: boolean) => void
}) {
  const [text, setText] = useState('')
  /**
   * Opens on the preference rather than on a constant. The box is a fast path
   * and the fastest path through it is type-and-return, so whatever this
   * opens on is where most captures actually land — which makes it a setting
   * rather than a default somebody in this file gets to pick.
   */
  const defaultTarget = useAppStore((s) => s.prefs.captureTarget)
  const [target, setTarget] = useState<CaptureTarget>(defaultTarget)

  // Preferences load after the first paint, and the box may already be open
  // by then. Only re-seat an untouched box: changing the target under someone
  // who has just clicked one is worse than opening on the wrong one.
  const touched = useRef(false)
  useEffect(() => {
    if (!touched.current) setTarget(defaultTarget)
  }, [defaultTarget])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const submit = async (andOpen: boolean) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const page = await onCapture(trimmed, target)
      // Cleared before navigating, so a capture-and-open does not leave the
      // text sitting in the box to be captured twice on the way back.
      setText('')
      onCaptured()
      if (andOpen) openPage(page.id)
      else toast.success(CAPTURED_MESSAGE[target])
      onDone?.(andOpen)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // The box is meant to take one thought after another. It stopped doing that
  // because the input was disabled while a capture was in flight: the browser
  // blurs a disabled element, focusing one back does nothing, and re-enabling
  // it does not restore focus — so the next thing typed went to the document
  // body and vanished. The input stays enabled now (`submit` already ignores a
  // re-entrant call) and focus is restored after the render that clears `busy`,
  // not during it.
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) inputRef.current?.focus()
    wasBusy.current = busy
  }, [busy])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  return (
    <Panel className="nx-home__capture">
      <div className="nx-home__capture-row">
        <Icon shape="diamond" size={14} color="var(--nx-accent)" />
        <input
          ref={inputRef}
          className="nx-input nx-home__capture-input"
          placeholder="Capture a thought…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Deliberately not stopped: every binding in the window-wide map
            // carries a modifier, so plain typing here cannot reach it, and
            // swallowing the rest took Escape with it — the box could be
            // opened by a key and then not closed by one.
            if (e.key !== 'Enter') return
            e.preventDefault()
            void submit(e.shiftKey)
          }}
        />
        <Button onClick={() => void submit(false)} disabled={busy || !text.trim()}>
          Capture
        </Button>
      </div>
      <div className="nx-home__capture-row">
        <span className="nx-type-label">into</span>
        {CAPTURE_TARGETS.map((option) => (
          <Button
            key={option.value}
            variant={target === option.value ? 'selected' : 'ghost'}
            title={option.hint}
            onClick={() => {
              touched.current = true
              setTarget(option.value)
            }}
          >
            {option.label}
          </Button>
        ))}
        <span className="nx-type-data nx-home__capture-hint">⏎ capture · ⇧⏎ capture and open</span>
      </div>
    </Panel>
  )
}

/**
 * The same bar, over the screen you were on.
 *
 * Deliberately the identical component rather than a stripped-down one: a
 * capture made from the overlay has to be able to do everything a capture made
 * on Home can, or you learn to distrust the fast path and stop using it.
 */
export function QuickCapture({ onClose }: { onClose: () => void }) {
  const capture = useAppStore((s) => s.capture)
  const openPage = useAppStore((s) => s.openPage)
  const refresh = useAppStore((s) => s.refresh)

  return (
    <div className="nx-capture-backdrop" onClick={onClose}>
      <div className="nx-capture-overlay" onClick={(e) => e.stopPropagation()}>
        <CaptureBar
          autoFocus
          onCapture={capture}
          onCaptured={() => void refresh()}
          openPage={openPage}
          // Capture-and-open goes to the page, so the overlay has to get out of
          // the way; a plain capture leaves it up, because the whole point of a
          // capture box is the next thought.
          onDone={(opened) => opened && onClose()}
        />
      </div>
    </div>
  )
}
