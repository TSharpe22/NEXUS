import type { ReactElement } from 'react'

/**
 * The named glyph set — the marks a page, a type or a view can be tagged with.
 *
 * This is the second half of the iconography rule in DESIGN.md, and it does
 * not contradict the first. `Icon.tsx` stays what it always was: three
 * geometric primitives carrying *state* — selected, active, a callout's
 * severity — where the shape itself means something the app decided. These
 * are the opposite kind of mark: a label the user chose for one page, where
 * the whole job is being recognisable across a list of forty.
 *
 * Emoji were doing that job and doing it badly. They are somebody else's
 * artwork rendered by the OS at whatever weight, colour and metrics the
 * installed font happens to have — four saturated colours in a shell built
 * out of two greys and one emerald, a different picture on another machine,
 * and nothing that scales down to the 11px a sidebar row has room for.
 *
 * So: one stroke weight, one grid, `currentColor` throughout. A glyph
 * inherits the colour of whatever it sits in, which means it is dim in a
 * meta row, accent-coloured in a selected one, and never fights the text
 * beside it. Nothing here is filled — filled is reserved, and still is.
 *
 * Drawn on a 16×16 box with everything inside 1.5–14.5, so a glyph optically
 * matches a 16px cap height without a wrapper measuring it.
 */

export interface GlyphDef {
  /** What typing in the picker's filter box matches against. */
  name: string
  /** Stroke geometry, on a 16×16 viewBox. */
  art: ReactElement
}

/**
 * Insertion order is display order. Grouped by what they are for rather than
 * alphabetically — writing, time and measurement, the body, making things,
 * signals, orientation, growth — because a picker is scanned before it is
 * filtered, and forty marks in alphabetical order is forty marks with no
 * shape to scan.
 */
