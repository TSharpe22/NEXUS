import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { PageSummary, PropertyDefinition, Property } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import { EmptyState } from '../design/EmptyState'
import { Table, TableHead, TableBody, TableRow, Th, Td } from '../design/Table'
import { relativeTime } from '../hooks/use-relative-time'
import './Tables.css'

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
  if (def.property_type === 'boolean') return prop.value_text === 'true' ? 'Yes' : 'No'
  return prop.value_text || '—'
}

export function Tables() {
  const { types, pages, tableTypeId, setTableTypeId, openPage, createPage, renameType, deleteType } = useAppStore()

  const [definitions, setDefinitions] = useState<PropertyDefinition[]>([])
  const [entries, setEntries] = useState<PageSummary[]>([])
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [templatePageId, setTemplatePageId] = useState<string | null>(null)

  const activeTypeId = tableTypeId ?? types[0]?.id ?? null
  const activeType = types.find((t) => t.id === activeTypeId) ?? null

  const load = useCallback(async () => {
    if (!activeTypeId) return
    const [defs, rows, template] = await Promise.all([
      window.api.types.getPropertyDefinitions(activeTypeId),
      window.api.pages.getAllSummary(activeTypeId),
      window.api.types.getTemplate(activeTypeId)
    ])
    setDefinitions(defs)
    setEntries(rows)
    setTemplatePageId(template?.id ?? null)
  }, [activeTypeId])

  const applyTemplate = async (pageId: string | null) => {
    if (!activeTypeId) return
    try {
      await window.api.types.setTemplate(activeTypeId, pageId)
      setTemplatePageId(pageId)
      toast.success(pageId ? 'Template set for this type' : 'Template cleared')
    } catch (e) {
      console.error('[nexus] could not set the template', e)
      toast.error('Could not set the template')
    }
  }

  // `pages` in the deps so a page created, retyped or trashed anywhere else
  // updates this table too.
  useEffect(() => {
    load()
  }, [load, pages])

  const commitRename = async () => {
    const name = draftName.trim()
    setRenaming(false)
    if (!name || !activeType || name === activeType.name) return
    try {
      await renameType(activeType.id, name)
    } catch {
      toast.error(`A type named "${name}" already exists`)
    }
  }

  const handleDeleteType = async () => {
    if (!activeType) return
    const count = entries.length
    const warning =
      count === 0
        ? `Delete the type "${activeType.name}"?`
        : `Delete the type "${activeType.name}"? Its ${count} page${count === 1 ? '' : 's'} will be kept and moved to the Note type.`
    if (!window.confirm(warning)) return
    try {
      const { reassigned } = await deleteType(activeType.id)
      toast.success(
        reassigned > 0
          ? `Type deleted — ${reassigned} page${reassigned === 1 ? '' : 's'} moved to Note`
          : 'Type deleted'
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete type')
    }
  }

  if (types.length === 0) {
    return <EmptyState text="No types yet" meta="Types are created from the Notes view when you add a page." />
  }

  return (
    <div className="nx-tables">
      <div className="nx-tables__bar">
        <div className="nx-tables__types">
          {types.map((t) => (
            <Button
              key={t.id}
              variant={activeTypeId === t.id ? 'selected' : 'quiet'}
              onClick={() => setTableTypeId(t.id)}
            >
              {t.name}
            </Button>
          ))}
        </div>

        <div className="nx-tables__actions">
          {activeType && (
            <select
              className="nx-select"
              value={templatePageId ?? ''}
              onChange={(e) => applyTemplate(e.target.value || null)}
              title="New pages of this type start from a copy of the template"
            >
              <option value="">No template</option>
              {entries.map((r) => (
                <option key={r.id} value={r.id}>
                  Template: {r.title || 'Untitled'}
                </option>
              ))}
            </select>
          )}
          {activeType && activeType.id !== 'note' && (
            <>
              {renaming ? (
                <input
                  className="nx-input"
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setRenaming(false)
                  }}
                />
              ) : (
                <Button
                  variant="quiet"
                  onClick={() => {
                    setDraftName(activeType.name)
                    setRenaming(true)
                  }}
                >
                  Rename
                </Button>
              )}
              <Button variant="quiet" onClick={handleDeleteType}>
                Delete type
              </Button>
            </>
          )}
          <Button onClick={() => activeTypeId && createPage(activeTypeId)}>New</Button>
        </div>
      </div>

      <Panel dense>
        {entries.length === 0 ? (
          <EmptyState
            text={`No ${activeType?.name ?? 'pages'} yet`}
            meta="Create one, then add properties to it from the page itself — the columns here follow that type's properties."
            action={<Button onClick={() => activeTypeId && createPage(activeTypeId)}>New page</Button>}
          />
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

      {definitions.length === 0 && entries.length > 0 && (
        <div className="nx-tables__hint nx-type-data">
          This type has no properties yet — open a page and use “+ Add property” to give it columns.
        </div>
      )}
    </div>
  )
}
