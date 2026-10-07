import type { DatedPage, TrackerTask } from '@shared/types'

/**
 * What a week is made of, shared by Tracker → Week and the Week widget on
 * Home so the two can never disagree about which task belongs where.
 */

/**
 * Whether a task is one of the week's own plan items.
 *
 * The week page is dated by its Monday, and a task with no date of its own
 * counts against its page's — so without this, every line of a week's plan
 * would pile up on Monday and turn into "left open" on Tuesday. A plan item
 * belongs to the whole week. One given its own `@date` is an ordinary task
 * on that day.
 */
export function isWeekItem(task: TrackerTask, weekPageId: string | null): boolean {
  return weekPageId !== null && task.pageId === weekPageId && task.dueDateSource !== 'block'
}

/**
 * What a week's logs add up to, by type: "Training 2/3" when the type has a
 * done box (done of logged), a bare count when it does not.
 */
export function loggedByType(pages: DatedPage[]): { name: string; text: string }[] {
  const byType = new Map<string, { total: number; done: number; checkable: boolean }>()
  for (const page of pages) {
    const name = page.typeName ?? 'Note'
    const entry = byType.get(name) ?? { total: 0, done: 0, checkable: false }
    entry.total++
    if (page.done !== null) entry.checkable = true
    if (page.done) entry.done++
    byType.set(name, entry)
  }
  return [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, e]) => ({ name, text: e.checkable ? `${e.done}/${e.total}` : String(e.total) }))
}
