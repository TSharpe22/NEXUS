import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import type { PageSummary, PropertyDefinition, Property } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import { confirmDialog } from '../design/Confirm'
import { EmptyState } from '../design/EmptyState'
import { Table, TableHead, TableBody, TableRow, Th, Td } from '../design/Table'
import { relativeTime } from '../hooks/use-relative-time'
import { usePageTitles } from '../hooks/use-page-titles'
import './Tables.css'

type TitleLookup = (id: string | null | undefined) => string | null

function renderValue(def: PropertyDefinition, prop: Property | undefined, titleOf: TitleLookup): string {
  if (!prop) return '—'
  // A relation holds an id; printing that verbatim is unreadable, and this
  // column showed a permanent '—' because it read the wrong field entirely.
  if (def.property_type === 'relation') {
    if (!prop.value_relation) return '—'
    return titleOf(prop.value_relation) ?? 'Missing page'
  }
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

type SortDirection = 'asc' | 'desc'
type Sort = { column: string; direction: SortDirection } | null

/** The two columns that aren't property definitions. */
const TITLE_COLUMN = '\u0000title'
const MODIFIED_COLUMN = '\u0000modified'

/**
 * What a row is worth for the purpose of ordering — typed per property, so a
 * number column sorts 2 before 10 and a date column sorts chronologically
 * rather than by the shape of the string.
 */
function sortValue(
  entry: PageSummary,
  column: string,
  definitions: PropertyDefinition[],
  titleOf: TitleLookup
): string | number | null {
  if (column === TITLE_COLUMN) return (entry.title || 'Untitled').toLowerCase()
  if (column === MODIFIED_COLUMN) return entry.updated_at

  const def = definitions.find((d) => d.key === column)
  const prop = entry.properties.find((p) => p.key === column)
  if (!def || !prop) return null

  switch (def.property_type) {
    case 'number':
      return prop.value_number
    case 'date':
      return prop.value_date
    case 'boolean':
      return prop.value_text === 'true' ? 1 : 0
    case 'relation':
      return titleOf(prop.value_relation)?.toLowerCase() ?? null
    default:
      // multi_select included: renderValue already flattens it to the same
      // text the cell shows, so sorting matches what is on screen.
      return renderValue(def, prop, titleOf).toLowerCase()
  }
}

const isBlank = (v: string | number | null) => v === null || v === undefined || v === '' || v === '—'

function compare(a: string | number | null, b: string | number | null, direction: SortDirection): number {
  // Empty cells sink to the bottom whichever way the column is pointing —
  // ascending by a half-filled column is useless if every blank comes first.
  if (isBlank(a) && isBlank(b)) return 0
  if (isBlank(a)) return 1
  if (isBlank(b)) return -1

  const cmp = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))
  return direction === 'asc' ? cmp : -cmp
}

export function Tables() {
  const { types, pages, tableTypeId, setTableTypeId, openPage, createPage, renameType, deleteType } = useAppStore()

  const titleOf = usePageTitles()

  const [definitions, setDefinitions] = useState<PropertyDefinition[]>([])
  const [entries, setEntries] = useState<PageSummary[]>([])
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [sort, setSort] = useState<Sort>(null)
  const [query, setQuery] = useState('')
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

  // A sort or filter belongs to the type it was set on: carrying "sort by
  // Status" onto a type with no Status column would silently do nothing.
  useEffect(() => {
    setSort(null)
    setQuery('')
  }, [activeTypeId])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? entries.filter((entry) => {
          if ((entry.title || 'Untitled').toLowerCase().includes(q)) return true
          const byKey = Object.fromEntries(entry.properties.map((p) => [p.key, p]))
          // Matched against what the cell actually shows, so searching for a
          // relation's target or a tag finds the row the same as its title.
          return definitions.some((def) => renderValue(def, byKey[def.key], titleOf).toLowerCase().includes(q))
        })
      : entries

    if (!sort) return filtered

    // `entries` arrives newest-first and sort is stable, so rows that tie on
    // the sorted column keep that order underneath.
    return [...filtered].sort((a, b) =>
      compare(sortValue(a, sort.column, definitions, titleOf), sortValue(b, sort.column, definitions, titleOf), sort.direction)
    )
  }, [entries, definitions, sort, query, titleOf])

  // Ascending, then descending, then back to the default newest-first order.
  const toggleSort = (column: string) =>
    setSort((prev) => {
      if (prev?.column !== column) return { column, direction: 'asc' }
      if (prev.direction === 'asc') return { column, direction: 'desc' }
      return null
    })
  const directionFor = (column: string) => (sort?.column === column ? sort.direction : null)

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
    const accepted = await confirmDialog({
      title: `Delete the type "${activeType.name}"?`,
      message:
        count === 0
          ? 'It has no pages.'
          : `Its ${count} page${count === 1 ? '' : 's'} will be kept and moved to the Note type.`,
      confirmLabel: 'Delete type',
      danger: true
    })
    if (!accepted) return
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
          {entries.length > 0 && (
            <input
              className="nx-input nx-tables__filter"
              placeholder={`Filter ${activeType?.name ?? 'pages'}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('')
              }}
            />
          )}
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
                <Th sort={directionFor(TITLE_COLUMN)} onClick={() => toggleSort(TITLE_COLUMN)}>
                  Name
                </Th>
                {definitions.map((def) => (
                  <Th key={def.id} sort={directionFor(def.key)} onClick={() => toggleSort(def.key)}>
                    {def.name}
                  </Th>
                ))}
                <Th sort={directionFor(MODIFIED_COLUMN)} onClick={() => toggleSort(MODIFIED_COLUMN)}>
                  Modified
                </Th>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((entry) => {
                const byKey = Object.fromEntries(entry.properties.map((p) => [p.key, p]))
                return (
                  <TableRow key={entry.id} clickable onClick={() => openPage(entry.id)}>
                    <Td>{entry.title || 'Untitled'}</Td>
                    {definitions.map((def) => (
                      <Td key={def.id} className="nx-type-data">
                        {renderValue(def, byKey[def.key], titleOf)}
                      </Td>
                    ))}
                    <Td className="nx-type-data">{relativeTime(entry.updated_at)}</Td>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        {entries.length > 0 && rows.length === 0 && (
          <EmptyState text="Nothing matches that filter" meta={`No ${activeType?.name ?? 'page'} contains “${query}”.`} />
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
