export type Status = 'active' | 'synced' | 'pending' | 'error' | 'done'

const STATUS_COLOR: Record<Status, string> = {
  active: 'var(--nx-success)',
  synced: 'var(--nx-info)',
  pending: 'var(--nx-accent)',
  error: 'var(--nx-critical)',
  done: 'var(--nx-text-dim)'
}

interface StatusDotProps {
  status: Status
  label?: string
}

export function StatusDot({ status, label }: StatusDotProps) {
  const color = STATUS_COLOR[status]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--nx-space-1)' }}>
      <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden>
        <circle cx="4" cy="4" r="4" fill={color} />
      </svg>
      <span className="nx-type-body" style={{ color }}>
        {label ?? status}
      </span>
    </span>
  )
}
