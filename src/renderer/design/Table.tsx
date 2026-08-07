import { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import './Table.css'

export function Table(props: HTMLAttributes<HTMLTableElement>) {
  return <table className="nx-table" {...props} />
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

export function Th(props: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th {...props} />
}

export function Td(props: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props} />
}
