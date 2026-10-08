import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import type { ReviewCard, ReviewCount } from '@shared/types'
import type { ReviewGrade } from '@shared/review'
import { useAppStore, useToday } from '../store/app-store'
import { Button } from '../design/Button'
import { EmptyState } from '../design/EmptyState'
import { ipcMessage } from '../ipc-error'
import './Review.css'

/** A card in this sitting. A repeat is a missed card shown again: practice, not written. */
interface Turn {
  card: ReviewCard
  repeat: boolean
}

/** Typing in a field must never grade a card. */
function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/**
 * One sitting of review: a question, the answer on a key, then Again or Good.
 *
 * Keyboard-first — Space shows the answer, 1 is Again, 2 (or Space) is Good.
 * The queue is read once when the sitting starts, so grading a card never
 * reshuffles the ones still to come. A missed card comes back once at the end
 * of the sitting, as practice: its schedule was already written when it was
 * missed.
 */
export function ReviewSession() {
  const today = useToday()
  const openPage = useAppStore((s) => s.openPage)
  const [counts, setCounts] = useState<ReviewCount[]>([])
  const [topicId, setTopicId] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[] | null>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const [missed, setMissed] = useState<ReviewCard[]>([])

  const start = useCallback(
    async (topic: string | null) => {
      const [queue, c] = await Promise.all([window.api.review.queue(today, topic), window.api.review.counts(today)])
      setCounts(c)
      setTurns(queue.map((card) => ({ card, repeat: false })))
      setIndex(0)
      setRevealed(false)
      setReviewed(0)
      setMissed([])
    },
    [today]
  )

  useEffect(() => {
    void start(topicId)
  }, [start, topicId])

  const turn = turns?.[index] ?? null
  const total = turns?.length ?? 0

  const grade = useCallback(
    async (g: ReviewGrade) => {
      if (!turn || busy) return
      setBusy(true)
      try {
        if (!turn.repeat) {
          await window.api.review.grade(turn.card.pageId, g, today)
          setReviewed((n) => n + 1)
          if (g === 'again') setMissed((m) => [...m, turn.card])
        }
        if (g === 'again' && !turn.repeat) setTurns((t) => (t ? [...t, { card: turn.card, repeat: true }] : t))
        setIndex((i) => i + 1)
        setRevealed(false)
      } catch (e) {
        toast(ipcMessage(e))
      } finally {
        setBusy(false)
      }
    },
    [turn, busy, today]
  )

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!turn || typingIn(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        setRevealed(true)
      } else if (revealed && e.key === '1') {
        e.preventDefault()
        void grade('again')
      } else if (revealed && (e.key === '2' || e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        void grade('good')
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [turn, revealed, grade])

  const allDue = useMemo(() => counts.reduce((n, c) => n + c.due, 0), [counts])

  if (turns === null) return <div className="nx-review nx-type-data">loading…</div>

  const topics = counts.length > 1 || topicId !== null
  return (
    <div className="nx-review">
      {topics && (
        <div className="nx-review__topics">
          <button
            className={`nx-review__topic ${topicId === null ? 'nx-review__topic--active' : ''}`}
            onClick={() => setTopicId(null)}
          >
            All · {allDue}
          </button>
          {counts
            .filter((c) => c.topicId)
            .map((c) => (
              <button
                key={c.topicId}
                className={`nx-review__topic ${topicId === c.topicId ? 'nx-review__topic--active' : ''}`}
                onClick={() => setTopicId(c.topicId)}
              >
                {c.topicTitle || 'Untitled'} · {c.due}
              </button>
            ))}
        </div>
      )}

      {turn ? (
        <div className="nx-review__card" data-testid="review-card">
          <div className="nx-review__meta nx-type-data">
            <span>
              {Math.min(index + 1, total)} of {total}
              {turn.repeat ? ' · again, for practice' : ''}
            </span>
            <button className="nx-review__open" onClick={() => openPage(turn.card.pageId)}>
              {turn.card.topicTitle ? `${turn.card.topicTitle} · ` : ''}
              {turn.card.title || 'Untitled concept'} →
            </button>
          </div>
          <div className="nx-review__question">{turn.card.question}</div>
          {revealed ? (
            <>
              <div className="nx-review__answer">{turn.card.answer || '(no answer written)'}</div>
              <div className="nx-review__grades">
                <Button variant="ghost" disabled={busy} onClick={() => void grade('again')}>
                  Again <kbd>1</kbd>
                </Button>
                <Button disabled={busy} onClick={() => void grade('good')}>
                  Good <kbd>2</kbd>
                </Button>
              </div>
            </>
          ) : (
            <div className="nx-review__grades">
              <Button onClick={() => setRevealed(true)}>
                Show answer <kbd>Space</kbd>
              </Button>
            </div>
          )}
        </div>
      ) : reviewed > 0 ? (
        <div className="nx-review__done">
          <div className="nx-type-heading">
            Reviewed {reviewed}
            {missed.length ? `, missed ${missed.length}` : ', none missed'}
          </div>
          {missed.length > 0 && (
            <ul className="nx-review__missed">
              {missed.map((c) => (
                <li key={c.pageId}>
                  <button className="nx-review__open" onClick={() => openPage(c.pageId)}>
                    {c.title || 'Untitled concept'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="nx-type-data">Missed concepts come back tomorrow.</div>
        </div>
      ) : (
        <EmptyState
          text="Nothing due for review."
          meta="A concept joins review once its Check has a question written in it."
        />
      )}
    </div>
  )
}
