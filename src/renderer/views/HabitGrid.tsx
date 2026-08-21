import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HabitCandidate, HabitDay } from '@shared/types'
import { addDays, eachDay, fromISO, startOfWeek, dayLabel } from '@shared/date-range'
import { localDateISO } from '@shared/journal-date'
import { useToday } from '../store/app-store'
import { EmptyState } from '../design/EmptyState'

/**
 * A habit's year, as a grid.
 *
 * There is no habit engine here and no habit table: a habit is a type with a
 * date property and a checkbox property, both of which milestone C already
 * supports on any type the user makes. This file is a *view* of those two
 * properties — everything it draws comes back from one query over
 * `properties`. If this ever needs a table of its own, something has gone
 * wrong with the model rather than with the grid.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']

/** The longest run of consecutive done days, and the run ending today. */
export function streaks(days: HabitDay[], today: string): { longest: number; current: number } {
  const done = new Set(days.filter((d) => d.done).map((d) => d.date))
  let longest = 0
  let run = 0
  for (const date of [...done].sort()) {
    const previous = localDateISO(addDays(fromISO(date), -1))
    run = done.has(previous) ? run + 1 : 1
    longest = Math.max(longest, run)
  }

  // A streak that ran until yesterday is still live — today has not been
  // missed until it is over.
  let cursor = done.has(today) ? today : localDateISO(addDays(fromISO(today), -1))
  let current = 0
  while (done.has(cursor)) {
    current++
    cursor = localDateISO(addDays(fromISO(cursor), -1))
  }

  return { longest, current }
}

interface HabitGridProps {
  onOpen: (pageId: string) => void
}

