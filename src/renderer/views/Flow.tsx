import { useEffect, useState } from 'react'
import type { ActivityLogEntry } from '@shared/types'
import { Panel } from '../design/Panel'
import { EmptyState } from '../design/EmptyState'
import { Table, TableHead, TableBody, TableRow, Th, Td } from '../design/Table'
import { relativeTime } from '../hooks/use-relative-time'

export function Flow() {
  const [activity, setActivity] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.activity.getRecent(100).then((entries) => {
      setActivity(entries)
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="nx-type-data">loading...</div>

  return (
    <Panel dense>
      {activity.length === 0 ? (
        <EmptyState icon="circle" text="Nothing has happened yet" meta="activity shows up here as you use nexus" />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <Th>When</Th>
              <Th>Event</Th>
              <Th>Detail</Th>
            </TableRow>
          </TableHead>
          <TableBody>
            {activity.map((a) => (
              <TableRow key={a.id}>
                <Td className="nx-type-data">{relativeTime(a.created_at)}</Td>
                <Td className="nx-type-data">{a.event_type}</Td>
                <Td>{a.message}</Td>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  )
}
