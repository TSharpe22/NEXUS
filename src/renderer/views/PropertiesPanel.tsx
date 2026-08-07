import { useEffect, useState } from 'react'
import type { Page, DirectiveStatus } from '@shared/types'
import { DIRECTIVE_STATUSES } from '@shared/types'
import { StatusDot } from '../design/StatusDot'

interface Props {
  page: Page
}

function parseTags(raw: string | null | undefined): string[] {
  try {
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const STATUS_TO_DOT: Record<DirectiveStatus, 'active' | 'pending' | 'done'> = {
  active: 'active',
  pending: 'pending',
  done: 'done'
}

export function PropertiesPanel({ page }: Props) {
  const [tags, setTags] = useState<string[]>([])
  const [status, setStatus] = useState<DirectiveStatus | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    window.api.properties.getForPage(page.id).then((props) => {
      const tagsProp = props.find((p) => p.key === 'tags')
      const statusProp = props.find((p) => p.key === 'status')
      setTags(parseTags(tagsProp?.value_text))
      setStatus((statusProp?.value_text as DirectiveStatus) ?? (page.type_id === 'directive' ? 'active' : null))
    })
  }, [page.id, page.type_id])

  const saveTags = async (next: string[]) => {
    setTags(next)
    await window.api.properties.set(page.id, 'tags', 'multi_select', JSON.stringify(next))
  }

  const addTag = () => {
    const value = draft.trim()
    if (value && !tags.includes(value)) saveTags([...tags, value])
    setDraft('')
  }

  const removeTag = (tag: string) => saveTags(tags.filter((t) => t !== tag))

  const setDirectiveStatus = async (next: DirectiveStatus) => {
    setStatus(next)
    await window.api.properties.set(page.id, 'status', 'select', next)
  }

  return (
    <div className="nx-properties">
      {page.type_id === 'directive' && status && (
        <div className="nx-properties__row">
          <span className="nx-type-label">Status</span>
          <div className="nx-properties__statuses">
            {DIRECTIVE_STATUSES.map((s) => (
              <button
                key={s}
                className={`nx-properties__status-btn ${s === status ? 'nx-properties__status-btn--active' : ''}`}
                onClick={() => setDirectiveStatus(s)}
              >
                <StatusDot status={STATUS_TO_DOT[s]} label={s} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="nx-properties__row">
        <span className="nx-type-label">Tags</span>
        <div className="nx-properties__tags">
          {tags.map((tag) => (
            <span key={tag} className="nx-properties__tag">
              {tag}
              <button onClick={() => removeTag(tag)} aria-label={`Remove ${tag}`}>
                ×
              </button>
            </span>
          ))}
          <input
            className="nx-properties__tag-input"
            placeholder="+ tag"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTag()
            }}
            onBlur={addTag}
          />
        </div>
      </div>
    </div>
  )
}
