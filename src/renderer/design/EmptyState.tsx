import { Icon, IconShape } from './Icon'

interface EmptyStateProps {
  icon?: IconShape
  text: string
  meta?: string
}

export function EmptyState({ icon = 'diamond', text, meta }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--nx-space-2)',
        padding: 'var(--nx-space-6)',
        color: 'var(--nx-text-dim)'
      }}
    >
      <Icon shape={icon} size={22} color="var(--nx-text-dim)" />
      <div className="nx-type-body" style={{ color: 'var(--nx-text-dim)' }}>
        {text}
      </div>
      {meta && <div className="nx-type-data">{meta}</div>}
    </div>
  )
}
