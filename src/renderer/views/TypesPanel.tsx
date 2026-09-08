import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import { confirmDialog } from '../design/Confirm'
import { useAppStore } from '../store/app-store'
import type { PropertyDefinition, PropertyType } from '@shared/types'

/**
 * Types, and the properties that hang off them.
 *
 * This used to live nowhere. A type could only be *created* from a magic
 * `__new__` entry inside the type dropdown in the Notes sidebar, and could
 * only be renamed or deleted from Tables — so the architecture the app is
 * built on was managed from two places, neither of which said "types". A
 * property could only be added from a page's own panel, which meant defining
 * one on a type you had no page of was impossible.
 *
 * It sits in Settings because a type is configuration, not content: it
 * describes the vault rather than living in it.
 */

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

/**
 * A habit is a type carrying a date and a checkbox — there is no habit table
 * and no habit type, and `repo.getHabitCandidates()` is the whole of the
 * detection. Saying so here is what turns "why is there nothing in Habits"
 * into something you can act on.
 */
function isHabitShaped(defs: PropertyDefinition[]): boolean {
  return (
    defs.some((d) => d.property_type === 'date') &&
    defs.some((d) => d.property_type === 'boolean')
  )
}

export function TypesPanel() {
  const types = useAppStore((s) => s.types)
  const pages = useAppStore((s) => s.pages)
  const createType = useAppStore((s) => s.createType)
  const renameType = useAppStore((s) => s.renameType)
  const deleteType = useAppStore((s) => s.deleteType)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [defs, setDefs] = useState<PropertyDefinition[]>([])
  const [templateId, setTemplateId] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')

  const [addingProperty, setAddingProperty] = useState(false)
  const [propName, setPropName] = useState('')
  const [propType, setPropType] = useState<PropertyType>('text')

  // Fall back to the first type rather than showing nothing: there is always
  // at least the seeded Note, so an empty right-hand side would only ever mean
  // "you have not clicked yet".
  const activeId = selectedId && types.some((t) => t.id === selectedId) ? selectedId : types[0]?.id ?? null
  const active = types.find((t) => t.id === activeId) ?? null
  const pageCount = pages.filter((p) => p.type_id === activeId).length

  const loadDefs = useCallback(async (typeId: string | null) => {
    if (!typeId) {
      setDefs([])
      setTemplateId(null)
      return
    }
    const [definitions, template] = await Promise.all([
      window.api.types.getPropertyDefinitions(typeId),
      window.api.types.getTemplate(typeId)
    ])
    setDefs(definitions)
    setTemplateId(template?.id ?? null)
  }, [])

  useEffect(() => {
    void loadDefs(activeId)
  }, [activeId, loadDefs])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      const type = await createType(name)
      setSelectedId(type.id)
      setNewName('')
      setCreating(false)
    } catch {
      toast.error(`A type named "${name}" already exists`)
    }
  }

  /**
   * A type with the two properties the year grid reads, made in one step.
   * Four separate actions in three views is what "you cannot make a habit"
   * actually meant.
   */
  const handleCreateHabit = async () => {
    const name = newName.trim() || 'Habit'
    try {
      const type = await createType(name)
      await window.api.types.defineProperty(type.id, 'Date', 'date')
      await window.api.types.defineProperty(type.id, 'Done', 'boolean')
      setSelectedId(type.id)
      setNewName('')
      setCreating(false)
      await loadDefs(type.id)
      toast.success(`"${name}" is ready — it will show in the Tracker's habit grid`)
    } catch {
      toast.error(`A type named "${name}" already exists`)
    }
  }

  const commitRename = async () => {
    const name = draftName.trim()
    setRenaming(false)
    if (!name || !active || name === active.name) return
    try {
      await renameType(active.id, name)
    } catch {
      toast.error(`A type named "${name}" already exists`)
    }
  }

  const handleDelete = async () => {
    if (!active) return
    const accepted = await confirmDialog({
      title: `Delete the type "${active.name}"?`,
      message:
        pageCount === 0
          ? 'It has no pages.'
          : `Its ${pageCount} page${pageCount === 1 ? '' : 's'} will be kept and moved to the Note type.`,
      confirmLabel: 'Delete type',
      danger: true
    })
    if (!accepted) return
    try {
      const { reassigned } = await deleteType(active.id)
      setSelectedId(null)
      toast.success(
        reassigned > 0
          ? `Type deleted — ${reassigned} page${reassigned === 1 ? '' : 's'} moved to Note`
          : 'Type deleted'
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete type')
    }
  }

  const handleAddProperty = async () => {
    const name = propName.trim()
    if (!name || !active) return
    try {
      await window.api.types.defineProperty(active.id, name, propType)
      setPropName('')
      setPropType('text')
      setAddingProperty(false)
      await loadDefs(active.id)
    } catch (e) {
      // A second name that slugifies onto an existing key is refused rather
      // than silently retyping the first — the message comes from main.
      toast.error(e instanceof Error ? e.message : 'Could not add the property')
    }
  }

  const handleRemoveProperty = async (def: PropertyDefinition) => {
    const accepted = await confirmDialog({
      title: `Remove "${def.name}" from ${active?.name}?`,
      message: 'Its value is cleared from every page of this type. The pages themselves are kept.',
      confirmLabel: 'Remove property',
      danger: true
    })
    if (!accepted) return
    await window.api.types.removeProperty(def.id)
    await loadDefs(active?.id ?? null)
  }

  const handleSetTemplate = async (pageId: string | null) => {
    if (!active) return
    await window.api.types.setTemplate(active.id, pageId)
    setTemplateId(pageId)
  }

  return (
    <Panel
      title="Types"
      actions={
        !creating && (
          <Button variant="ghost" onClick={() => setCreating(true)}>
            New type
          </Button>
        )
      }
    >
      <div className="nx-type-data nx-types__note">
        A type is a set of properties a page can carry. Nothing needs one — a page with no type
        keeps working exactly as it does now.
      </div>

      {creating && (
        <div className="nx-types__create">
          <input
            className="nx-input"
            autoFocus
            placeholder="New type name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate()
              if (e.key === 'Escape') {
                setCreating(false)
                setNewName('')
              }
            }}
          />
          <Button onClick={() => void handleCreate()} disabled={!newName.trim()}>
            Create
          </Button>
          <Button variant="ghost" onClick={() => void handleCreateHabit()}>
            Create as habit
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setCreating(false)
              setNewName('')
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      <div className="nx-types__list">
        {types.map((t) => (
          <Button
            key={t.id}
            variant={activeId === t.id ? 'selected' : 'quiet'}
            onClick={() => {
              setSelectedId(t.id)
              setRenaming(false)
            }}
          >
            {t.name}
          </Button>
        ))}
      </div>

      {active && (
        <div className="nx-types__detail">
          <div className="nx-settings__row">
            <div>
              {renaming ? (
                <input
                  className="nx-input"
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename()
                    if (e.key === 'Escape') setRenaming(false)
                  }}
                />
              ) : (
                <div className="nx-type-body">{active.name}</div>
              )}
              <div className="nx-type-data">
                {pageCount} page{pageCount === 1 ? '' : 's'}
                {isHabitShaped(defs) && ' · shows in the Tracker as a habit'}
              </div>
            </div>
            <div className="nx-settings__actions">
              <Button
                variant="ghost"
                onClick={() => {
                  setDraftName(active.name)
                  setRenaming(true)
                }}
              >
                Rename
              </Button>
              <Button variant="ghost" onClick={() => void handleDelete()}>
                Delete
              </Button>
            </div>
          </div>

          <div className="nx-settings__row">
            <div>
              <div className="nx-type-body">Properties</div>
              {defs.length === 0 ? (
                <div className="nx-type-data">
                  None yet. A type with a date and a checkbox becomes a habit.
                </div>
              ) : (
                <div className="nx-types__props">
                  {defs.map((def) => (
                    <div className="nx-types__prop" key={def.id}>
                      <span className="nx-type-body">{def.name}</span>
                      <span className="nx-type-data">
                        {PROPERTY_TYPES.find((p) => p.value === def.property_type)?.label ??
                          def.property_type}
                      </span>
                      <button
                        className="nx-types__remove"
                        title={`Remove ${def.name} from this type`}
                        onClick={() => void handleRemoveProperty(def)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {!addingProperty && (
              <Button variant="ghost" onClick={() => setAddingProperty(true)}>
                Add property
              </Button>
            )}
          </div>

          {addingProperty && (
            <div className="nx-types__create">
              <input
                className="nx-input"
                autoFocus
                placeholder="Property name"
                value={propName}
                onChange={(e) => setPropName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAddProperty()
                  if (e.key === 'Escape') setAddingProperty(false)
                }}
              />
              <select
                className="nx-select"
                value={propType}
                onChange={(e) => setPropType(e.target.value as PropertyType)}
              >
                {PROPERTY_TYPES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <Button onClick={() => void handleAddProperty()} disabled={!propName.trim()}>
                Add
              </Button>
              <Button variant="ghost" onClick={() => setAddingProperty(false)}>
                Cancel
              </Button>
            </div>
          )}

          <div className="nx-settings__row">
            <div>
              <div className="nx-type-body">Template</div>
              <div className="nx-type-data">
                A new page of this type starts from this page's body and values.
              </div>
            </div>
            <select
              className="nx-select nx-settings__select"
              value={templateId ?? ''}
              onChange={(e) => void handleSetTemplate(e.target.value || null)}
              disabled={pageCount === 0}
            >
              <option value="">None</option>
              {pages
                .filter((p) => p.type_id === active.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title || 'Untitled'}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}
    </Panel>
  )
}
