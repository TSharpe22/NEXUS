/**
 * The note-taking framework (PLAN_NOTES.md step 1): Topic, Concept and Lesson
 * seeded on the first "New topic", with the hub's canvas and concepts view.
 *
 *   npm run check:learning     (builds, then runs under xvfb)
 *
 * Runs against a scratch userData directory, so it never touches real notes.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

const APP = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const userDataDir = mkdtempSync(join(tmpdir(), 'nexus-learning-'))

let fails = 0
const check = (label, ok, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? ' ok  ' : 'FAIL '} ${label}${extra ? ' — ' + extra : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`, APP],
  cwd: APP,
  env: { ...process.env, NODE_ENV: 'production' },
  timeout: 45_000
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
await page.waitForSelector('.nx-app', { timeout: 20_000 })

const api = (fn, arg) => page.evaluate(fn, arg)

// ---------------------------------------------------------------- lazy
const before = await api(() => window.api.types.list())
check('nothing is seeded before the first topic', !before.some((t) => ['Topic', 'Concept', 'Lesson'].includes(t.name)))
const noTopic = await api(() => window.api.learning.createConcept(null).then(() => 'made', (e) => e.message))
check('a concept is made even with no topic yet', noTopic === 'made')
const noLesson = await api(() => window.api.learning.openLesson(null).then(() => 'made', (e) => e.message))
check('a lesson with no topic is refused', /topic/i.test(noLesson), noLesson)

// ---------------------------------------------------------------- New topic, through the palette
await page.keyboard.press('Control+k')
await page.waitForSelector('.nx-palette')
await page.keyboard.type('Spanish')
await sleep(300)
await page.locator('[cmdk-item][data-value="action-new-topic"]').click()
await sleep(1200)

const s = await api(async () => {
  const types = await window.api.types.list()
  const byName = Object.fromEntries(types.map((t) => [t.name, t]))
  const pages = await window.api.pages.list()
  const topic = pages.find((p) => p.title === 'Spanish' && p.type_id === byName.Topic?.id)
  const folders = await window.api.folders.list()
  const folderPath = (id) => {
    const out = []
    for (let f = folders.find((x) => x.id === id); f; f = folders.find((x) => x.id === f.parent_folder_id)) out.unshift(f.name)
    return out.join(' / ')
  }
  const defs = {}
  for (const n of ['Topic', 'Concept', 'Lesson']) {
    defs[n] = byName[n] ? (await window.api.types.getPropertyDefinitions(byName[n].id)).map((d) => `${d.key}:${d.property_type}`) : []
  }
  const canvases = await window.api.canvases.list()
  const canvas = canvases.find((c) => c.title === 'Spanish — map')
  const canvasDoc = canvas ? JSON.parse((await window.api.canvases.get(canvas.id)).content) : null
  const views = await window.api.views.list()
  const view = views.find((v) => v.name === 'Concepts: Spanish')
  const full = topic ? await window.api.pages.getById(topic.id) : null
  return {
    byName,
    topic,
    full,
    folders: Object.fromEntries(['Topic', 'Concept', 'Lesson'].map((n) => [n, folderPath(byName[n]?.folder_id)])),
    defs,
    canvasNode: canvasDoc?.nodes?.[0] ?? null,
    viewId: view?.id ?? null,
    activePage: document.querySelector('.nx-app') ? true : false
  }
})
check('the palette made the Spanish topic', !!s.topic)
check('the topic is pinned', s.full?.is_pinned === 1)
check('types file under Notes / Topics, Notes / Concepts, Logs / Lessons',
  s.folders.Topic === 'Notes / Topics' && s.folders.Concept === 'Notes / Concepts' && s.folders.Lesson === 'Logs / Lessons',
  JSON.stringify(s.folders))
check('Concept properties', ['topic:relation', 'kind:select', 'status:select', 'due:date', 'interval:number'].every((d) => s.defs.Concept.includes(d)), s.defs.Concept.join(','))
check('Lesson properties', ['date:date', 'topic:relation', 'done:boolean', 'source:text'].every((d) => s.defs.Lesson.includes(d)), s.defs.Lesson.join(','))
check('the map canvas holds the hub', s.canvasNode?.type === 'page' && s.canvasNode?.pageId === s.topic?.id)
check('the hub body names its canvas and view', /Spanish — map/.test(s.full?.content ?? '') && /Concepts: Spanish/.test(s.full?.content ?? ''))
const topicProps = await api((id) => window.api.properties.getForPage(id), s.topic.id)
check('the topic starts active', topicProps.some((p) => p.key === 'status' && p.value_text === 'active'))

// ---------------------------------------------------------------- concepts, from the hub
const c1 = await api((id) => window.api.learning.createConcept(id), s.topic.id)
const c2 = await api(() => window.api.learning.createConcept(null)) // the only topic
const c1Props = await api((id) => window.api.properties.getForPage(id), c1.id)
const val = (props, key) => props.find((p) => p.key === key)
check('a concept from the hub points at it', val(c1Props, 'topic')?.value_relation === s.topic.id)
check('a concept starts new / derived', val(c1Props, 'status')?.value_text === 'new' && val(c1Props, 'kind')?.value_text === 'derived')
const c2Props = await api((id) => window.api.properties.getForPage(id), c2.id)
check('with one topic, a concept from nowhere joins it', val(c2Props, 'topic')?.value_relation === s.topic.id)
const body = JSON.parse(c1.content)
const headings = body.filter((b) => b.type === 'heading').map((b) => b.content.map((c) => c.text).join(''))
check('concept template sections', headings.join('|') === 'Claim|Why it has to be so|Builds on|Examples|Check', headings.join('|'))
const toggle = body.find((b) => b.type === 'toggle')
check('the check is a closed toggle with the answer inside', toggle?.props?.open === false && toggle?.children?.length === 1)

const rows = await api((id) => window.api.views.run(id), s.viewId)
check('the topic view lists its concepts (not the template, not the orphan)', rows.length === 2, `${rows.length} rows`)
const backlinks = await api((id) => window.api.links.getBacklinks(id), s.topic.id)
check('the topic page backlinks its concepts', backlinks.length >= 2, `${backlinks.length}`)

// ---------------------------------------------------------------- the due date stays out of the week
const today = await api(() => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})
await api(([id, d]) => window.api.properties.set(id, 'due', 'date', d), [c1.id, today])

// ---------------------------------------------------------------- lessons
const l1 = await api((id) => window.api.learning.openLesson(id), c1.id)
const l2 = await api((id) => window.api.learning.openLesson(id), s.topic.id)
check('one lesson per topic per day', l1.id === l2.id)
check('the lesson is titled for its topic and day', /^Spanish — \d{4}-\d{2}-\d{2}$/.test(l1.title), l1.title)
const lesson = JSON.parse(l1.content)
const table = lesson.find((b) => b.type === 'table')
check('the lesson has a vocabulary table', table?.content?.rows?.length === 2)

const dated = await api((d) => window.api.tasks.datedPages(d, d), l1.title.slice(-10))
check('the lesson shows in the Tracker, not done', dated.some((d) => d.pageId === l1.id && d.done === false))
const datedToday = await api((d) => window.api.tasks.datedPages(d, d), today)
check("a concept's review date stays out of the Tracker", !datedToday.some((d) => d.pageId === c1.id))

// ---------------------------------------------------------------- the editor renders the templates
const runAction = async (value) => {
  await page.keyboard.press('Control+k')
  await page.waitForSelector('.nx-palette')
  await page.locator(`[cmdk-item][data-value="${value}"]`).click()
  await sleep(1200)
}
await runAction('action-new-concept')
check('"New concept" opens a concept with its check toggle', (await page.locator('.nx-toggle').count()) === 1)
await runAction('action-lesson')
check('"Today\'s lesson" opens the lesson with its vocabulary table', (await page.locator('.bn-editor table').count()) === 1)

// ---------------------------------------------------------------- a second subject, and the editor renders
const dup = await api(() => window.api.learning.createTopic('spanish').then(() => 'made', (e) => e.message))
check('a duplicate topic name is refused', /already/.test(dup), dup)
const logic = await api(() => window.api.learning.createTopic('Logic'))
const logicConcept = await api((id) => window.api.learning.createConcept(id), logic.page.id)
const lcProps = await api((id) => window.api.properties.getForPage(id), logicConcept.id)
check('a second topic gets its own concepts', val(lcProps, 'topic')?.value_relation === logic.page.id)
const orphan = await api(() => window.api.learning.createConcept(null))
const oProps = await api((id) => window.api.properties.getForPage(id), orphan.id)
check('with two topics and nothing open, a concept is left unassigned', !val(oProps, 'topic')?.value_relation)

// ================================================================ step 3: review
console.log('\n— review —')
const plusDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(y, m - 1, d + n)
  const p = (k) => String(k).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
}
check('placeholder checks are not reviewed', (await api((d) => window.api.review.queue(d), today)).length === 0)

/** A concept body with a written Check, in the template's shape. */
const conceptBody = (claim, question, answer) => {
  const t = (x) => (x ? [{ type: 'text', text: x, styles: {} }] : [])
  const b = (type, x, extra = {}) => ({ id: crypto.randomUUID(), type, props: {}, content: t(x), children: [], ...extra })
  return JSON.stringify([
    b('heading', 'Claim', { props: { level: 2 } }),
    b('paragraph', claim),
    b('heading', 'Check', { props: { level: 2 } }),
    b('toggle', question, { props: { open: false }, children: [b('paragraph', answer)] })
  ])
}
const c3 = await api((id) => window.api.learning.createConcept(id), s.topic.id)
const spanish = [
  [c1.id, 'A verb ending names its subject', "In 'hablo', who is speaking?", 'yo (I): the -o ending marks yo'],
  [c2.id, 'Every noun has a gender', "Is 'la casa' masculine or feminine?", 'Feminine: la marks it'],
  [c3.id, 'Adjectives follow the noun', "Put 'red' in 'the house': la casa ___", 'roja (la casa roja)']
]
for (const [id, title, q, a] of spanish) {
  await api(([id, title, content]) => window.api.pages.update(id, { title, content }), [id, title, conceptBody(title, q, a)])
}
await api(([id, content]) => window.api.pages.update(id, { title: 'Modus ponens', content }), [
  logicConcept.id,
  conceptBody('If P then Q; P; so Q', 'If P→Q and P, what follows?', 'Q')
])

