/**
 * Phone reminders and the Exec-Bot hand-off, end to end against stand-ins:
 * a local server in place of ntfy, and a bare git repo in place of GitHub.
 * Never touches the real vault, topic or Exec-Bot checkout.
 *
 *   npm run build && node scripts/check-phone.mjs     (xvfb-run -a on headless Linux)
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createServer } from 'http'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const APP = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? ' ok  ' : 'FAIL '} ${label}${extra ? ' — ' + extra : ''}`)
}
const pad = (n) => String(n).padStart(2, '0')
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const plusDays = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

// ---------------------------------------------------------------- stand-ins
const received = []
const ntfy = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    received.push({ path: req.url, headers: req.headers, body })
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ id: `m${received.length}` }))
  })
})
await new Promise((r) => ntfy.listen(0, '127.0.0.1', r))

const root = mkdtempSync(join(tmpdir(), 'nexus-phone-'))
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
const remote = join(root, 'remote.git')
git(root, 'init', '-q', '--bare', '-b', 'main', remote)
const work = join(root, 'work')
git(root, 'clone', '-q', remote, work)
git(work, 'config', 'user.email', 'check@example.com')
git(work, 'config', 'user.name', 'check')
writeFileSync(join(work, 'README.md'), 'stand-in\n')
// The calendar builder, as the real Exec-Bot repo has it (EXECBOT_DIR to override).
const execBot = process.env.EXECBOT_DIR ?? join(process.env.HOME, 'Desktop', 'exec-bot')
mkdirSync(join(work, 'tools'), { recursive: true })
writeFileSync(join(work, 'tools', 'cal.py'), readFileSync(join(execBot, 'tools', 'cal.py')))
git(work, 'add', '.')
git(work, 'commit', '-qm', 'init')
git(work, 'push', '-q', 'origin', 'main')
// A second clone plays the cloud routine.
const cloud = join(root, 'cloud')
git(root, 'clone', '-q', remote, cloud)
git(cloud, 'config', 'user.email', 'routine@example.com')
git(cloud, 'config', 'user.name', 'routine')

const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${join(root, 'userdata')}`, APP],
  cwd: APP,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    NEXUS_NTFY_SERVER: `http://127.0.0.1:${ntfy.address().port}`,
    NEXUS_REMINDER_SETTLE_MS: '1500',
    NEXUS_REMINDER_TICK_MS: '500'
  },
  timeout: 45_000
})
const page = await app.firstWindow()
await page.waitForSelector('.nx-app', { timeout: 20_000 })
const api = (fn, arg) => page.evaluate(fn, arg)
const tryApi = (fn, arg) =>
  page.evaluate(async ([src, a]) => {
    try {
      return { ok: true, value: await eval(src)(a) }
    } catch (e) {
      return { ok: false, error: String(e.message ?? e) }
    }
  }, [fn.toString(), arg])

// ---------------------------------------------------------------- phone
console.log('— phone —')
check('no topic at first', (await api(() => window.api.phone.config())).configured === false)
const noTopic = await tryApi((t) => window.api.reminders.schedule(t), '1600 tomorrow x')
check('a reminder without a topic says where to set one', !noTopic.ok && /Settings → Phone/.test(noTopic.error), noTopic.error)
const badTopic = await tryApi((t) => window.api.phone.setTopic(t), 'has spaces!')
check('a malformed topic is refused', !badTopic.ok)
await api((t) => window.api.phone.setTopic(t), 'check-topic')
check('the topic is never handed back', !JSON.stringify(await api(() => window.api.phone.config())).includes('check-topic'))
await api(() => window.api.phone.test())
check('a test posts to the topic', received.at(-1)?.path === '/check-topic' && /Test from Nexus/.test(received.at(-1)?.body))

// ---------------------------------------------------------------- capture-bar reminders
console.log('— reminders —')
const before = received.length
const set = await api((t) => window.api.reminders.schedule(t), '1600 tomorrow armored mma starts in 15')
const want = new Date(plusDays(1).setHours(16, 0, 0, 0))
check('words become an instant', new Date(set.fireAt).getTime() === want.getTime(), set.fireAt)
const sent = received[before]
check('handed to ntfy at once', received.length === before + 1 && sent.body === 'armored mma starts in 15')
check('with a Unix timestamp, never words', sent?.headers.at === String(Math.floor(want.getTime() / 1000)), sent?.headers.at)
check('at top priority, titled Reminder, no emoji tag', sent?.headers.priority === '5' && sent?.headers.title === 'Reminder' && !sent?.headers.tags)
const nonsense = await tryApi((t) => window.api.reminders.schedule(t), 'buy milk')
check('text with no time is refused, with how to write one', !nonsense.ok && /Start with a time/.test(nonsense.error))
const past = await tryApi((t) => window.api.reminders.schedule(t), `${localDay(plusDays(-1))} 0900 too late`)
check('a time that has passed is refused', !past.ok && /passed/.test(past.error))
const far = await api((t) => window.api.reminders.schedule(t), `${localDay(plusDays(10))} 0900 far off`)
check('a reminder past ntfy’s window is held in Nexus, not sent', far.held === true && received.length === before + 1)
const upcoming = await api(() => window.api.reminders.upcoming())
check('both are listed as upcoming, soonest first',
  upcoming.length === 2 && upcoming[0].text === 'armored mma starts in 15' && upcoming[1].status === 'pending')

// ---------------------------------------------------------------- ! lines
const para = (type, text, props = {}) => ({
  id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()),
  type,
  props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left', ...props },
  content: text ? [{ type: 'text', text, styles: {} }] : [],
  children: []
})
const lineId = 'blk-reminder-1'
const entry = await api(() => window.api.journal.today())
const doc = (line) => [
  para('heading', 'Tasks', { level: 2 }),
  para('heading', 'Plans for tomorrow?', { level: 2 }),
  para('paragraph', 'Lift, then the long walk'),
  { ...para('paragraph', line), id: lineId }
]
const beforeLine = received.length
await api(([id, content]) => window.api.pages.update(id, { content }), [entry.id, JSON.stringify(doc('!2330 late stretch'))])
await sleep(300)
check('a ! line waits while it may still be changing', received.length === beforeLine)
check('and shows as waiting', (await api(() => window.api.reminders.upcoming())).some((r) => r.text === 'late stretch' && r.status === 'pending'))
await sleep(3500)
const lineSent = received.slice(beforeLine)
const tomorrow2330 = new Date(plusDays(1).setHours(23, 30, 0, 0))
check('once settled it is sent, once', lineSent.length === 1 && lineSent[0].body === 'late stretch', JSON.stringify(lineSent.map((r) => r.body)))
check('under "Plans for tomorrow" it fires tomorrow', lineSent[0]?.headers.at === String(Math.floor(tomorrow2330.getTime() / 1000)))
await api(([id, content]) => window.api.pages.update(id, { content }), [entry.id, JSON.stringify(doc('!2330 late stretch'))])
await sleep(3000)
check('saving the page again does not send it twice', received.length === beforeLine + 1)
await api(([id, content]) => window.api.pages.update(id, { content }), [entry.id, JSON.stringify(doc('plain text now'))])
await sleep(500)
check('deleting the line does not take back a sent reminder',
  (await api(() => window.api.reminders.upcoming())).some((r) => r.text === 'late stretch' && r.status === 'sent'))
await api(([id, content]) => window.api.pages.update(id, { content }), [entry.id, JSON.stringify(doc('!2345 typo'))])
await sleep(200)
await api(([id, content]) => window.api.pages.update(id, { content }), [entry.id, JSON.stringify(doc('nothing'))])
await sleep(3000)
check('a line deleted before it settled is never sent', !received.some((r) => r.body === 'typo'))

// ---------------------------------------------------------------- briefing hand-off
console.log('— briefing —')
check('the hand-off is off until switched on', (await api(() => window.api.briefing.status())).enabled === false)
await api((d) => window.api.briefing.setDir(d), work)
const on = await api(() => window.api.briefing.setEnabled(true))
check('a git checkout is recognised', on.ready && on.enabled, JSON.stringify(on))
// Put the plans back so the snapshot has something to carry.
await api(([id, content]) => window.api.pages.update(id, { content }), [entry.id, JSON.stringify(doc('!2330 late stretch'))])
const synced = await api(() => window.api.briefing.syncNow())
check('sync reports no error', !synced.error, synced.error ?? '')
const files = git(remote, 'ls-tree', '-r', '--name-only', 'main')
const snapDate = synced.lastSnapshotFor
check('the snapshot reached the remote', !!snapDate && files.includes(`snapshot/${snapDate}.json`), files)
const snapshot = JSON.parse(git(remote, 'show', `main:snapshot/${snapDate}.json`))
const afterCutoff = new Date().getHours() * 60 + new Date().getMinutes() >= 8 * 60 + 30
if (afterCutoff) {
  check('it carries the evening’s plans for tomorrow', snapshot.plansForTomorrow.includes('Lift, then the long walk'), JSON.stringify(snapshot.plansForTomorrow))
  check('and tomorrow’s reminders', snapshot.reminders.some((r) => r.time === '23:30' && r.text === 'late stretch'), JSON.stringify(snapshot.reminders))
}
check('it carries no topic and no calendar link', !JSON.stringify(snapshot).includes('check-topic'))
const commits = git(remote, 'rev-list', '--count', 'main').trim()
await api(() => window.api.briefing.syncNow())
check('an unchanged vault pushes nothing new', git(remote, 'rev-list', '--count', 'main').trim() === commits)

const today = localDay(new Date())
check('no briefing before the routine writes one', (await api(() => window.api.briefing.today())) === null)
git(cloud, 'pull', '-q')
mkdirSync(join(cloud, 'briefings'), { recursive: true })
writeFileSync(
  join(cloud, 'briefings', `${today}.md`),
  'title: Wed 7 Oct · briefing\ntags: calendar\n---\n**Today:**\n- 09:00 dentist\n\n**Training:** Cardio/Skill B (by rotation)\n\n**Reminders:** none\n'
)
git(cloud, 'add', '.')
git(cloud, 'commit', '-qm', 'briefing')
git(cloud, 'push', '-q')
await api(() => window.api.briefing.syncNow())
const brief = await api(() => window.api.briefing.today())
check('the routine’s briefing is pulled back', brief?.title === 'Wed 7 Oct · briefing' && brief.body.includes('09:00 dentist'), JSON.stringify(brief))
const bpage = await api(() => window.api.briefing.openPage())
const bblocks = JSON.parse(bpage.content)
check('the briefing is a page of its own type', bpage.title === 'Wed 7 Oct · briefing' && bblocks.some((b) => b.type === 'bulletListItem'), bpage.title)
const types = await api(() => window.api.types.list())
check('of type Briefing', types.some((t) => t.name === 'Briefing' && t.id === bpage.type_id), JSON.stringify(types.map((t) => t.name)))
check('opening it again gives the same page', (await api(() => window.api.briefing.openPage())).id === bpage.id)
const withBrief = await api(() => window.api.briefing.addToEntry())
const blocks = JSON.parse(withBrief.content)
check('today’s entry links to it under "Briefing"',
  blocks[0].type === 'heading' && blocks[0].content[0].text === 'Briefing' &&
  blocks[1].content.some((c) => c.type === 'pageMention' && c.props.pageId === bpage.id), JSON.stringify(blocks.slice(0, 2)).slice(0, 200))
const again = JSON.parse((await api(() => window.api.briefing.addToEntry())).content)
check('linking it again replaces the section rather than doubling it',
  again.filter((b) => b.type === 'heading' && b.content[0]?.text === 'Briefing').length === 1)

// ---------------------------------------------------------------- calendar
console.log('— calendar —')
const ev = await api((t) => window.api.briefing.addEvent(t), 'nov 14 2000-0000 armored mma nashville')
check('an event is read from words', ev.start.endsWith('-11-14T20:00') && ev.end.endsWith('-11-15T00:00') && ev.title === 'armored mma nashville', JSON.stringify(ev))
check('and pushed', ev.pushed === true)
const feed = git(remote, 'show', 'main:calendar/feed.ics')
check('the feed on the remote carries it', /SUMMARY:armored mma nashville/.test(feed) && /DTSTART:\d{8}T010000Z/.test(feed), feed.slice(0, 80))
const dup = await tryApi((t) => window.api.briefing.addEvent(t), 'nov 14 2000 armored mma nashville')
check('the same event twice is refused', !dup.ok && /already there/.test(dup.error), dup.error)
const noDay = await tryApi((t) => window.api.briefing.addEvent(t), '2000 no day here')
check('words with no day are refused, with how to write one', !noDay.ok && /Start with a day/.test(noDay.error), noDay.error)

// ---------------------------------------------------------------- UI
console.log('— UI —')
await page.evaluate(() => window.api.dashboard.set(JSON.stringify({
  version: 1,
  widgets: [{ id: 'w-cap', kind: 'capture', config: {}, span: 12 }, { id: 'w-brief', kind: 'briefing', config: {}, span: 6 }]
}), 'exec'))
await page.reload()
await page.waitForSelector('.nx-app', { timeout: 20_000 })
await sleep(1500)
const widget = await page.evaluate(() => document.querySelector('.nx-brief')?.innerText ?? '')
check('the Home widget shows the briefing', /09:00 dentist/.test(widget) && /TRAINING|Training/.test(widget), widget.slice(0, 200))
check('and the reminders still to come', /armored mma starts in 15/.test(widget))
const beforeUi = received.length
await page.evaluate(() => [...document.querySelectorAll('.nx-home__capture button')].find((b) => b.textContent.trim() === 'Remind')?.click())
await page.fill('.nx-home__capture-input', '30m stretch from the bar')
await page.keyboard.press('Enter')
await sleep(1200)
check('the capture bar’s Remind sends it', received.length === beforeUi + 1 && received.at(-1).body === 'stretch from the bar')
check('and the box empties for the next one', (await page.inputValue('.nx-home__capture-input')) === '')
check('and the widget lists it', /stretch from the bar/.test(await page.evaluate(() => document.querySelector('.nx-brief')?.innerText ?? '')))
await page.evaluate(() => [...document.querySelectorAll('.nx-home__capture button')].find((b) => b.textContent.trim() === 'Event')?.click())
await page.fill('.nx-home__capture-input', '12/5 rally day')
await page.keyboard.press('Enter')
await sleep(2500)
check('the capture bar’s Event adds it to the feed', /SUMMARY:rally day/.test(git(remote, 'show', 'main:calendar/feed.ics')))
await page.screenshot({ path: join(root, 'home.png') })

await app.close()
ntfy.close()
console.log(`\nscreenshot: ${join(root, 'home.png')}`)
console.log(fails ? `${fails} check(s) failed` : 'all checks passed')
process.exit(fails ? 1 : 0)
