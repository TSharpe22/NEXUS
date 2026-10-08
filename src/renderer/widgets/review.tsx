import { useEffect, useState } from 'react'
import type { ReviewCount } from '@shared/types'
import { Button } from '../design/Button'
import type { WidgetProps } from './context'
import '../views/Review.css'

/**
 * "Due for review (N)": concepts whose Check is due, per topic. The review
 * itself happens in Tracker → Review; this is the way in from the morning.
 */
export function ReviewWidget({ ctx }: WidgetProps) {
  const [counts, setCounts] = useState<ReviewCount[] | null>(null)

  // Refetched when pages change: writing a Check, or grading one, moves the count.
  useEffect(() => {
    let cancelled = false
    void ctx.read.reviewCounts(ctx.today).then((c) => {
      if (!cancelled) setCounts(c)
    })
    return () => {
      cancelled = true
    }
  }, [ctx.read, ctx.today, ctx.pages])

  if (counts === null) return null
  const total = counts.reduce((n, c) => n + c.due, 0)
  if (total === 0) {
    return <div className="nx-review-strip nx-home__hint nx-type-data">Nothing due for review.</div>
  }

  return (
    <div className="nx-review-strip">
      {counts.map((c) => (
        <div key={c.topicId ?? 'none'} className="nx-home__hint nx-type-data">
          {c.topicTitle || 'No topic'} · {c.due} due
        </div>
      ))}
      <Button onClick={() => ctx.goToTracker('review')}>Review {total} →</Button>
    </div>
  )
}
