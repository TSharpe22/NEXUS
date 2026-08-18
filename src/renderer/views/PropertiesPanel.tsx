import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import type { Page, Property, PropertyDefinition, PropertyType } from '@shared/types'
import { useAppStore } from '../store/app-store'
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
  { value: 'multi_select', label: 'Tags' },
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
  const types = useAppStore((s) => s.types)
  const setPageType = useAppStore((s) => s.setPageType)

  const [definitions, setDefinitions] = useState<PropertyDefinition[]>([])
  const [values, setValues] = useState<Record<string, Property>>({})
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<PropertyType>('text')

  const refresh = useCallback(async () => {
    const [defs, props] = await Promise.all([
      window.api.types.getPropertyDefinitions(page.type_id),
      window.api.properties.getForPage(page.id)
    ])
    setDefinitions(defs)
    setValues(Object.fromEntries(props.map((p) => [p.key, p])))
  }, [page.id, page.type_id])

  useEffect(() => {
    refresh()
  }, [refresh])

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

  const removeProperty = async (def: PropertyDefinition) => {
    const typeLabel = types.find((t) => t.id === page.type_id)?.name ?? 'this type'
    if (
      !window.confirm(
        `Remove "${def.name}" from ${typeLabel}? Its values will be cleared from every page of this type.`
      )
    ) {
      return
    }
    await window.api.types.removeProperty(def.id)
    await refresh()
    toast.success(`Removed "${def.name}"`)
  }

  return (
    <div className="nx-properties">
      <div className="nx-properties__header">
        <span className="nx-type-label">Properties</span>
        {/* A page's type was fixed at creation — the only way to change it was
            to make a new page. It drives the whole property schema, so it
            belongs here. */}
        <label className="nx-properties__type">
          <span className="nx-type-label">Type</span>
          <select
            className="nx-select"
            value={page.type_id}
            onChange={(e) => setPageType(page.id, e.target.value)}
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {definitions.length === 0 && !adding && (
        <div className="nx-properties__hint">
          No properties yet — adding one applies it to every page of this type.
        </div>
      )}

      {definitions.map((def) => (
        <PropertyRow
          key={def.id}
          def={def}
          value={values[def.key]}
          onSave={(v) => save(def, v)}
          onRemove={() => removeProperty(def)}
        />
      ))}

      {adding ? (
        <div className="nx-properties__add-form">
          <input
            className="nx-input"
            style={{ width: 150 }}
            placeholder="Property name"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addProperty()
              if (e.key === 'Escape') {
                setAdding(false)
                setNewName('')
              }
            }}
          />
          <select
            className="nx-select"
            value={newType}
            onChange={(e) => setNewType(e.target.value as PropertyType)}
          >
            {PROPERTY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <Button onClick={addProperty}>Add</Button>
          <Button variant="quiet" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <button className="nx-properties__add-btn" onClick={() => setAdding(true)}>
          + Add property
        </button>
      )}
    </div>
  )
}

function PropertyRow({
  def,
  value,
  onSave,
  onRemove
}: {
  def: PropertyDefinition
  value: Property | undefined
  onSave: (value: string | number | null) => void
  onRemove: () => void
}) {
  const current = valueOf(value)

  const field = (() => {
    if (def.property_type === 'multi_select') {
      return <MultiSelectField def={def} value={typeof current === 'string' ? current : null} onSave={onSave} />
    }

    if (def.property_type === 'boolean') {
      return (
        <input
          type="checkbox"
          className="nx-properties__checkbox"
          checked={current === 'true'}
          onChange={(e) => onSave(e.target.checked ? 'true' : 'false')}
        />
      )
    }

    if (def.property_type === 'date') {
      return (
        <input
          type="date"
          className="nx-input"
          // Keyed by the stored value so an external change (duplicating a
          // page, switching pages) refreshes an uncontrolled input.
          key={String(current ?? '')}
          defaultValue={typeof current === 'string' ? current : ''}
          onBlur={(e) => onSave(e.target.value || null)}
        />
      )
    }

    if (def.property_type === 'number') {
      return (
        <input
          type="number"
          className="nx-input"
          key={String(current ?? '')}
          defaultValue={typeof current === 'number' ? current : ''}
          onBlur={(e) => onSave(e.target.value === '' ? null : Number(e.target.value))}
        />
      )
    }

    // text, select, url, relation — a plain text field for now
    return (
      <input
        type={def.property_type === 'url' ? 'url' : 'text'}
        className="nx-input"
        key={String(current ?? '')}
        placeholder="Empty"
        defaultValue={typeof current === 'string' ? current : ''}
        onBlur={(e) => onSave(e.target.value || null)}
      />
    )
  })()

  return (
    <div className="nx-properties__row">
      <span className="nx-properties__row-label" title={def.name}>
        {def.name}
      </span>
      <span className="nx-properties__row-field">{field}</span>
      <button className="nx-properties__remove" onClick={onRemove} title={`Remove ${def.name}`} aria-label={`Remove ${def.name}`}>
        ×
      </button>
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
  const [highlight, setHighlight] = useState(0)

  // Values already used for this property elsewhere, so a multi-select behaves
  // like a real select instead of asking you to retype a value you have used
  // ten times before. Loaded once per property and filtered locally.
  const [known, setKnown] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    window.api.properties.knownValues(def.key).then((values) => {
      if (!cancelled) setKnown(values)
    })
    return () => {
      cancelled = true
    }
  }, [def.key, value])

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase()
    return known
      .filter((v) => !items.includes(v))
      .filter((v) => (q ? v.toLowerCase().includes(q) : true))
      .slice(0, 6)
  }, [known, draft, items])

  const commit = (next: string[]) => onSave(JSON.stringify(next))
  const add = (raw: string) => {
    const v = raw.trim()
    if (v && !items.includes(v)) commit([...items, v])
    setDraft('')
    setHighlight(0)
  }

  return (
    <div className="nx-properties__tags">
      {items.map((item) => (
        <span key={item} className="nx-tag-chip nx-tag-chip--accent">
          <span className="nx-tag-chip__label">{item}</span>
          <button
            className="nx-tag-chip__x"
            aria-label={`Remove ${item}`}
            onClick={() => commit(items.filter((i) => i !== item))}
          >
            ×
          </button>
        </span>
      ))}

      <span className="nx-properties__tag-field">
        <input
          className="nx-properties__tag-input"
          placeholder={`Add ${def.name.toLowerCase()}…`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && suggestions.length) {
              e.preventDefault()
              setHighlight((h) => (h + 1) % suggestions.length)
              return
            }
            if (e.key === 'ArrowUp' && suggestions.length) {
              e.preventDefault()
              setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length)
              return
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft.trim() ? draft : (suggestions[highlight] ?? ''))
              return
            }
            // Backspace on an empty field removes the last tag — standard for
            // this control and quicker than aiming at a 10px ×.
            if (e.key === 'Backspace' && !draft && items.length) {
              commit(items.slice(0, -1))
            }
          }}
          onBlur={() => add(draft)}
        />

        {draft.trim() !== '' && suggestions.length > 0 && (
          <span className="nx-properties__tag-menu">
            {suggestions.map((option, i) => (
              <button
                key={option}
                className={`nx-tagbar__option ${i === highlight ? 'is-highlighted' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(option)}
              >
                <span className="nx-tagbar__name">{option}</span>
              </button>
            ))}
          </span>
        )}
      </span>
    </div>
  )
}