export const GLYPHS: Record<string, GlyphDef> = {
  note: {
    name: 'note page write document',
    art: (
      <>
        <path d="M3.5 2.5h9v11h-9z" />
        <path d="M6 6h4M6 8.5h4M6 11h2.5" />
      </>
    )
  },
  journal: {
    name: 'journal notebook diary log',
    art: <path d="M3.5 12.4V4.2A1.7 1.7 0 0 1 5.2 2.5h7.3v11H5.2a1.7 1.7 0 0 1 0-3.4h7.3" />
  },
  book: {
    name: 'book reading library study',
    art: (
      <>
        <path d="M2.5 3.5c2 0 4 .5 5.5 1.5 1.5-1 3.5-1.5 5.5-1.5v8c-2 0-4 .5-5.5 1.5-1.5-1-3.5-1.5-5.5-1.5z" />
        <path d="M8 5v8" />
      </>
    )
  },
  pen: {
    name: 'pen writing draft author edit',
    art: (
      <>
        <path d="M3 13.2l.9-3 7-7 2.1 2.1-7 7z" />
        <path d="M9.6 4.3l2.1 2.1" />
      </>
    )
  },
  quote: {
    name: 'quote excerpt reference passage',
    art: (
      <>
        <path d="M6.5 4.5c-2 .8-3 2.3-3 4.5h3v3h-3v-3" />
        <path d="M13 4.5c-2 .8-3 2.3-3 4.5h3v3h-3v-3" />
      </>
    )
  },
  tag: {
    name: 'tag label topic keyword',
    art: (
      <>
        <path d="M8.2 2.5H13a.5.5 0 0 1 .5.5v4.8a1 1 0 0 1-.3.7l-5.2 5.2a1 1 0 0 1-1.4 0l-4.3-4.3a1 1 0 0 1 0-1.4l5.2-5.2a1 1 0 0 1 .7-.3z" />
        <circle cx="10.8" cy="5.2" r=".9" />
      </>
    )
  },
  inbox: {
    name: 'inbox capture in unsorted tray',
    art: (
      <>
        <path d="M2.5 8.5L4.6 3h6.8l2.1 5.5v5h-11z" />
        <path d="M2.5 8.5h3l1 2h3l1-2h3" />
      </>
    )
  },
  archive: {
    name: 'archive box files stored',
    art: (
      <>
        <path d="M2.5 3.5h11v3h-11z" />
        <path d="M3.5 6.5v7h9v-7" />
        <path d="M6.5 9.5h3" />
      </>
    )
  },

  calendar: {
    name: 'calendar date day schedule',
    art: (
      <>
        <path d="M2.5 4.5h11v9h-11z" />
        <path d="M2.5 7.5h11M5.5 2.5v3M10.5 2.5v3" />
      </>
    )
  },
  clock: {
    name: 'clock time hour deadline',
    art: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 4.6V8l2.5 1.5" />
      </>
    )
  },
  check: {
    name: 'check done complete task finished',
    art: <path d="M3 8.4l3.6 3.6L13 4.4" />
  },
  target: {
    name: 'target goal aim objective',
    art: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <circle cx="8" cy="8" r="2.4" />
        <circle cx="8" cy="8" r=".6" />
      </>
    )
  },
  flag: {
    name: 'flag milestone marker checkpoint',
    art: (
      <>
        <path d="M4 14V2.5" />
        <path d="M4 3.2h8.5l-1.8 3 1.8 3H4" />
      </>
    )
  },
  chart: {
    name: 'chart data stats bars measure',
    art: (
      <>
        <path d="M2.5 13.5h11" />
        <path d="M4.6 13.5V7.4M8 13.5V3.6M11.4 13.5V9.8" />
      </>
    )
  },
  trend: {
    name: 'trend up growth rising chart',
    art: (
      <>
        <path d="M2.5 11.6l3.6-3.6 2.4 2.4 5-5" />
        <path d="M9.6 5.4h3.9v3.9" />
      </>
    )
  },
  money: {
    name: 'money trading finance cash pnl',
    art: (
      <>
        <path d="M2.5 4.5h11v7h-11z" />
        <circle cx="8" cy="8" r="1.7" />
        <path d="M5 7.2v1.6M11 7.2v1.6" />
      </>
    )
  },

  dumbbell: {
    name: 'training gym lift workout strength',
    art: (
      <>
        <path d="M2.6 6.4v3.2M13.4 6.4v3.2" />
        <path d="M4.8 4.4v7.2M11.2 4.4v7.2" />
        <path d="M4.8 8h6.4" />
      </>
    )
  },
  pulse: {
    name: 'pulse cardio run heart health',
    art: <path d="M2 8.4h3l1.5-4.2 2.6 8.2 1.4-4h3.5" />
  },
  leaf: {
    name: 'leaf food diet nutrition nature',
    art: (
      <>
        <path d="M12.9 3.2c-6 0-9.4 2.6-9.4 6.4a3.4 3.4 0 0 0 3.4 3.4c3.9 0 6-3.5 6-9.8z" />
        <path d="M4.2 13.3l4.6-4.8" />
      </>
    )
  },
  moon: {
    name: 'moon sleep rest night bed',
    art: <path d="M13.1 9.4A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.7 6.6z" />
  },
  waves: {
    name: 'waves meditate calm breath mind',
    art: (
      <>
        <path d="M2 5q2-2 4 0t4 0 4 0" />
        <path d="M2 8q2-2 4 0t4 0 4 0" />
        <path d="M2 11q2-2 4 0t4 0 4 0" />
      </>
    )
  },
  eye: {
    name: 'eye watch review observe attention',
    art: (
      <>
        <path d="M1.8 8S4.3 4.2 8 4.2 14.2 8 14.2 8 11.7 11.8 8 11.8 1.8 8 1.8 8z" />
        <circle cx="8" cy="8" r="1.8" />
      </>
    )
  },
  brain: {
    name: 'brain idea think mind memory',
    art: (
      <>
        <path d="M8 3.2v9.6" />
        <path d="M8 4a2 2 0 0 0-3.7-1A2 2 0 0 0 2.6 6a2.2 2.2 0 0 0 .5 3.4A2 2 0 0 0 5 12.6 2 2 0 0 0 8 12" />
        <path d="M8 4a2 2 0 0 1 3.7-1A2 2 0 0 1 13.4 6a2.2 2.2 0 0 1-.5 3.4A2 2 0 0 1 11 12.6 2 2 0 0 1 8 12" />
      </>
    )
  },
  idea: {
    name: 'idea light bulb insight spark',
    art: (
      <>
        <path d="M5.2 6.8a2.8 2.8 0 0 1 5.6 0c0 1.3-.8 2-1.3 2.7-.3.5-.4.9-.4 1.3H6.9c0-.4-.1-.8-.4-1.3-.5-.7-1.3-1.4-1.3-2.7z" />
        <path d="M6.6 12.3h2.8M7 13.9h2" />
      </>
    )
  },

  flask: {
    name: 'flask research science lab experiment',
    art: (
      <>
        <path d="M6.6 2.5v4L3.3 12a1.2 1.2 0 0 0 1 1.9h7.4a1.2 1.2 0 0 0 1-1.9L9.4 6.5v-4z" />
        <path d="M5.6 2.5h4.8M4.6 9.6h6.8" />
      </>
    )
  },
  tool: {
    name: 'tool wrench fix repair maintenance',
    art: (
      <path d="M9.9 2.5a3.5 3.5 0 0 0-4.1 5.2l-3.6 3.6 2.5 2.5 3.6-3.6a3.5 3.5 0 0 0 5.2-4.1l-2.3 2.3-1.8-.4-.4-1.8z" />
    )
  },
  puzzle: {
    name: 'puzzle piece component part module',
    art: <path d="M2.5 2.5h11v3.3a1.5 1.5 0 0 1 0 3v4.7H9.5a1.5 1.5 0 0 1-3 0H2.5z" />
  },
  cube: {
    name: 'cube build project construction thing',
    art: (
      <>
        <path d="M8 2.2l5.5 3v5.6L8 13.8l-5.5-3V5.2z" />
        <path d="M2.5 5.2L8 8.2l5.5-3M8 8.2v5.6" />
      </>
    )
  },
  layers: {
    name: 'layers stack levels structure',
    art: (
      <>
        <path d="M8 2.2l5.5 2.8L8 7.8 2.5 5z" />
        <path d="M2.5 8L8 10.8 13.5 8M2.5 11.2L8 14l5.5-2.8" />
      </>
    )
  },
  grid: {
    name: 'grid board matrix table layout',
    art: (
      <>
        <path d="M2.5 2.5h4.6v4.6H2.5zM8.9 2.5h4.6v4.6H8.9z" />
        <path d="M2.5 8.9h4.6v4.6H2.5zM8.9 8.9h4.6v4.6H8.9z" />
      </>
    )
  },
  terminal: {
    name: 'terminal code shell command dev',
    art: (
      <>
        <path d="M2.5 3.5h11v9h-11z" />
        <path d="M5 6.9l1.9 1.6L5 10.1M8.9 10.4h3" />
      </>
    )
  },
  brush: {
    name: 'brush design art visual paint',
    art: (
      <>
        <path d="M10.9 2.4l2.7 2.7-5.8 5.8-2.7-2.7z" />
        <path d="M5.1 8.2C3.7 9.6 4.2 11.2 2.6 12.7c2.1.6 3.7 0 4.6-1.9" />
      </>
    )
  },

  launch: {
    name: 'launch rocket ship release deploy',
    art: (
      <>
        <path d="M8 1.8c2.3 2 3.4 4.2 3.4 6.4 0 1.5-.5 2.7-1.1 3.5H5.7c-.6-.8-1.1-2-1.1-3.5 0-2.2 1.1-4.4 3.4-6.4z" />
        <path d="M5.9 11.7L4.2 14.2l2.3-1M10.1 11.7l1.7 2.5-2.3-1" />
        <circle cx="8" cy="6.4" r="1.3" />
      </>
    )
  },
  flame: {
    name: 'flame hot urgent streak burn',
    art: (
      <path d="M8 13.9a4.1 4.1 0 0 0 4.1-4.1c0-3-2.6-4.5-2.6-6.6 0 0-1.6 1-1.6 3 0 1-.7 1.5-1.3.9-.8-.7-1-1.6-1-1.6S3.9 7.1 3.9 9.8A4.1 4.1 0 0 0 8 13.9z" />
    )
  },
  star: {
    name: 'star favourite important starred',
    art: <path d="M8 2.2l1.8 3.8 4.2.6-3 3 .7 4.2L8 11.8l-3.7 2 .7-4.2-3-3 4.2-.6z" />
  },
  bolt: {
    name: 'bolt energy fast power quick',
    art: <path d="M9.2 1.8L4 9h3.4l-.6 5.2L12 7H8.5z" />
  },
  pin: {
    name: 'pin pinned keep fixed',
    art: (
      <>
        <path d="M4.8 2.5h6.4" />
        <path d="M6.4 2.5l-1 5.6h5.2l-1-5.6" />
        <path d="M8 8.1v5.4" />
      </>
    )
  },
  link: {
    name: 'link reference connect url',
    art: (
      <>
        <path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.1-2.1a2.6 2.6 0 0 0-3.7-3.7l-1 1" />
        <path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0L3.4 8.9a2.6 2.6 0 0 0 3.7 3.7l1-1" />
      </>
    )
  },
  thread: {
    name: 'thread series sequence timeline steps',
    art: (
      <>
        <path d="M4.5 4.4v7.2" />
        <circle cx="4.5" cy="3.2" r="1.2" />
        <circle cx="4.5" cy="8" r="1.2" />
        <circle cx="4.5" cy="12.8" r="1.2" />
        <path d="M6.6 3.2h6.9M6.6 8h6.9M6.6 12.8h4" />
      </>
    )
  },
  globe: {
    name: 'globe world web public global',
    art: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M2.5 8h11" />
        <path d="M8 2.5c1.9 2.1 2.9 4.3 2.9 5.5S9.9 11.4 8 13.5C6.1 11.4 5.1 9.2 5.1 8s1-3.4 2.9-5.5z" />
      </>
    )
  },

  compass: {
    name: 'compass direction navigate map plan',
    art: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M10.3 5.7l-1.6 4.6-4.6 1.6 1.6-4.6z" />
      </>
    )
  },
  map: {
    name: 'map route plan territory',
    art: (
      <>
        <path d="M2.5 4.4l4-1.5 3 1.5 4-1.5v8.7l-4 1.5-3-1.5-4 1.5z" />
        <path d="M6.5 2.9v9.7M9.5 4.4v9.7" />
      </>
    )
  },
  cap: {
    name: 'cap study learn school course',
    art: (
      <>
        <path d="M1.8 6L8 3.2 14.2 6 8 8.8z" />
        <path d="M4.6 7.3v3.5c0 1 1.5 1.7 3.4 1.7s3.4-.7 3.4-1.7V7.3" />
      </>
    )
  },
  question: {
    name: 'question open unknown ask uncertain',
    art: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M6.3 6.4A1.8 1.8 0 0 1 9.8 7c0 1.2-1.8 1.4-1.8 2.6" />
        <circle cx="8" cy="11.4" r=".6" />
      </>
    )
  },
  warning: {
    name: 'warning risk careful caution alert',
    art: (
      <>
        <path d="M8 2.6l5.7 10H2.3z" />
        <path d="M8 6.5v3" />
        <circle cx="8" cy="11.2" r=".6" />
      </>
    )
  },
  lock: {
    name: 'lock private secret protected password',
    art: (
      <>
        <path d="M3.9 7.4h8.2v6.1H3.9z" />
        <path d="M6 7.4V5.5a2 2 0 0 1 4 0v1.9" />
      </>
    )
  },
  unlock: {
    name: 'unlock open unsealed readable',
    art: (
      <>
        <path d="M3.9 7.4h8.2v6.1H3.9z" />
        {/* The shackle stops where the lock's meets the body. Same body, same
            arc, one endpoint moved — so the two read as one state and its
            opposite rather than as two different pictures. */}
        <path d="M6 7.4V5.5a2 2 0 0 1 4 0v.6" />
      </>
    )
  },
  key: {
    name: 'key password secret access credential',
    art: (
      <>
        <circle cx="5.1" cy="10.9" r="2.6" />
        <path d="M6.9 9.1l6.6-6.6" />
        <path d="M11.2 4.8l1.8 1.8M9.5 6.5l1.8 1.8" />
      </>
    )
  },
  shield: {
    name: 'shield safe secure guard defence',
    art: <path d="M8 2.2l5 1.9v4.2c0 3-2.1 5.3-5 6.2-2.9-.9-5-3.2-5-6.2V4.1z" />
  },
  sprout: {
    name: 'sprout seed new growing draft young',
    art: (
      <>
        <path d="M8 13.5V7.4" />
        <path d="M8 8.4c0-2.5-1.9-4-4.4-4 0 2.5 1.9 4 4.4 4z" />
        <path d="M8 9.6c0-2.1 1.6-3.4 3.9-3.4 0 2.1-1.6 3.4-3.9 3.4z" />
      </>
    )
  },
  tree: {
    name: 'tree evergreen mature settled forest',
    art: (
      <>
        <path d="M8 2.2L4.6 7h6.8z" />
        <path d="M8 5.4L3.2 11.4h9.6z" />
        <path d="M8 11.4v2.4" />
      </>
    )
  },
  music: {
    name: 'music audio sound track listening',
    art: (
      <>
        <path d="M6.1 11.6V4.1l7-1.6v7.5" />
        <circle cx="4.4" cy="11.9" r="1.8" />
        <circle cx="11.4" cy="10.3" r="1.8" />
      </>
    )
  }
}

