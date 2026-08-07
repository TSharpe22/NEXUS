import { ReactNode } from 'react'
import './EmptyState.css'

interface EmptyStateProps {
  text: string
  meta?: string
  /** A primary action rendered under the message — an empty screen with no
      way forward is a dead end. */
  action?: ReactNode
}

export function EmptyState({ text, meta, action }: EmptyStateProps) {
  return (
    <div className="nx-empty">
      <div className="nx-empty__text">{text}</div>
      {meta && <div className="nx-empty__meta nx-type-data">{meta}</div>}
      {action && <div className="nx-empty__action">{action}</div>}
    </div>
  )
}
