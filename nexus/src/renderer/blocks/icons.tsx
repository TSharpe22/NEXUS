import React from 'react'

// Named SVG icon set for use throughout Nexus.
// All icons use stroke="currentColor" so they inherit text color.

export type PageIconKey =
  | 'doc'
  | 'star'
  | 'pin'
  | 'fire'
  | 'check'
  | 'warning'
  | 'info'
  | 'bulb'
  | 'note'
  | 'bookmark'
  | 'heart'
  | 'lock'

const PATHS: Record<PageIconKey, React.ReactNode> = {
  doc: (
    <>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </>
  ),
  star: (
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  ),
  pin: (
    <>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  fire: (
    <path d="M12 2c0 0-4 4-4 8a4 4 0 008 0c0-1.5-.5-3-1.5-4 0 2-1 3-2.5 3s-2.5-1-2.5-3c0-2 2-4 2-4zm0 0c1.5 2 4 4 4 7a4 4 0 01-4 4" />
  ),
  check: (
    <>
      <polyline points="20 6 9 17 4 12" />
    </>
  ),
  warning: (
    <>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </>
  ),
  bulb: (
    <>
      <line x1="9" y1="18" x2="15" y2="18" />
      <line x1="10" y1="22" x2="14" y2="22" />
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 018.91 14" />
    </>
  ),
  note: (
    <>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </>
  ),
  bookmark: (
    <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
  ),
  heart: (
    <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </>
  ),
}

export const ICON_KEYS = Object.keys(PATHS) as PageIconKey[]

/** Renders an SVG icon by key. Unknown/emoji values fall back to 'doc'. */
export function PageIcon({
  iconKey,
  size = 14,
  className,
}: {
  iconKey?: string | null
  size?: number
  className?: string
}) {
  const key = (iconKey && PATHS[iconKey as PageIconKey] ? iconKey : 'doc') as PageIconKey
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[key]}
    </svg>
  )
}

/** Callout-specific icon set (8 icons for the picker). */
export const CALLOUT_ICON_KEYS: PageIconKey[] = [
  'bulb',
  'note',
  'warning',
  'check',
  'info',
  'fire',
  'star',
  'pin',
]
