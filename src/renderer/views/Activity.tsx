import { useEffect, useState } from 'react'
import type { ActivityLogEntry } from '@shared/types'
import { Panel } from '../design/Panel'
import { EmptyState } from '../design/EmptyState'
import { Table, TableHead, TableBody, TableRow, Th, Td } from '../design/Table'
import { useAppStore } from '../store/app-store'
import { relativeTime } from '../hooks/use-relative-time'

/**
 * Event types get a plain-English label rather than showing the raw enum.
 *
 * Every `event_type` `repo.logActivity` is called with needs an entry — a
 * missing one shows the raw lowercase enum next to properly-cased neighbours,
 * which is how `pinned`, `folder` and `tag` read until now.
 */
const EVENT_LABEL: Record<string, string> = {
  created: 'Created',
  edited: 'Edited',
  renamed: 'Renamed',
  retyped: 'Type changed',
  deleted: 'Trashed',
  restored: 'Restored',
  property: 'Property set',
  pinned: 'Pinned',
  unpinned: 'Unpinned',
  folder: 'Folder',
  tag: 'Tagged'
}

export function Activity() {
  const openPage = useAppStore((s) => s.openPage)
  const pages = useAppStore((s) => s.pages)
  const trashed = useAppStore((s) => s.trashed)
  const [activity, setActivity] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.activity.getRecent(200).then((entries) => {
      setActivity(entries)
      setLoading(false)
    })
  }, [pages])

  if (loading) return <div className="nx-type-data">Loading…</div>

  // Trash included: a page's history does not stop being about that page when
  // it is trashed, and looking only at live pages renamed every one of its
  // past rows to "Untitled" the moment it was.
  const titleFor = (pageId: string | null) => {
    if (!pageId) return '—'
    const page = pages.find((p) => p.id === pageId) ?? trashed.find((p) => p.id === pageId)
    return page?.title || 'Untitled'
  }

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
              // Folder events carry no page, and a trashed page is not somewhere
              // to navigate to. (A page deleted for good leaves no rows at all —
              // `activity_log.page_id` is ON DELETE CASCADE.)
              const exists = !!a.page_id && pages.some((p) => p.id === a.page_id)
              const label = EVENT_LABEL[a.event_type] ?? a.event_type
              // Most events pass their own name as the message, so the detail
              // column spent every row repeating the one beside it.
              const detail = a.message.toLowerCase() === label.toLowerCase() ? '' : a.message
              return (
                <TableRow
                  key={a.id}
                  clickable={exists}
                  onClick={exists ? () => openPage(a.page_id!) : undefined}
                >
                  <Td className="nx-type-data">{relativeTime(a.created_at)}</Td>
                  <Td>{titleFor(a.page_id)}</Td>
                  <Td className="nx-type-data">{label}</Td>
                  <Td className="nx-type-data">{detail}</Td>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </Panel>
  )
}
