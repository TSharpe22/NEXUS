import { Icon } from './Icon'
import { Button } from './Button'

interface ErrorStateProps {
  label: string
  detail?: string
  onRetry?: () => void
}

export function ErrorState({ label, detail, onRetry }: ErrorStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--nx-space-2)',
        padding: 'var(--nx-space-4)',
        border: '1px solid var(--nx-critical)',
        borderRadius: 'var(--nx-radius-md)',
        background: 'var(--nx-critical-tint)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--nx-space-2)' }}>
        <Icon shape="diamond" filled size={14} color="var(--nx-critical)" />
        <span className="nx-type-panel-title" style={{ color: 'var(--nx-critical)' }}>
          {label}
        </span>
      </div>
      {detail && (
        <div className="nx-type-body" style={{ color: 'var(--nx-text-dim)' }}>
          {detail}
        </div>
      )}
      {onRetry && (
        <Button variant="critical" onClick={onRetry} style={{ alignSelf: 'flex-start' }}>
          Retry
        </Button>
      )}
    </div>
  )
}
