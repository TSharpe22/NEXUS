import { useEffect, useState } from 'react'
import type { PageSummary, TypeDef, PropertyDefinition, Property } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import { EmptyState } from '../design/EmptyState'
import { Table, TableHead, TableBody, TableRow, Th, Td } from '../design/Table'
import { relativeTime } from '../hooks/use-relative-time'

function renderValue(def: PropertyDefinition, prop: Property | undefined): string {
  if (!prop) return '—'
  if (def.property_type === 'date') return prop.value_date ?? '—'
  if (def.property_type === 'number') return prop.value_number?.toString() ?? '—'
  if (def.property_type === 'multi_select') {
    try {
      const arr = JSON.parse(prop.value_text ?? '[]')
      return Array.isArray(arr) && arr.length ? arr.join(', ') : '—'
    } catch {
      return '—'
    }
  }
  if (def.property_type === 'boolean') return prop.value_text === 'true' ? 'yes' : 'no'
  return prop.value_text ?? '—'
}

export function Command() {
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setActivePageId = useAppStore((s) => s.setActivePageId)
  const commandTypeId = useAppStore((s) => s.commandTypeId)
  const setCommandTypeId = useAppStore((s) => s.setCommandTypeId)

  const [types, setTypes] = useState<TypeDef[]>([])
  const [definitions, setDefinitions] = useState<PropertyDefinition[]>([])
  const [entries, setEntries] = useState<PageSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.types.list().then((list) => {
      setTypes(list)
      if (!commandTypeId && list.length > 0) setCommandTypeId(list[0].id)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!commandTypeId) return
    Promise.all([window.api.types.getPropertyDefinitions(commandTypeId), window.api.pages.getAllSummary(commandTypeId)]).then(
      ([defs, pages]) => {
        setDefinitions(defs)
        setEntries(pages)
      }
    )
  }, [commandTypeId])

  const createInType = async () => {
    if (!commandTypeId) return
    const page = await window.api.pages.create(commandTypeId)
    setActiveView('vault')
    setActivePageId(page.id)
  }

  const openPage = (id: string) => {
    setActiveView('vault')
    setActivePageId(id)
  }

  if (loading) return <div className="nx-type-data">loading...</div>

  if (types.length === 0) {
    return (
      <EmptyState
        icon="diamond"
        text="No types yet"
        meta="create a page of a new type in Vault first — Command browses by type"
      />
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--nx-space-4)' }}>
        <div style={{ display: 'flex', gap: 'var(--nx-space-2)' }}>
          {types.map((t) => (
            <Button key={t.id} variant={commandTypeId === t.id ? 'primary' : 'ghost'} onClick={() => setCommandTypeId(t.id)}>
              {t.name}
            </Button>
          ))}
        </div>
        <Button onClick={createInType}>+ New</Button>
      </div>

      <Panel dense>
        {entries.length === 0 ? (
          <EmptyState icon="diamond" text="Nothing here yet" meta="create one with the button above" />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <Th>Name</Th>
                {definitions.map((def) => (
                  <Th key={def.id}>{def.name}</Th>
                ))}
                <Th>Modified</Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => {
                const byKey = Object.fromEntries(entry.properties.map((p) => [p.key, p]))
                return (
                  <TableRow key={entry.id} clickable onClick={() => openPage(entry.id)}>
                    <Td>{entry.title || 'Untitled'}</Td>
                    {definitions.map((def) => (
                      <Td key={def.id} className="nx-type-data">
                        {renderValue(def, byKey[def.key])}
                      </Td>
                    ))}
                    <Td className="nx-type-data">{relativeTime(entry.updated_at)}</Td>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  )
}
