/**
 * Exercises ICS expansion — `src/main/ical-expand.ts` — against a fixture
 * calendar with the cases a real feed carries: times in UTC, in a zone the
 * feed defines, in a zone it only names; all-day spans; a weekly rule with a
 * skipped and a moved occurrence; a cancelled event; a rule running since
 * 2020; a reminder with no end.
 *
 *   node scripts/check-calendar.mjs
 *
 * Pinned to New York time so the expected local days do not depend on where
 * the check is run.
 */
process.env.TZ = 'America/New_York'

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { build } from 'esbuild'
import { pathToFileURL } from 'url'

const dir = mkdtempSync(join(tmpdir(), 'nexus-calendar-'))
const bundlePath = join(dir, 'ical-expand.mjs')

let failures = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`)
  if (!ok) console.log(`         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`)
}

await build({
  entryPoints: ['src/main/ical-expand.ts'],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node'
})
const { expandCalendar } = await import(pathToFileURL(bundlePath).href)

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//nexus//check//EN',
  'BEGIN:VTIMEZONE',
  'TZID:America/Los_Angeles',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0800',
  'TZOFFSETTO:-0700',
  'TZNAME:PDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'TZNAME:PST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',

  'BEGIN:VEVENT', 'UID:utc', 'SUMMARY:UFC Fight Night',
  'DTSTART:20261007T230000Z', 'DTEND:20261008T010000Z',
  'DESCRIPTION:Main card. Watch https://example.com/live?x=1 tonight', 'END:VEVENT',

  'BEGIN:VEVENT', 'UID:london', 'SUMMARY:Premiere',
  'DTSTART;TZID=Europe/London:20261008T200000', 'DTEND;TZID=Europe/London:20261008T210000', 'END:VEVENT',

  'BEGIN:VEVENT', 'UID:la', 'SUMMARY:Race qualifying',
  'DTSTART;TZID=America/Los_Angeles:20261009T090000', 'DTEND;TZID=America/Los_Angeles:20261009T100000',
  'URL:https://example.com/race', 'END:VEVENT',

  'BEGIN:VEVENT', 'UID:allday', 'SUMMARY:Tournament weekend',
  'DTSTART;VALUE=DATE:20261010', 'DTEND;VALUE=DATE:20261012', 'END:VEVENT',

  'BEGIN:VEVENT', 'UID:spar', 'SUMMARY:Sparring',
  'DTSTART;TZID=America/New_York:20260907T180000', 'DTEND;TZID=America/New_York:20260907T190000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,TH',
  'EXDATE;TZID=America/New_York:20261005T180000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:spar', 'SUMMARY:Sparring (moved)',
  'RECURRENCE-ID;TZID=America/New_York:20261008T180000',
  'DTSTART;TZID=America/New_York:20261009T200000', 'DTEND;TZID=America/New_York:20261009T210000', 'END:VEVENT',

  'BEGIN:VEVENT', 'UID:cancelled', 'SUMMARY:Called off', 'STATUS:CANCELLED',
  'DTSTART:20261006T150000Z', 'DTEND:20261006T160000Z', 'END:VEVENT',

  'BEGIN:VEVENT', 'UID:later', 'SUMMARY:Outside the window',
  'DTSTART:20261020T150000Z', 'DTEND:20261020T160000Z', 'END:VEVENT',

  'BEGIN:VEVENT', 'UID:reminder', 'SUMMARY:Renew licence',
  'DTSTART:20261006T130000Z', 'END:VEVENT',

  'BEGIN:VEVENT', 'UID:daily', 'SUMMARY:Stretch',
  'DTSTART:20200101T120000Z', 'DTEND:20200101T121500Z', 'RRULE:FREQ=DAILY', 'END:VEVENT',

  'BEGIN:VEVENT', 'UID:late', 'SUMMARY:Late stream',
  'DTSTART;TZID=America/New_York:20261011T220000', 'DTEND;TZID=America/New_York:20261012T020000', 'END:VEVENT',
  'END:VCALENDAR',
  ''
].join('\r\n')

const feed = { id: 'f1', name: 'Proton' }
const started = Date.now()
const events = expandCalendar(ICS, feed, '2026-10-05', '2026-10-11')
const took = Date.now() - started
const byTitle = (title) => events.filter((e) => e.title === title)
const one = (title) => byTitle(title)[0]

console.log('times:')
check('a UTC event lands on its local day', one('UFC Fight Night')?.days, ['2026-10-07'])
check('at its instant', one('UFC Fight Night')?.start, '2026-10-07T23:00:00.000Z')
check('a zone the feed only names is resolved, not read as local (London, BST)',
  one('Premiere')?.start, '2026-10-08T19:00:00.000Z')
check('a zone the feed defines is used (Los Angeles, PDT)', one('Race qualifying')?.start, '2026-10-09T16:00:00.000Z')
check('a late event is drawn on the day it starts, clipped to the window',
  one('Late stream')?.days, ['2026-10-11'])

console.log('\nall-day:')
check('an all-day span covers its days, end exclusive', one('Tournament weekend')?.days, ['2026-10-10', '2026-10-11'])
check('and is marked all-day', one('Tournament weekend')?.allDay, true)

console.log('\nrecurrence:')
check('a skipped occurrence is skipped, a moved one is drawn where it moved to',
  events.filter((e) => e.title.startsWith('Sparring')).map((e) => [e.title, e.days[0]]),
  [['Sparring (moved)', '2026-10-09']])
check('the moved occurrence is at its new time (20:00 New York)',
  one('Sparring (moved)')?.start, '2026-10-10T00:00:00.000Z')
check('a daily rule running since 2020 gives one a day', byTitle('Stretch').length, 7)
check(`and expands quickly (${took} ms)`, took < 1500, true)

console.log('\nwhat is left out, and what is kept:')
check('a cancelled event is not drawn', byTitle('Called off').length, 0)
check('an event outside the window is not drawn', byTitle('Outside the window').length, 0)
check('a reminder with no end still sits on its day', one('Renew licence')?.days, ['2026-10-06'])
check('a link in the description is found', one('UFC Fight Night')?.link, 'https://example.com/live?x=1')
check('the URL field wins when there is one', one('Race qualifying')?.link, 'https://example.com/race')
check('all-day events sort first', events[0]?.allDay, true)
check('ids are unique per occurrence', new Set(events.map((e) => e.id)).size, events.length)

let threw = null
try {
  expandCalendar('BEGIN:VCALENDAR\r\nnot really\r\n', feed, '2026-10-05', '2026-10-11')
} catch (e) {
  threw = e
}
check('a broken document throws rather than returning nothing', threw !== null, true)

rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
