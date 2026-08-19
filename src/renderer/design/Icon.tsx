export type IconShape = 'square' | 'circle' | 'diamond'

interface IconProps {
  shape: IconShape
  filled?: boolean
  size?: number
  color?: string
  strokeWidth?: number
  className?: string
}

/**
 * The only icon vocabulary in Nexus: outline geometric shapes, filled only
 * for the single "selected/active" state. See DESIGN.md — Iconography.
 */
export function Icon({
  shape,
  filled = false,
  size = 14,
  color = 'currentColor',
  strokeWidth = 1.5,
  className
}: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    className,
    'aria-hidden': true
  } as const

  const fillProps = filled
    ? { fill: color, stroke: color, strokeWidth }
    : { fill: 'none', stroke: color, strokeWidth }

  if (shape === 'square') {
    return (
      <svg {...common}>
        <rect x="2.5" y="2.5" width="11" height="11" {...fillProps} />
      </svg>
    )
  }

  if (shape === 'circle') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="5.5" {...fillProps} />
      </svg>
    )
  }

  return (
    <svg {...common}>
      <polygon points="8,2 14,8 8,14 2,8" {...fillProps} />
    </svg>
  )
}
