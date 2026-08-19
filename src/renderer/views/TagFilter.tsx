import { useState } from 'react'
import { useAppStore } from '../store/app-store'

/**
 * Tag chips above the Notes list. Clicking one narrows the list to pages
 * carrying it; several active tags mean "any of these". Renders nothing at all
 * when no tags exist, so an untagged vault gets no dead chrome.
 */
export function TagFilter() {
  const tags = useAppStore((s) => s.tags)
  const activeTagFilter = useAppStore((s) => s.activeTagFilter)
  const toggleTagFilter = useAppStore((s) => s.toggleTagFilter)
  const clearTagFilter = useAppStore((s) => s.clearTagFilter)
  const renameTag = useAppStore((s) => s.renameTag)
  const deleteTag = useAppStore((s) => s.deleteTag)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  if (tags.length === 0) return null

  return (
    <div className="nx-tagfilter">
      <div className="nx-tagfilter__head">
        <span className="nx-type-label">Tags</span>
        {activeTagFilter.length > 0 && (
          <button className="nx-tagfilter__clear" onClick={clearTagFilter}>
            clear
          </button>
        )}
      </div>

      <div className="nx-tagfilter__chips">
        {tags.map((tag) =>
          renamingId === tag.id ? (
            <input
              key={tag.id}
              className="nx-input nx-tag-chip__input"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => {
                if (draft.trim()) void renameTag(tag.id, draft)
                setRenamingId(null)
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenamingId(null)
              }}
            />
          ) : (
            <span
              key={tag.id}
              className={`nx-tag-chip nx-tag-chip--${tag.color} ${
                activeTagFilter.includes(tag.id) ? 'is-active' : ''
              }`}
            >
              <button
                className="nx-tag-chip__label"
                onClick={() => toggleTagFilter(tag.id)}
                onDoubleClick={() => {
                  setDraft(tag.name)
                  setRenamingId(tag.id)
                }}
                title={`${tag.page_count} page${tag.page_count === 1 ? '' : 's'} — double-click to rename`}
              >
                {tag.name}
                <span className="nx-tag-chip__count">{tag.page_count}</span>
              </button>
              <button
                className="nx-tag-chip__x"
                title={`Delete the "${tag.name}" tag everywhere`}
                aria-label={`Delete tag ${tag.name}`}
                onClick={() => void deleteTag(tag.id)}
              >
                ×
              </button>
            </span>
          )
        )}
      </div>
    </div>
  )
}