const queue = await api((d) => window.api.review.queue(d), today)
check('written checks enter review', queue.length === 4, `${queue.length}`)
check('a card carries its question and answer', queue.some((c) => c.question === "In 'hablo', who is speaking?" && /-o ending/.test(c.answer)))
check('the scheduled card comes first', queue[0]?.pageId === c1.id)
const counts = await api((d) => window.api.review.counts(d), today)
check('counts per topic', counts.find((c) => c.topicTitle === 'Spanish')?.due === 3 && counts.find((c) => c.topicTitle === 'Logic')?.due === 1, JSON.stringify(counts.map((c) => [c.topicTitle, c.due])))
const onlyLogic = await api(([d, t]) => window.api.review.queue(d, t), [today, logic.page.id])
check('the queue filters by topic', onlyLogic.length === 1 && onlyLogic[0].pageId === logicConcept.id)

// The ladder, on the Logic concept: Good climbs 1 3 7 16 35 80, Good at 80 is solid.
const ladder = []
let last
for (let i = 0; i < 7; i++) {
  last = await api(([id, d]) => window.api.review.grade(id, 'good', d), [logicConcept.id, today])
  ladder.push(`${last.interval}${last.status === 'solid' ? 's' : ''}`)
}
check('Good climbs the ladder, solid on the third Good at 16+', ladder.join(',') === '1,3,7,16,35,80,80s', ladder.join(','))
check('due is today + interval', last.due === plusDays(today, 80), last.due)
last = await api(([id, d]) => window.api.review.grade(id, 'again', d), [logicConcept.id, today])
check('Again drops to 1 and marks shaky', last.interval === 1 && last.status === 'shaky' && last.due === plusDays(today, 1))
last = await api(([id, d]) => window.api.review.grade(id, 'good', d), [logicConcept.id, today])
check('shaky holds at 3', last.interval === 3 && last.status === 'shaky')
last = await api(([id, d]) => window.api.review.grade(id, 'good', d), [logicConcept.id, today])
check('shaky clears to new at 7', last.interval === 7 && last.status === 'new')
const loggedProps = await api((id) => window.api.properties.getForPage(id), logicConcept.id)
check('the schedule is written as visible properties',
  val(loggedProps, 'interval')?.value_number === 7 && val(loggedProps, 'due')?.value_date === plusDays(today, 7))

