import { useEffect, useRef, useState } from 'react'
import type { TrackerTask } from '@shared/types'

/**
 * The date control on a task row.
 *
 * Rescheduling used to mean finding the task's page, finding the block, and
 * editing an `@2026-08-22` by hand — which made the tracker somewhere you
 * looked at your tasks rather than somewhere you ran them. The write still
 * goes into the block (that is the source of truth), this is just the handle.
 *
 * Deliberately a native date input rather than a calendar of our own: it is
 * the same control the date property uses in the properties panel, it knows
 * the user's locale, and it is keyboard-navigable for free.
 *
 * A task with no date of its own inherits its page's, which is what makes a
 * journal todo work with no syntax. Setting a date here writes an explicit
 * token; clearing it hands the task back to its page, so the control shows
 * *where the date came from* rather than pretending every date is the same.
 */
export function DueDate({
  task,
  onChange
}: {
  task: TrackerTask
  onChange: (due: string | null) => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Opening is what reveals the input, so it cannot be focused until after the
  // render that mounts it.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const commit = async (value: string | null) => {
    setBusy(true)
    try {
      await onChange(value)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const inherited = task.dueDateSource === 'page'

  if (!open) {
    return (
      <button
        className={`nx-due ${inherited ? 'nx-due--inherited' : ''} ${task.dueDate ? '' : 'nx-due--none'}`}
        onClick={() => setOpen(true)}
        title={
          inherited
            ? `${task.dueDate} — from the page's date. Set one here to give this task its own.`
            : task.dueDate
              ? `Due ${task.dueDate}. Click to reschedule.`
              : 'No date. Click to set one.'
        }
      >
        {task.dueDate ?? 'no date'}
      </button>
    )
  }

  return (
    <span className="nx-due nx-due--editing">
      <input
        ref={inputRef}
        type="date"
        className="nx-due__input"
        disabled={busy}
        defaultValue={task.dueDate ?? ''}
        onChange={(e) => void commit(e.target.value || null)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        onBlur={() => setOpen(false)}
      />
      {task.dueDate && (
        <button
          className="nx-due__clear"
          disabled={busy}
          title={inherited ? 'Already using the page date' : "Clear this task's own date"}
          // Pointer-down, not click: the input's blur closes the control
          // before a click on it would ever land.
          onPointerDown={(e) => {
            e.preventDefault()
            void commit(null)
          }}
        >
          ×
        </button>
      )}
    </span>
  )
}
