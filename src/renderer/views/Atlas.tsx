import { useEffect, useState } from 'react'
import type { PageSummary, GraphPreview, StorageStats, ActivityLogEntry, TypeDef } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { Panel } from '../design/Panel'
import { EmptyState } from '../design/EmptyState'
import { Table, TableHead, TableBody, TableRow, Th, Td } from '../design/Table'
import { GraphWidget } from './GraphWidget'
import { relativeTime } from '../hooks/use-relative-time'
import './Atlas.css'

function summarizeProperties(entry: PageSummary): string {
  const parts = entry.properties
    .filter((p) => (p.value_text || p.value_number != null || p.value_date) && p.value_text !== '[]')
    .slice(0, 2)
    .map((p) => `${p.key}: ${p.value_text ?? p.value_number ?? p.value_date}`)
  return parts.join(', ') || '—'
}

export function Atlas() {
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setActivePageId = useAppStore((s) => s.setActivePageId)
  const commandTypeId = useAppStore((s) => s.commandTypeId)
  const setCommandTypeId = useAppStore((s) => s.setCommandTypeId)

  const [entries, setEntries] = useState<PageSummary[]>([])
  const [graph, setGraph] = useState<GraphPreview | null>(null)
  const [storage, setStorage] = useState<StorageStats | null>(null)
  const [types, setTypes] = useState<TypeDef[]>([])
  const [commandPreview, setCommandPreview] = useState<PageSummary[]>([])
  const [activity, setActivity] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      window.api.pages.getAllSummary(),
      window.api.stats.getGraphPreview(),
      window.api.stats.getStorage(),
      window.api.types.list(),
      window.api.activity.getRecent(6)
    ]).then(([allEntries, graphPreview, storageStats, typeList, recentActivity]) => {
      setEntries(allEntries)
      setGraph(graphPreview)
      setStorage(storageStats)
      setTypes(typeList)
      setActivity(recentActivity)
      setLoading(false)

      const previewTypeId = commandTypeId ?? typeList[0]?.id ?? null
      if (previewTypeId) {
        if (!commandTypeId) setCommandTypeId(previewTypeId)
        window.api.pages.getAllSummary(previewTypeId).then((pages) => setCommandPreview(pages.slice(0, 3)))
      }
    })
  }, [])

  const openPage = (id: string) => {
    setActiveView('vault')
    setActivePageId(id)
  }

  const goToCommand = () => setActiveView('command')

  if (loading) return <div className="nx-type-data">loading...</div>

  const previewTypeName = types.find((t) => t.id === commandTypeId)?.name ?? 'Command'

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
                  <Th>Type</Th>
                  <Th>Properties</Th>
                  <Th>Modified</Th>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.slice(0, 12).map((entry) => (
                  <TableRow key={entry.id} clickable onClick={() => openPage(entry.id)}>
                    <Td>{entry.title || 'Untitled'}</Td>
                    <Td className="nx-type-data">{types.find((t) => t.id === entry.type_id)?.name ?? entry.type_id}</Td>
                    <Td className="nx-type-data">{summarizeProperties(entry)}</Td>
                    <Td className="nx-type-data">{relativeTime(entry.updated_at)}</Td>
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
                <div className="nx-bar__fill" style={{ width: `${storage.withPropertiesPercent}%` }} />
              </div>
              <div className="nx-type-data">{storage.withPropertiesPercent}% with properties set</div>
            </>
          )}
        </Panel>

        <Panel title={`Command // ${previewTypeName}`}>
          {commandPreview.length === 0 ? (
            <button className="nx-atlas__link nx-type-data" onClick={goToCommand}>
              browse by type →
            </button>
          ) : (
            commandPreview.map((p) => (
              <div key={p.id} className="nx-directive-row" onClick={() => openPage(p.id)}>
                <span className="nx-type-body">{p.title || 'Untitled'}</span>
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
