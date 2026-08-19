import { HTMLAttributes, ReactNode } from 'react'
import './Panel.css'

interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  /** Rendered on the right of the title row — filters, counts, actions. */
  actions?: ReactNode
  /** Removes padding so a table can meet the panel's edges. */
  dense?: boolean
  /** No chrome at all: groups content without drawing a card. */
  flush?: boolean
  error?: boolean
}

export function Panel({ title, actions, dense, flush, error, className, children, ...rest }: PanelProps) {
  const classes = [
    'nx-panel',
    dense && 'nx-panel--dense',
    flush && 'nx-panel--flush',
    error && 'nx-panel--error',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} {...rest}>
      {(title || actions) && (
        <div className="nx-panel__header">
          {title ? <div className="nx-panel__title nx-type-label">{title}</div> : <span />}
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}
