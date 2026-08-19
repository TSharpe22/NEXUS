import React from 'react'
import { SEARCH_MARK_OPEN, SEARCH_MARK_CLOSE } from '../../shared/types'

/**
 * Renders a search string in which matched terms are wrapped in the control
 * characters the main process emits. Splitting on those sentinels keeps the
 * whole path text-only — page content is never interpreted as markup.
 */
export function SearchHighlight({ text }: { text: string }) {
  if (!text.includes(SEARCH_MARK_OPEN)) return <>{text}</>

  const nodes: React.ReactNode[] = []
  let key = 0

  for (const chunk of text.split(SEARCH_MARK_OPEN)) {
    const closeAt = chunk.indexOf(SEARCH_MARK_CLOSE)
    if (closeAt === -1) {
      // Text before the first match, or an unterminated tail.
      if (chunk) nodes.push(<React.Fragment key={key++}>{chunk}</React.Fragment>)
      continue
    }
    nodes.push(
      <mark
        key={key++}
        className="bg-[var(--nx-accent)]/25 text-[var(--nx-text-primary)] rounded-[2px] px-[1px]"
      >
        {chunk.slice(0, closeAt)}
      </mark>,
    )
    const rest = chunk.slice(closeAt + SEARCH_MARK_CLOSE.length)
    if (rest) nodes.push(<React.Fragment key={key++}>{rest}</React.Fragment>)
  }

  return <>{nodes}</>
}
