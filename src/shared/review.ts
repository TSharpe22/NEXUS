/**
 * Spaced review of Concepts (PLAN_NOTES.md, step 3).
 *
 * A Concept's **Check** is the card: the toggle's line is the question, what
 * it hides is the answer. The schedule lives on the Concept itself, in two
 * properties anyone can read and edit, `due` and `interval` — no ease factor,
 * no hidden table.
 *
 * The ladder is Leitner's: Good climbs one rung, Again drops to the first.
 *   Again   → interval 1, status shaky.
 *   Good    → the next rung up (an unreviewed concept starts on 1).
 *             A shaky concept is no longer shaky once it reaches 7 (two Goods
 *             in a row): it goes back to new.
 *             Good on the top rung is the third Good in a row at 16 days or
 *             more (16 → 35 → 80 → Good), and marks it solid.
 */

import { addDays, fromISO } from './date-range'
import { localDateISO } from './journal-date'
import { blockText } from './document'

export const REVIEW_LADDER = [1, 3, 7, 16, 35, 80]

export type ReviewGrade = 'again' | 'good'

export type ConceptStatus = 'new' | 'shaky' | 'solid'

export interface ReviewSchedule {
  interval: number
  due: string
  status: ConceptStatus
}

/** The rung `interval` sits on: the highest one not above it, or -1 for none yet. */
function rungOf(interval: number | null): number {
  if (!interval || interval < REVIEW_LADDER[0]) return -1
  let rung = 0
  for (let i = 0; i < REVIEW_LADDER.length; i++) if (REVIEW_LADDER[i] <= interval) rung = i
  return rung
}

export function nextSchedule(
  current: { interval: number | null; status: string | null },
  grade: ReviewGrade,
  today: string
): ReviewSchedule {
  const top = REVIEW_LADDER.length - 1
  let interval: number
  let status: ConceptStatus = current.status === 'shaky' || current.status === 'solid' ? current.status : 'new'

  if (grade === 'again') {
    interval = REVIEW_LADDER[0]
    status = 'shaky'
  } else {
    const rung = rungOf(current.interval)
    if (rung >= top) status = 'solid'
    interval = REVIEW_LADDER[Math.min(rung + 1, top)]
    if (status === 'shaky' && interval >= 7) status = 'new'
  }

  return { interval, due: localDateISO(addDays(fromISO(today), interval)), status }
}

export interface CheckCard {
  question: string
  answer: string
}

/** The placeholder the Concept template ships with, which is not a check yet. */
const PLACEHOLDER_QUESTION = 'Question?'

interface Node {
  type?: string
  content?: unknown
  children?: Node[]
}

/** The answer's lines: each hidden block's text, nested ones included. */
function linesOf(blocks: Node[] | undefined, out: string[] = []): string[] {
  for (const b of blocks ?? []) {
    const t = blockText(b.content).trim()
    if (t) out.push(b.type === 'bulletListItem' || b.type === 'numberedListItem' ? `• ${t}` : t)
    linesOf(b.children, out)
  }
  return out
}

/**
 * The card a Concept's body holds: the first toggle under its "Check"
 * heading with a real question in it. Null when there is none yet — a
 * concept is only reviewed once it can be checked.
 */
export function checkCardOf(blocks: unknown[]): CheckCard | null {
  let inCheck = false
  for (const raw of blocks) {
    const b = raw as Node
    if (b.type === 'heading') {
      inCheck = blockText(b.content).trim().toLowerCase() === 'check'
      continue
    }
    if (!inCheck || b.type !== 'toggle') continue
    const question = blockText(b.content).trim()
    if (!question || question === PLACEHOLDER_QUESTION) continue
    return { question, answer: linesOf(b.children).join('\n') }
  }
  return null
}
