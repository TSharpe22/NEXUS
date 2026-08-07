import { useEffect, useState } from 'react'
import type { Page, Property, PropertyDefinition, PropertyType } from '@shared/types'
import { Button } from '../design/Button'

interface Props {
  page: Page
}

const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Checkbox' },
  { value: 'select', label: 'Select' },
  { value: 'multi_select', label: 'Multi-select' },
  { value: 'url', label: 'URL' },
  { value: 'relation', label: 'Relation' }
]

function valueOf(prop: Property | undefined): string | number | null {
  if (!prop) return null
  if (prop.type === 'date') return prop.value_date
  if (prop.type === 'number') return prop.value_number
  if (prop.type === 'relation') return prop.value_relation
  return prop.value_text
}

export function PropertiesPanel({ page }: Props) {
  const [definitions, setDefinitions] = useState<PropertyDefinition[]>([])
  const [values, setValues] = useState<Record<string, Property>>({})
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<PropertyType>('text')

  const refresh = async () => {
    const [defs, props] = await Promise.all([
      window.api.types.getPropertyDefinitions(page.type_id),
      window.api.properties.getForPage(page.id)
    ])
    setDefinitions(defs)
    setValues(Object.fromEntries(props.map((p) => [p.key, p])))
  }

  useEffect(() => {
    refresh()
  }, [page.id, page.type_id])

  const save = async (def: PropertyDefinition, value: string | number | null) => {
    await window.api.properties.set(page.id, def.key, def.property_type, value)
    await refresh()
  }

  const addProperty = async () => {
    const name = newName.trim()
    if (!name) return
    await window.api.types.defineProperty(page.type_id, name, newType)
    setNewName('')
    setNewType('text')
    setAdding(false)
    await refresh()
  }

  return (
    <div className="nx-properties">
      {definitions.map((def) => (
        <PropertyRow key={def.id} def={def} value={values[def.key]} onSave={(v) => save(def, v)} />
      ))}

      {adding ? (
        <div className="nx-properties__row nx-properties__add-form">
          <input
            className="nx-properties__tag-input"
            style={{ width: 140 }}
            placeholder="property name"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addProperty()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
          <select
            className="nx-properties__type-select"
            value={newType}
            onChange={(e) => setNewType(e.target.value as PropertyType)}
          >
            {PROPERTY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <Button variant="ghost" onClick={addProperty}>
            Add
          </Button>
        </div>
      ) : (
        <button className="nx-properties__add-btn nx-type-label" onClick={() => setAdding(true)}>
          + Add property
        </button>
      )}
    </div>
  )
}

function PropertyRow({
  def,
  value,
  onSave
}: {
  def: PropertyDefinition
  value: Property | undefined
  onSave: (value: string | number | null) => void
}) {
  const current = valueOf(value)

  if (def.property_type === 'multi_select') {
    return <MultiSelectField def={def} value={typeof current === 'string' ? current : null} onSave={onSave} />
  }

  if (def.property_type === 'boolean') {
    return (
      <div className="nx-properties__row">
        <span className="nx-type-label">{def.name}</span>
        <input type="checkbox" checked={current === 'true'} onChange={(e) => onSave(e.target.checked ? 'true' : 'false')} />
      </div>
    )
  }

  if (def.property_type === 'date') {
    return (
      <div className="nx-properties__row">
        <span className="nx-type-label">{def.name}</span>
        <input
          type="date"
          className="nx-properties__tag-input"
          defaultValue={typeof current === 'string' ? current : ''}
          onBlur={(e) => onSave(e.target.value || null)}
        />
      </div>
    )
  }

  if (def.property_type === 'number') {
    return (
      <div className="nx-properties__row">
        <span className="nx-type-label">{def.name}</span>
        <input
          type="number"
          className="nx-properties__tag-input"
          defaultValue={typeof current === 'number' ? current : ''}
          onBlur={(e) => onSave(e.target.value === '' ? null : Number(e.target.value))}
        />
      </div>
    )
  }

  // text, select, url, relation — all a plain text field for now
  return (
    <div className="nx-properties__row">
      <span className="nx-type-label">{def.name}</span>
      <input
        type={def.property_type === 'url' ? 'url' : 'text'}
        className="nx-properties__tag-input"
        style={{ width: 160 }}
        defaultValue={typeof current === 'string' ? current : ''}
        onBlur={(e) => onSave(e.target.value || null)}
      />
    </div>
  )
}

function parseList(raw: string | null): string[] {
  try {
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function MultiSelectField({
  def,
  value,
  onSave
}: {
  def: PropertyDefinition
  value: string | null
  onSave: (value: string) => void
}) {
  const items = parseList(value)
  const [draft, setDraft] = useState('')

  const commit = (next: string[]) => onSave(JSON.stringify(next))
  const add = () => {
    const v = draft.trim()
    if (v && !items.includes(v)) commit([...items, v])
    setDraft('')
  }

  return (
    <div className="nx-properties__row">
      <span className="nx-type-label">{def.name}</span>
      <div className="nx-properties__tags">
        {items.map((item) => (
          <span key={item} className="nx-properties__tag">
            {item}
            <button onClick={() => commit(items.filter((i) => i !== item))} aria-label={`Remove ${item}`}>
              ×
            </button>
          </span>
        ))}
        <input
          className="nx-properties__tag-input"
          placeholder={`+ ${def.name.toLowerCase()}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          onBlur={add}
        />
      </div>
    </div>
  )
}
