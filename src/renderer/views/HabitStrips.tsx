import { useEffect, useState } from 'react'
import type { HabitCandidate, HabitDay } from '@shared/types'
import { addDays, eachDay, fromISO } from '@shared/date-range'
import { localDateISO } from '@shared/journal-date'
import { streaks } from './HabitGrid'
import { useToday } from '../store/app-store'

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

/** Days drawn per habit. */
export const STRIP_DAYS = 21

/**
 * Days fetched per habit. The strip shows three weeks but the streak counts
 * back as far as the run goes, and reading a streak off the drawn window
 * would cap every habit at 21 days.
 */
const HISTORY_DAYS = 365

interface Strip {
  typeId: string
  typeName: string
  /** One entry per drawn day, oldest first. */
  days: { date: string; state: 'done' | 'missed' | 'blank'; pageId: string | null }[]
  current: number
}

function buildStrip(candidate: HabitCandidate, history: HabitDay[], today: string): Strip {
  const byDate = new Map(history.map((day) => [day.date, day]))
  const from = localDateISO(addDays(fromISO(today), -(STRIP_DAYS - 1)))

  return {
    typeId: candidate.typeId,
    typeName: candidate.typeName,
    days: eachDay(from, today).map((date) => {
      const day = byDate.get(date)
      return {
        date,
        // Three states, not two: a day with no entry at all is not the same
        // claim as a day whose entry says it did not happen.
        state: !day ? 'blank' : day.done ? 'done' : 'missed',
        pageId: day?.pageId ?? null
      }
    }),
    current: streaks(history, today).current
  }
}

interface Props {
  onOpen: (pageId: string) => void
}

export function HabitStrips({ onOpen }: Props) {
  const [strips, setStrips] = useState<Strip[] | null>(null)
  const today = useToday()

  useEffect(() => {
    let cancelled = false
    const from = localDateISO(addDays(fromISO(today), -(HISTORY_DAYS - 1)))

    void window.api.habits
      .candidates()
      .then(async (candidates) => {
        const built = await Promise.all(
          candidates.map(async (candidate) =>
            buildStrip(
              candidate,
              // A type can define more than one of each; the first is the
              // panel's guess, and Tracker is where a different pair is picked.
              await window.api.habits.days(
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
  }, [today])

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
            <span
              className={`nx-type-data ${strip.current > 0 ? 'nx-home__streak--live' : ''}`}
              title={strip.current > 0 ? 'Days in a row, ending today' : 'No run going'}
            >
              {strip.current > 0 ? `${strip.current}d` : '—'}
            </span>
          </div>
          <div className="nx-home__habit-strip">
            {strip.days.map((day) => (
              <button
                key={day.date}
                className={`nx-home__habit-day nx-home__habit-day--${day.state}`}
                title={`${day.date} — ${day.state === 'done' ? 'done' : day.state === 'missed' ? 'not done' : 'no entry'}`}
                disabled={!day.pageId}
                onClick={() => day.pageId && onOpen(day.pageId)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
