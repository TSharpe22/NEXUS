import { HTMLAttributes, ReactNode } from 'react'
import './Panel.css'

interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  dense?: boolean
  error?: boolean
}

export function Panel({ title, dense, error, className, children, ...rest }: PanelProps) {
  const classes = [
    'nx-panel',
    dense && 'nx-panel--dense',
    error && 'nx-panel--error',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} {...rest}>
      {title && <div className="nx-panel__title nx-type-label">{title}</div>}
      {children}
    </div>
  )
}
