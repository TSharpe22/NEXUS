import { useState } from 'react'
import { useAppStore } from '../store/app-store'

/**
 * The four semantic colour names from `tokens.css`. A tag gets one of these
 * round-robin when it is made; this is how it gets a different one.
 */
const TAG_COLORS = ['accent', 'info', 'success', 'critical'] as const

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
  const setTagColor = useAppStore((s) => s.setTagColor)
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
            <span key={tag.id} className="nx-tag-chip__editing">
              <input
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
              {/* Colour lives in the rename state for the same reason removing
                  a property does: it is the rarer half of what you might want
                  from a chip, and putting it on the chip itself would make
                  every click ambiguous. Colours were assigned round-robin on
                  creation and could not be changed at all. */}
              {TAG_COLORS.map((color) => (
                <button
                  key={color}
                  className={`nx-tag-chip__swatch nx-tag-chip--${color} ${
                    tag.color === color ? 'is-active' : ''
                  }`}
                  title={`Colour this tag ${color}`}
                  aria-label={`Colour this tag ${color}`}
                  // The input's blur commits the rename; a swatch has to fire
                  // before that takes the row off screen.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    void setTagColor(tag.id, color)
                  }}
                />
              ))}
            </span>
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
