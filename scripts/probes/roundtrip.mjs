/** Export → import round trip, and export filename collisions. */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
const APP = process.env.APP_DIR
const log = (...a) => console.log(...a)
const app = await electron.launch({
  executablePath: join(APP, 'node_modules/electron/dist/electron'),
  args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'nexus-rt-'))}`, APP],
  cwd: APP, env: { ...process.env, NODE_ENV: 'production' }, timeout: 45_000
})
const page = await app.firstWindow()
await page.waitForSelector('.nx-app', { timeout: 20_000 })

const r = await page.evaluate(async () => {
  const uid = () => crypto.randomUUID()
  const doc = [
    { id: uid(), type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Arrhenius', styles: {} }], children: [] },
    { id: uid(), type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Rate depends on temperature.', styles: {} }], children: [] },
    { id: uid(), type: 'bulletListItem', props: {}, content: [{ type: 'text', text: 'first item', styles: {} }], children: [] },
    { id: uid(), type: 'checkListItem', props: { checked: true }, content: [{ type: 'text', text: 'done thing', styles: {} }], children: [] },
    { id: uid(), type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: 'open thing @2026-09-01', styles: {} }], children: [] },
    { id: uid(), type: 'quote', props: {}, content: [{ type: 'text', text: 'a quotation', styles: {} }], children: [] }
  ]
  const p = await window.api.pages.create()
  await window.api.pages.update(p.id, { title: 'Kinetics', content: JSON.stringify(doc) })

  // two pages sharing a title, to check filename disambiguation
  for (const t of ['Duplicate', 'Duplicate']) {
    const d = await window.api.pages.create()
    await window.api.pages.update(d.id, { title: t, content: '[]' })
  }

  const files = await window.api.io.exportAllMarkdown()
  const md = files.find((f) => f.filename === 'Kinetics.md')
  const imported = await window.api.io.importMarkdown(md.content, 'Kinetics.md')
  const back = JSON.parse(imported.content)
  const tasks = await window.api.tasks.forPage(imported.id)
  return {
    filenames: files.map((f) => f.filename).sort(),
    exported: md.content,
    types: back.map((b) => b.type),
    everyBlockHasAnId: back.every((b) => typeof b.id === 'string' && b.id.length > 0),
    checked: back.filter((b) => b.type === 'checkListItem').map((b) => b.props.checked),
    tasks: tasks.map((t) => [t.text, t.isDone, t.dueDate])
  }
})
log('export filenames:', JSON.stringify(r.filenames))
log('\nexported markdown:\n' + r.exported.split('\n').map((l) => '  | ' + l).join('\n'))
log('\nre-imported block types:', JSON.stringify(r.types))
log('every block has an id:', r.everyBlockHasAnId)
log('checkbox states preserved:', JSON.stringify(r.checked))
log('tasks projected from the import:', JSON.stringify(r.tasks))
await app.close()
process.exit(0)