export function HabitGrid({ onOpen }: HabitGridProps) {
  const [candidates, setCandidates] = useState<HabitCandidate[] | null>(null)
  const [typeId, setTypeId] = useState<string | null>(null)
  const [dateKey, setDateKey] = useState<string | null>(null)
  const [booleanKey, setBooleanKey] = useState<string | null>(null)
  const today = useToday()
  // The logical year, not the calendar one. Every other date in this view goes
  // through `today`, so opening on `new Date()`'s year meant that between
  // midnight and the day-start hour on 1 January the grid showed a year that
  // did not contain today — the one day of the year the streak is worth
  // looking at. Initial state only: stepping through years is still free.
  const [year, setYear] = useState(() => Number(today.slice(0, 4)))
  const [days, setDays] = useState<HabitDay[]>([])

  useEffect(() => {
    void window.api.habits.candidates().then((found) => {
      setCandidates(found)
      const first = found[0]
      if (first) {
        setTypeId(first.typeId)
        setDateKey(first.dateKeys[0])
        setBooleanKey(first.booleanKeys[0])
      }
    })
  }, [])

  const selected = candidates?.find((c) => c.typeId === typeId) ?? null
  const from = `${year}-01-01`
  const to = `${year}-12-31`

  const load = useCallback(async () => {
    if (!typeId || !dateKey || !booleanKey) return
    setDays(await window.api.habits.days(typeId, dateKey, booleanKey, from, to))
  }, [typeId, dateKey, booleanKey, from, to])

  useEffect(() => {
    void load()
  }, [load])

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])

  /**
   * Columns of seven, starting on the Monday on or before 1 January — so a
   * row is always the same weekday and the eye can read down a column as one
   * week, the way a wall calendar works.
   */
  const columns = useMemo(() => {
    const start = startOfWeek(fromISO(from))
    const end = fromISO(to)
    const weeks: string[][] = []
    for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) {
      weeks.push(eachDay(localDateISO(cursor), localDateISO(addDays(cursor, 6))))
    }
    return weeks
  }, [from, to])

  const doneCount = days.filter((d) => d.done).length
  const recorded = days.length
  const { longest, current } = useMemo(() => streaks(days, today), [days, today])

  if (candidates === null) {
    return <div className="nx-habits__loading nx-type-data">loading…</div>
  }

  // Not an error and not a dead end: it says exactly what a habit is made of,
  // because the answer is two properties on a type rather than a feature to
  // switch on somewhere.
  if (candidates.length === 0) {
    return (
      <EmptyState
        text="No habits yet"
        meta="A habit is any type with a date property and a checkbox property — add both to a type and its pages appear here."
      />
    )
  }

  return (
    <div className="nx-habits">
      <div className="nx-habits__controls">
        <select
          className="nx-habits__select"
          value={typeId ?? ''}
          onChange={(e) => {
            const next = candidates.find((c) => c.typeId === e.target.value)
            if (!next) return
            setTypeId(next.typeId)
            setDateKey(next.dateKeys[0])
            setBooleanKey(next.booleanKeys[0])
          }}
        >
          {candidates.map((c) => (
            <option key={c.typeId} value={c.typeId}>
              {c.typeName}
            </option>
          ))}
        </select>

        {/* Only worth asking when there is a choice to make. */}
        {selected && selected.dateKeys.length > 1 && (
          <select
            className="nx-habits__select"
            value={dateKey ?? ''}
            onChange={(e) => setDateKey(e.target.value)}
            title="Which date property places a page in the year"
          >
            {selected.dateKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        )}

        {selected && selected.booleanKeys.length > 1 && (
          <select
            className="nx-habits__select"
            value={booleanKey ?? ''}
            onChange={(e) => setBooleanKey(e.target.value)}
            title="Which checkbox counts as done"
          >
            {selected.booleanKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        )}

        <div className="nx-habits__year">
          <button className="nx-tracker__step" onClick={() => setYear(year - 1)} title="Previous year">
            ‹
          </button>
          <span className="nx-type-data">{year}</span>
          <button className="nx-tracker__step" onClick={() => setYear(year + 1)} title="Next year">
            ›
          </button>
        </div>
      </div>

      <div className="nx-habits__stats nx-type-data">
        {doneCount} done · {recorded} recorded · longest streak {longest} · current {current}
      </div>

      <div className="nx-habits__scroll">
        <div className="nx-habits__grid">
          <div className="nx-habits__weekdays">
            {WEEKDAY_LABELS.map((label, i) => (
              <div key={i} className="nx-habits__weekday nx-type-data">
                {label}
              </div>
            ))}
          </div>

          <div className="nx-habits__weeks">
            <div className="nx-habits__months">
              {columns.map((week, index) => {
                const first = fromISO(week[0])
                // A month is labelled at the first column that lands in it.
                const previous = index > 0 ? fromISO(columns[index - 1][0]) : null
                const isNew = !previous || previous.getMonth() !== first.getMonth()
                return (
                  <div key={week[0]} className="nx-habits__month nx-type-data">
                    {isNew && first.getFullYear() === year ? MONTHS[first.getMonth()] : ''}
                  </div>
                )
              })}
            </div>

            <div className="nx-habits__cells">
              {columns.map((week) => (
                <div key={week[0]} className="nx-habits__week">
                  {week.map((date) => {
                    const entry = byDate.get(date)
                    // Days either side of the year keep the grid rectangular
                    // without pretending to be part of it.
                    const outside = date < from || date > to
                    const classes = [
                      'nx-habits__cell',
                      outside && 'nx-habits__cell--outside',
                      entry && (entry.done ? 'nx-habits__cell--done' : 'nx-habits__cell--missed'),
                      date === today && 'nx-habits__cell--today'
                    ]
                      .filter(Boolean)
                      .join(' ')

                    return (
                      <button
                        key={date}
                        className={classes}
                        disabled={!entry}
                        title={`${dayLabel(date)}${entry ? (entry.done ? ' · done' : ' · not done') : ' · no entry'}`}
                        onClick={() => entry && onOpen(entry.pageId)}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* The swatches deliberately do not reuse the cell classes: a legend is
          not part of the grid, and sharing the class made "how many days are
          done" ambiguous for anything counting them. */}
      <div className="nx-habits__legend nx-type-data">
        <span className="nx-habits__swatch" /> no entry
        <span className="nx-habits__swatch nx-habits__swatch--missed" /> recorded
        <span className="nx-habits__swatch nx-habits__swatch--done" /> done
      </div>
    </div>
  )
}
