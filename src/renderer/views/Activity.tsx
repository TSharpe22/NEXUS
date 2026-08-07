import { useEffect, useState } from 'react'
import type { ActivityLogEntry } from '@shared/types'
import { Panel } from '../design/Panel'
import { EmptyState } from '../design/EmptyState'
import { Table, TableHead, TableBody, TableRow, Th, Td } from '../design/Table'
import { useAppStore } from '../store/app-store'
import { relativeTime } from '../hooks/use-relative-time'

/** Event types get a plain-English label rather than showing the raw enum. */
const EVENT_LABEL: Record<string, string> = {
  created: 'Created',
  edited: 'Edited',
  renamed: 'Renamed',
  retyped: 'Type changed',
  deleted: 'Trashed',
  restored: 'Restored',
  property: 'Property set'
}

export function Activity() {
  const openPage = useAppStore((s) => s.openPage)
  const pages = useAppStore((s) => s.pages)
  const [activity, setActivity] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.activity.getRecent(200).then((entries) => {
      setActivity(entries)
      setLoading(false)
    })
  }, [pages])

  if (loading) return <div className="nx-type-data">Loading…</div>

  const titleFor = (pageId: string | null) =>
    pageId ? (pages.find((p) => p.id === pageId)?.title || 'Untitled') : '—'

  return (
    <Panel dense>
      {activity.length === 0 ? (
        <EmptyState text="Nothing has happened yet" meta="Activity shows up here as you create and edit pages." />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <Th>When</Th>
              <Th>Page</Th>
              <Th>Event</Th>
              <Th>Detail</Th>
            </TableRow>
          </TableHead>
          <TableBody>
            {activity.map((a) => {
              // Rows for pages that were deleted for good have nothing to open.
              const exists = !!a.page_id && pages.some((p) => p.id === a.page_id)
              return (
                <TableRow
                  key={a.id}
                  clickable={exists}
                  onClick={exists ? () => openPage(a.page_id!) : undefined}
                >
                  <Td className="nx-type-data">{relativeTime(a.created_at)}</Td>
                  <Td>{titleFor(a.page_id)}</Td>
                  <Td className="nx-type-data">{EVENT_LABEL[a.event_type] ?? a.event_type}</Td>
                  <Td className="nx-type-data">{a.message}</Td>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </Panel>
  )
}