export type GlyphName = keyof typeof GLYPHS

/**
 * Whether a stored `pages.icon` names one of these.
 *
 * The column has always held whatever the picker wrote into it, and until now
 * that was an emoji. Nothing migrates those — `PageGlyph` renders an
 * unrecognised value as the text it is, so a page marked before this still
 * shows what it was marked with, and re-picking is what converts it.
 */
export function isGlyphName(value: string | null | undefined): value is GlyphName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GLYPHS, value)
}

interface GlyphProps {
  name: GlyphName | string
  size?: number
  className?: string
  /** Only ever overridden where a glyph is drawn much larger than 16px. */
  strokeWidth?: number
}

/** One glyph, at `currentColor`. Renders nothing for a name not in the set. */
export function Glyph({ name, size = 16, className, strokeWidth = 1.5 }: GlyphProps) {
  const def = GLYPHS[name]
  if (!def) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {def.art}
    </svg>
  )
}

/**
 * A page's icon wherever one is shown.
 *
 * Handles the two things the column can hold — a glyph name, and the emoji an
 * older build wrote — so no call site has to know that both exist.
 */
export function PageGlyph({
  icon,
  size = 16,
  className
}: {
  icon: string | null | undefined
  size?: number
  className?: string
}) {
  if (!icon) return null
  if (isGlyphName(icon)) return <Glyph name={icon} size={size} className={className} />
  // A legacy emoji. Sized to the same box so a row of mixed marks still lines
  // up, and left at its own colours because there is nothing to recolour.
  return (
    <span
      className={className}
      style={{ fontSize: size * 0.86, lineHeight: 1, display: 'inline-block' }}
    >
      {icon}
    </span>
  )
}