// ---------------------------------------------------------------- the review, from Home, by keyboard
const nav = (label) =>
  page.evaluate((label) => {
    const item = [...document.querySelectorAll('.nx-nav-item')].find((el) => el.textContent.trim() === label)
    item?.click()
    return !!item
  }, label)
await nav('Home')
await sleep(1200)
if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'review-home.png') })
const widgetText = await page.evaluate(() => document.querySelector('.nx-home__grid')?.innerText ?? '')
check('Home shows "Due for review" (added by the first topic)', /Due for review/i.test(widgetText) && /Spanish · 3 due/.test(widgetText), widgetText.slice(0, 200))
await page.getByRole('button', { name: /Review 3/ }).click()
await sleep(800)
check('the widget opens Tracker → Review', (await page.locator('[data-testid="review-card"]').count()) === 1)
const cardText = () => page.evaluate(() => document.querySelector('[data-testid="review-card"]')?.innerText ?? '')
check('the question shows, the answer does not', /hablo/.test(await cardText()) && !/-o ending/.test(await cardText()))
const key = async (k) => {
  await page.keyboard.press(k)
  await sleep(350)
}
await key('Space')
check('Space shows the answer', /-o ending/.test(await cardText()))
if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'review-card.png') })
await key('2') // c1: Good
await key('Space')
await key('1') // c2: Again
await key('Space')
await key('2') // c3: Good
check('a missed card comes back once, for practice', /for practice/.test(await cardText()) && /la casa/.test(await cardText()))
await key('Space')
await key('2')
const doneText = await page.evaluate(() => document.querySelector('.nx-review')?.innerText ?? '')
check('the sitting ends with what was missed', /Reviewed 3, missed 1/.test(doneText) && /Every noun has a gender/.test(doneText), doneText.slice(0, 120))
const p1 = await api((id) => window.api.properties.getForPage(id), c1.id)
const p2 = await api((id) => window.api.properties.getForPage(id), c2.id)
check('Good wrote interval 1, due tomorrow', val(p1, 'interval')?.value_number === 1 && val(p1, 'due')?.value_date === plusDays(today, 1))
check('Again wrote shaky', val(p2, 'status')?.value_text === 'shaky')
check('the practice repeat wrote nothing more', val(p2, 'interval')?.value_number === 1)
check('nothing left due today', (await api((d) => window.api.review.queue(d), today)).length === 0)
check('tomorrow, all three Spanish cards are due', (await api((d) => window.api.review.queue(d), plusDays(today, 1))).length === 3)

check('no renderer errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await app.close()
console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
