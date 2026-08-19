/**
 * Date formatting for journal entries, shared by the main process (which names
 * the page) and the renderer (which labels the button that opens it).
 *
 * It lives here because the two had a copy each, with a comment on one saying
 * it matched the other — the button and the page title are read side by side,
 * so any drift between them is immediately visible.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A date in the user's own timezone, as `YYYY-MM-DD`.
 *
 * Deliberately not `toISOString()`, which is UTC: writing an entry at 11pm
 * would otherwise file it under tomorrow.
 */
export function localDateISO(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The short form, e.g. "Wed 19 Aug" — what the Today's entry button shows.
 *
 * Built by hand rather than through `toLocaleDateString` so the format cannot
 * shift with the machine's locale. The sortable form lives in the entry's
 * `date` property; this is purely what a human reads.
 */
export function journalDateLabel(d = new Date()): string {
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** A journal entry's title, e.g. "Entry — Wed 19 Aug 2026". */
export function journalEntryTitle(d = new Date()): string {
  return `Entry — ${journalDateLabel(d)} ${d.getFullYear()}`
}
