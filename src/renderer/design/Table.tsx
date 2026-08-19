import { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import './Table.css'

/** Wrapped in its own scroll container so a wide table never widens the page. */
export function Table(props: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="nx-table-scroll">
      <table className="nx-table" {...props} />
    </div>
  )
}

export function TableHead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />
}

export function TableBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />
}

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  selected?: boolean
  clickable?: boolean
}

export function TableRow({ selected, clickable, className, ...rest }: TableRowProps) {
  const classes = [
    selected && 'nx-table-row--selected',
    (clickable || rest.onClick) && 'nx-table-row--clickable',
    className
  ]
    .filter(Boolean)
    .join(' ')
  return <tr className={classes} {...rest} />
}

interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Direction when this is the column being sorted by; null when it isn't. */
  sort?: 'asc' | 'desc' | null
}

/** A header with an `onClick` becomes a sort control and grows an indicator. */
export function Th({ sort, className, children, ...rest }: ThProps) {
  const sortable = Boolean(rest.onClick)
  const classes = [sortable && 'nx-th--sortable', sort && 'nx-th--sorted', className].filter(Boolean).join(' ')

  return (
    <th
      className={classes || undefined}
      aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : undefined}
      {...rest}
    >
      {children}
      {sortable && (
        <span className="nx-th__sort" aria-hidden="true">
          {sort === 'asc' ? '▲' : sort === 'desc' ? '▼' : '·'}
        </span>
      )}
    </th>
  )
}

export function Td(props: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props} />
}
