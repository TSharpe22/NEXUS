import { useEffect, useState } from 'react'
import type { PageSummary, DirectiveStatus } from '@shared/types'
import { DIRECTIVE_STATUSES } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import { EmptyState } from '../design/EmptyState'
import { StatusDot } from '../design/StatusDot'
import { Table, TableHead, TableBody, TableRow, Th, Td } from '../design/Table'
import { relativeTime } from '../hooks/use-relative-time'

const STATUS_TO_DOT: Record<string, 'active' | 'pending' | 'done'> = {
  active: 'active',
  pending: 'pending',
  done: 'done'
}

export function Command() {
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setActivePageId = useAppStore((s) => s.setActivePageId)

  const [directives, setDirectives] = useState<PageSummary[]>([])
  const [filter, setFilter] = useState<DirectiveStatus | 'all'>('all')
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    setDirectives(await window.api.pages.getAllSummary('directive'))
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [])

  const createDirective = async () => {
    const page = await window.api.pages.create('directive')
    await window.api.pages.update(page.id, { title: 'New directive' })
    await window.api.properties.set(page.id, 'status', 'select', 'active')
    await refresh()
    setActiveView('vault')
    setActivePageId(page.id)
  }

  const openPage = (id: string) => {
    setActiveView('vault')
    setActivePageId(id)
  }

  const visible = filter === 'all' ? directives : directives.filter((d) => d.status === filter)

  if (loading) return <div className="nx-type-data">loading...</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--nx-space-4)' }}>
        <div style={{ display: 'flex', gap: 'var(--nx-space-2)' }}>
          {(['all', ...DIRECTIVE_STATUSES] as const).map((s) => (
            <Button key={s} variant={filter === s ? 'primary' : 'ghost'} onClick={() => setFilter(s)}>
              {s}
            </Button>
          ))}
        </div>
        <Button onClick={createDirective}>+ New Directive</Button>
      </div>

      <Panel dense>
        {visible.length === 0 ? (
          <EmptyState icon="diamond" text="No directives" meta="create one to start tracking it" />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <Th>Directive</Th>
                <Th>Status</Th>
                <Th>Modified</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((d) => (
                <TableRow key={d.id} clickable onClick={() => openPage(d.id)}>
                  <Td>{d.title || 'Untitled'}</Td>
                  <Td>
                    <StatusDot status={STATUS_TO_DOT[d.status ?? 'active'] ?? 'active'} label={d.status ?? 'active'} />
                  </Td>
                  <Td className="nx-type-data">{relativeTime(d.updated_at)}</Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  )
}
