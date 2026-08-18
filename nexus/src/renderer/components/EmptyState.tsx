import React from 'react'
import { useAppStore } from '../stores/app-store'

/**
 * Empty state, per the design spec:
 *   "centered, single outline icon (dim/neutral, not accent-coloured), one
 *    bold line of primary text, one line of mono meta text below it. No
 *    illustration; no call-to-action unless genuinely needed."
 *
 * The call-to-action is deliberately absent. This view appears whenever no
 * page is selected — which is usually with pages already in the vault — and
 * the sidebar carries "New page" plus "Create your first page" for the truly
 * empty case, so dropping the button here strands nobody. The meta line
 * reports vault state instead, which is the more useful thing to say.
 */
export function EmptyState() {
  const pages = useAppStore((s) => s.pages)
  const count = pages.length

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-6">
      {/* Simple geometric form, 1.5px outline, dim — never accent-coloured. */}
      <svg
        width="34"
        height="34"
        viewBox="0 0 34 34"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-[var(--nx-text-tertiary)] mb-[var(--nx-space-4)]"
        aria-hidden="true"
      >
        <circle cx="17" cy="17" r="12" />
      </svg>

      <p className="nx-type-panel text-[var(--nx-text-primary)]">
        {count === 0 ? 'No entries yet' : 'No page selected'}
      </p>

      <p className="nx-type-data text-[var(--nx-text-secondary)] mt-[var(--nx-space-2)]">
        vault // {count} {count === 1 ? 'entry' : 'entries'}
      </p>
    </div>
  )
}
