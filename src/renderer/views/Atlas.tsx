import { useEffect, useState } from 'react'
import type { PageSummary, GraphPreview, StorageStats, ActivityLogEntry, DirectiveStatus } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { Panel } from '../design/Panel'
import { EmptyState } from '../design/EmptyState'
import { StatusDot } from '../design/StatusDot'
import { Table, TableHead, TableBody, TableRow, Th, Td } from '../design/Table'
import { GraphWidget } from './GraphWidget'
import { relativeTime } from '../hooks/use-relative-time'
import './Atlas.css'

const STATUS_TO_DOT: Record<string, 'active' | 'pending' | 'done'> = {
  active: 'active',
  pending: 'pending',
  done: 'done'
}

export function Atlas() {
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setActivePageId = useAppStore((s) => s.setActivePageId)

  const [entries, setEntries] = useState<PageSummary[]>([])
  const [graph, setGraph] = useState<GraphPreview | null>(null)
  const [storage, setStorage] = useState<StorageStats | null>(null)
  const [directives, setDirectives] = useState<PageSummary[]>([])
  const [activity, setActivity] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      window.api.pages.getAllSummary(),
      window.api.stats.getGraphPreview(),
      window.api.stats.getStorage(),
      window.api.pages.getAllSummary('directive'),
      window.api.activity.getRecent(6)
    ]).then(([allEntries, graphPreview, storageStats, directivePages, recentActivity]) => {
      setEntries(allEntries)
      setGraph(graphPreview)
      setStorage(storageStats)
      setDirectives(directivePages.filter((d) => d.status !== 'done').slice(0, 3))
      setActivity(recentActivity)
      setLoading(false)
    })
  }, [])

  const openPage = (id: string) => {
    setActiveView('vault')
    setActivePageId(id)
  }

  if (loading) return <div className="nx-type-data">loading...</div>

  return (
    <div className="nx-atlas">
      <div className="nx-atlas__main">
        <Panel title="Knowledge Graph">{graph && <GraphWidget graph={graph} />}</Panel>

        <Panel dense>
          {entries.length === 0 ? (
            <EmptyState icon="square" text="No entries yet" meta="create a page in vault to get started" />
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <Th>Name</Th>
                  <Th>Tags</Th>
                  <Th>Modified</Th>
                  <Th>Status</Th>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.slice(0, 12).map((entry) => (
                  <TableRow key={entry.id} clickable onClick={() => openPage(entry.id)}>
                    <Td>{entry.title || 'Untitled'}</Td>
                    <Td className="nx-type-data">{entry.tags.join(', ') || '—'}</Td>
                    <Td className="nx-type-data">{relativeTime(entry.updated_at)}</Td>
                    <Td>
                      {entry.status ? (
                        <StatusDot status={STATUS_TO_DOT[entry.status] ?? 'pending'} label={entry.status} />
                      ) : (
                        <span className="nx-type-data">—</span>
                      )}
                    </Td>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </div>

      <div className="nx-atlas__side">
        <Panel title="Vault // Storage">
          {storage && (
            <>
              <div className="nx-stat-value">{storage.pageCount} entries</div>
              <div className="nx-bar">
                <div className="nx-bar__fill" style={{ width: `${Math.min(100, (storage.dbSizeBytes / (1024 * 1024)) * 10)}%` }} />
              </div>
              <div className="nx-type-data">{(storage.dbSizeBytes / (1024 * 1024)).toFixed(1)} MB</div>
              <div className="nx-bar" style={{ marginTop: 'var(--nx-space-3)' }}>
                <div className="nx-bar__fill" style={{ width: `${storage.taggedPercent}%` }} />
              </div>
              <div className="nx-type-data">{storage.taggedPercent}% tagged</div>
            </>
          )}
        </Panel>

        <Panel title="Command // Directives">
          {directives.length === 0 ? (
            <div className="nx-type-data">no active directives</div>
          ) : (
            directives.map((d) => (
              <div key={d.id} className="nx-directive-row" onClick={() => openPage(d.id)}>
                <StatusDot status={STATUS_TO_DOT[(d.status as DirectiveStatus) ?? 'active'] ?? 'active'} />
                <span className="nx-type-body">{d.title || 'Untitled'}</span>
              </div>
            ))
          )}
        </Panel>

        <Panel title="Flow // Recent">
          {activity.length === 0 ? (
            <div className="nx-type-data">nothing yet</div>
          ) : (
            activity.map((a) => (
              <div key={a.id} className="nx-flow-row">
                <span className="nx-type-data">{relativeTime(a.created_at)}</span>
                <span className="nx-type-body">{a.message}</span>
              </div>
            ))
          )}
        </Panel>
      </div>
    </div>
  )
}
