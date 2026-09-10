import { useEffect, useState } from 'react'
import type { WidgetContext } from '../widgets/context'
import type { HabitCandidate, HabitDay } from '@shared/types'
import { addDays, eachDay, fromISO } from '@shared/date-range'
import { localDateISO } from '@shared/journal-date'

/**
 * Habits on Home: the last three weeks of each, and the streak running now.
 *
 * The year grid stays in Tracker. This is the glance — whether today is
 * marked and whether the run is alive — and three weeks is as much as fits
 * beside everything else Home has to show.
 *
 * Like the grid, there is no habit table behind this: a habit is any type the
 * user has given both a date property and a checkbox property, which is what
 * `habits.candidates()` looks for.
 */

/**
 * Days drawn per habit.
 *
 * Two weeks. Three was what fitted the panel, not what could be read: at 21
 * squares in a row nobody can tell which one is Tuesday, and the strip stops
 * being a calendar and becomes a texture.
 */
export const STRIP_DAYS = 14

/**
 * Days fetched per habit. The strip shows three weeks but the streak counts
 * back as far as the run goes, and reading a streak off the drawn window
 * would cap every habit at 21 days.
 */
const HISTORY_DAYS = 365

/** Mon…Sun initials, indexed by `Date.getDay()` (Sunday is 0). */
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

interface Strip {
  typeId: string
  typeName: string
  /** The pair the strip was built from, so a click can write back through it. */
  dateKey: string
  booleanKey: string
  /** One entry per drawn day, oldest first. */
  days: { date: string; state: 'done' | 'missed' | 'blank'; pageId: string | null }[]
}

function buildStrip(candidate: HabitCandidate, history: HabitDay[], today: string): Strip {
  const byDate = new Map(history.map((day) => [day.date, day]))
  const from = localDateISO(addDays(fromISO(today), -(STRIP_DAYS - 1)))

  return {
    typeId: candidate.typeId,
    typeName: candidate.typeName,
    dateKey: candidate.dateKeys[0],
    booleanKey: candidate.booleanKeys[0],
    days: eachDay(from, today).map((date) => {
      const day = byDate.get(date)
      return {
        date,
        // Three states, not two: a day with no entry at all is not the same
        // claim as a day whose entry says it did not happen.
        state: !day ? 'blank' : day.done ? 'done' : 'missed',
        pageId: day?.pageId ?? null
      }
    })
  }
}

interface Props {
  /** The narrowed surface a widget gets. See `widgets/context.ts`. */
  ctx: WidgetContext
}

export function HabitStrips({ ctx }: Props) {
  const [strips, setStrips] = useState<Strip[] | null>(null)
  // Bumped by a check-in so the strip redraws from the database rather than
  // from an optimistic guess about what the write did.
  const [version, setVersion] = useState(0)
  const today = ctx.today

  useEffect(() => {
    let cancelled = false
    const from = localDateISO(addDays(fromISO(today), -(HISTORY_DAYS - 1)))

    void ctx.read
      .habitCandidates()
      .then(async (candidates) => {
        const built = await Promise.all(
          candidates.map(async (candidate) =>
            buildStrip(
              candidate,
              // A type can define more than one of each; the first is the
              // panel's guess, and Tracker is where a different pair is picked.
              await ctx.read.habitDays(
                candidate.typeId,
                candidate.dateKeys[0],
                candidate.booleanKeys[0],
                from,
                today
              ),
              today
            )
          )
        )
        if (!cancelled) setStrips(built)
      })
      .catch(() => {
        if (!cancelled) setStrips([])
      })

    return () => {
      cancelled = true
    }
  }, [today, version])

  if (strips === null) return <div className="nx-type-data">Loading…</div>

  if (strips.length === 0) {
    return (
      <div className="nx-home__hint nx-type-data">
        No habits yet. A type with a date property and a checkbox property is a
        habit — nothing else to set up.
      </div>
    )
  }

  return (
    <div className="nx-home__habits">
      {strips.map((strip) => (
        <div key={strip.typeId} className="nx-home__habit">
          <div className="nx-home__habit-head">
            <span className="nx-home__habit-name">{strip.typeName}</span>
          </div>
          <div className="nx-home__habit-strip">
            {strip.days.map((day) => (
              <div className="nx-home__habit-col" key={day.date}>
              {/* Above the square: the label is what you read first to find
                  the day you mean, so it comes before the thing you click. */}
              <span className="nx-home__habit-tick nx-type-data">
                {WEEKDAY_INITIALS[fromISO(day.date).getDay()]}
              </span>
              <button
                className={`nx-home__habit-day nx-home__habit-day--${day.state}${
                  day.date === today ? ' nx-home__habit-day--today' : ''
                }`}
                title={`${day.date} — ${
                  day.state === 'done' ? 'done' : day.state === 'missed' ? 'not done' : 'no entry'
                } — click to ${day.state === 'done' ? 'clear' : 'mark done'}${
                  day.pageId ? ', ⌘/Ctrl-click to open the page' : ''
                }`}
                onClick={(e) => {
                  // Read-only until now: a day with no page could not even be
                  // clicked, so the panel that shows the habit was the one
                  // place you could not record one.
                  if ((e.metaKey || e.ctrlKey) && day.pageId) {
                    ctx.openPage(day.pageId)
                    return
                  }
                  void ctx.write
                    .checkInHabit(strip.typeId, strip.dateKey, strip.booleanKey, day.date, day.state !== 'done')
                    .then(() => setVersion((v) => v + 1))
                }}
              />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
