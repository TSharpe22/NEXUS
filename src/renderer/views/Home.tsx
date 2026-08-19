import { useEffect, useState } from 'react'
import type { PageSummary, StorageStats, ActivityLogEntry, GraphData } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import { EmptyState } from '../design/EmptyState'
import { Table, TableHead, TableBody, TableRow, Th, Td } from '../design/Table'
import { GraphView } from './GraphView'
import { relativeTime } from '../hooks/use-relative-time'
import { usePageTitles } from '../hooks/use-page-titles'
import './Home.css'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function summarizeProperties(
  entry: PageSummary,
  titleOf: (id: string | null | undefined) => string | null
): string {
  const parts = entry.properties
    .filter(
      (p) =>
        (p.value_text || p.value_number != null || p.value_date || p.value_relation) && p.value_text !== '[]'
    )
    .slice(0, 2)
    .map((p) => {
      // A relation is an id — it belongs here under the name it points at, not
      // as a uuid, and it was filtered out of this summary entirely before.
      if (p.value_relation) return `${p.key}: ${titleOf(p.value_relation) ?? 'missing page'}`
      // Tags are stored as a JSON array; showing the raw string is noise.
      if (p.value_text?.startsWith('[')) {
        try {
          const arr = JSON.parse(p.value_text)
          if (Array.isArray(arr)) return `${p.key}: ${arr.join(', ')}`
        } catch {
          /* fall through to the raw value */
        }
      }
      return `${p.key}: ${p.value_text ?? p.value_number ?? p.value_date}`
    })
  return parts.join(' · ') || '—'
}

export function Home() {
  const openPage = useAppStore((s) => s.openPage)
  const createPage = useAppStore((s) => s.createPage)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const types = useAppStore((s) => s.types)
  const pages = useAppStore((s) => s.pages)
  const titleOf = usePageTitles()

  const [entries, setEntries] = useState<PageSummary[]>([])
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] })
  const [storage, setStorage] = useState<StorageStats | null>(null)
  const [activity, setActivity] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Keyed off `pages` so creating or deleting a page elsewhere refreshes the
  // dashboard rather than leaving it showing a stale snapshot.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.api.pages.getAllSummary(),
      window.api.stats.getGraph(),
      window.api.stats.getStorage(),
      window.api.activity.getRecent(6)
    ]).then(([allEntries, graphData, storageStats, recentActivity]) => {
      if (cancelled) return
      setEntries(allEntries)
      setGraph(graphData)
      setStorage(storageStats)
      setActivity(recentActivity)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [pages])

  if (loading) return <div className="nx-type-data">Loading…</div>

  if (pages.length === 0) {
    return (
      <EmptyState
        text="Nothing here yet"
        meta="Nexus is empty. Create your first page to get started — everything else on this screen fills in from there."
        action={<Button onClick={() => createPage()}>New page</Button>}
      />
    )
  }

  return (
    <div className="nx-home">
      <div className="nx-home__main">
        <Panel title="Graph" actions={<span className="nx-type-data">click a node to open it</span>}>
          <GraphView graph={graph} />
        </Panel>

        <Panel title="All pages" dense>
          <Table>
            <TableHead>
              <TableRow>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Properties</Th>
                <Th>Modified</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.slice(0, 12).map((entry) => (
                <TableRow key={entry.id} clickable onClick={() => openPage(entry.id)}>
                  <Td>{entry.title || 'Untitled'}</Td>
                  <Td className="nx-type-data">
                    {types.find((t) => t.id === entry.type_id)?.name ?? 'Note'}
                  </Td>
                  <Td className="nx-type-data">{summarizeProperties(entry, titleOf)}</Td>
                  <Td className="nx-type-data">{relativeTime(entry.updated_at)}</Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {entries.length > 12 && (
            <button className="nx-home__more" onClick={() => setActiveView('tables')}>
              {entries.length - 12} more — browse by type →
            </button>
          )}
        </Panel>
      </div>

      <div className="nx-home__side">
        <Panel title="Vault">
          {storage && (
            <div className="nx-home__stats">
              <div className="nx-home__stat">
                <span className="nx-home__stat-value">{storage.pageCount}</span>
                <span className="nx-type-data">pages</span>
              </div>
              <div className="nx-home__stat">
                <span className="nx-home__stat-value">{graph.edges.length}</span>
                <span className="nx-type-data">links</span>
              </div>
              <div className="nx-home__stat">
                <span className="nx-home__stat-value">{formatBytes(storage.dbSizeBytes)}</span>
                <span className="nx-type-data">on disk</span>
              </div>
              <div className="nx-home__stat">
                <span className="nx-home__stat-value">{storage.withPropertiesPercent}%</span>
                <span className="nx-type-data">with properties</span>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Recent activity">
          {activity.length === 0 ? (
            <div className="nx-type-data">Nothing yet</div>
          ) : (
            <div className="nx-home__activity">
              {activity.map((a) => (
                <button
                  key={a.id}
                  className="nx-home__activity-row"
                  disabled={!a.page_id}
                  onClick={() => a.page_id && openPage(a.page_id)}
                >
                  <span className="nx-type-data nx-home__activity-when">{relativeTime(a.created_at)}</span>
                  <span>{a.message}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
