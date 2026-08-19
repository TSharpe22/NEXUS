import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const setSaveStatus = useAppStore((s) => s.setSaveStatus)

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

  /**
   * Saving a value no longer refetches the panel. A value cannot change the
   * type's schema, so the round trip only remounted every row — and it left
   * the save itself completely silent. `properties.set` hands back the row as
   * stored, which is exactly what the local copy should become.
   */
  const save = async (def: PropertyDefinition, value: string | number | null) => {
    setSaveStatus('saving')
    try {
      const stored = await window.api.properties.set(page.id, def.key, def.property_type, value)
      setValues((prev) => ({ ...prev, [def.key]: stored }))
      setSaveStatus('saved')
    } catch (e) {
      console.error('[nexus] failed to save property', e)
      setSaveStatus('error')
      toast.error(`Could not save "${def.name}"`)
    }
  }

  const addProperty = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      await window.api.types.defineProperty(page.type_id, name, newType)
    } catch (e) {
      // The main process refuses a name that collides with an existing key
      // rather than silently retyping it, so there is something to say here.
      toast.error(e instanceof Error ? e.message.replace(/^\[.*?\]\s*/, '') : 'Could not add that property')
      return
    }
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

    if (def.property_type === 'select') {
      return <SelectField def={def} value={typeof current === 'string' ? current : null} onSave={onSave} />
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

    // text, number, date, url, relation — a single scalar field.
    return <ScalarField def={def} current={current} onSave={onSave} />
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

/**
 * The scalar editors — text, number, date, url.
 *
 * These were uncontrolled inputs remounted by a `key` on their own value, and
 * they only ever saved on blur: Enter did nothing and Escape did nothing, so
 * typing a value and pressing Enter looked like the app had ignored it. A
 * controlled draft synced from the stored value gives all three a real
 * commit/cancel, and the last-committed ref keeps Enter-then-blur from
 * sending the same value twice.
 */
function ScalarField({
  def,
  current,
  onSave
}: {
  def: PropertyDefinition
  current: string | number | null
  onSave: (value: string | number | null) => void
}) {
  const stored = current === null || current === undefined ? '' : String(current)
  const [draft, setDraft] = useState(stored)
  const lastCommitted = useRef(stored)
  // Escape reverts and then blurs, and the blur handler still closes over the
  // pre-revert draft — without this flag cancelling would commit the very edit
  // it was cancelling.
  const cancelling = useRef(false)

  useEffect(() => {
    setDraft(stored)
    lastCommitted.current = stored
  }, [stored])

  const commit = (next = draft) => {
    if (next === lastCommitted.current) return
    lastCommitted.current = next
    if (def.property_type === 'number') {
      const parsed = Number(next)
      onSave(next.trim() === '' || Number.isNaN(parsed) ? null : parsed)
      return
    }
    onSave(next || null)
  }

  const inputType =
    def.property_type === 'number' ? 'number' : def.property_type === 'date' ? 'date' : def.property_type === 'url' ? 'url' : 'text'

  return (
    <input
      type={inputType}
      className="nx-input"
      placeholder="Empty"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        // A date comes from a picker rather than typing, so there is no
        // meaningful "still editing" state to wait out.
        if (def.property_type === 'date') commit(e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          cancelling.current = true
          setDraft(lastCommitted.current)
          e.currentTarget.blur()
        }
      }}
      onBlur={() => {
        if (cancelling.current) {
          cancelling.current = false
          return
        }
        commit()
      }}
    />
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

/** Values already recorded for a property key, anywhere in the vault. */
function useKnownValues(key: string, active: boolean, revision: unknown): string[] {
  const [known, setKnown] = useState<string[]>([])
  useEffect(() => {
    if (!active) return
    let cancelled = false
    window.api.properties.knownValues(key).then((values) => {
      if (!cancelled) setKnown(values)
    })
    return () => {
      cancelled = true
    }
  }, [key, active, revision])
  return known
}

/**
 * A select is a single value drawn from the ones already in use for this
 * property — the same source `multi_select` suggests from, so the two behave
 * consistently. It offered no editor at all before and fell through to a plain
 * text box, which is to say it was not a select.
 */
function SelectField({
  def,
  value,
  onSave
}: {
  def: PropertyDefinition
  value: string | null
  onSave: (value: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [highlight, setHighlight] = useState(0)
  const known = useKnownValues(def.key, editing, value)

  const options = useMemo(() => {
    const q = draft.trim().toLowerCase()
    return known.filter((v) => (q ? v.toLowerCase().includes(q) : true)).slice(0, 8)
  }, [known, draft])

  const choose = (next: string | null) => {
    const clean = next?.trim() ?? ''
    onSave(clean || null)
    setDraft('')
    setHighlight(0)
    setEditing(false)
  }

  if (!editing) {
    return (
      <span className="nx-properties__select">
        {value ? (
          <span className="nx-tag-chip nx-tag-chip--accent">
            <button className="nx-tag-chip__label" onClick={() => setEditing(true)}>
              {value}
            </button>
            <button className="nx-tag-chip__x" aria-label={`Clear ${def.name}`} onClick={() => choose(null)}>
              ×
            </button>
          </span>
        ) : (
          <button className="nx-properties__select-empty" onClick={() => setEditing(true)}>
            Empty
          </button>
        )}
      </span>
    )
  }

  return (
    <span className="nx-properties__tag-field">
      <input
        className="nx-properties__tag-input"
        autoFocus
        placeholder={`Set ${def.name.toLowerCase()}…`}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setHighlight(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && options.length) {
            e.preventDefault()
            setHighlight((h) => (h + 1) % options.length)
            return
          }
          if (e.key === 'ArrowUp' && options.length) {
            e.preventDefault()
            setHighlight((h) => (h - 1 + options.length) % options.length)
            return
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            // An existing option wins over the raw text — that is what makes
            // this a constrained list. Free text is the fallback, because the
            // first value of a new select has to come from somewhere.
            if (options[highlight]) choose(options[highlight])
            else if (draft.trim()) choose(draft)
            else setEditing(false)
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            setDraft('')
            setEditing(false)
          }
        }}
        // Abandoning the field discards the draft rather than committing it:
        // picking is the primary action here, and the options below use
        // mousedown so a click still lands.
        onBlur={() => {
          setDraft('')
          setEditing(false)
        }}
      />

      {options.length > 0 && (
        <span className="nx-properties__tag-menu">
          {options.map((option, i) => (
            <button
              key={option}
              className={`nx-tagbar__option ${i === highlight ? 'is-highlighted' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(option)}
            >
              <span className="nx-tagbar__name">{option}</span>
            </button>
          ))}
        </span>
      )}
    </span>
  )
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
  const known = useKnownValues(def.key, true, value)

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
