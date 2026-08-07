import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import { useAppStore } from '../store/app-store'
import './Settings.css'

const SHORTCUTS: [string, string][] = [
  ['Cmd/Ctrl + K', 'Search pages and jump between views'],
  ['Cmd/Ctrl + N', 'New page'],
  ['/', 'Block menu (headings, lists, toggle, callout…)'],
  ['[[', 'Link to another page'],
  ['Cmd/Ctrl + B / I / U', 'Bold, italic, underline']
]

export function Settings() {
  const refresh = useAppStore((s) => s.refresh)
  const pages = useAppStore((s) => s.pages)
  const [dataDir, setDataDir] = useState('')

  useEffect(() => {
    window.api.stats.getDataDir().then(setDataDir)
  }, [])

  const exportAll = async () => {
    if (pages.length === 0) {
      toast.error('Nothing to export yet')
      return
    }
    const folder = await window.api.dialog.showSelectFolder()
    if (!folder) return
    const files = await window.api.io.exportAllMarkdown()
    await window.fs.writeFiles(folder, files)
    toast.success(`Exported ${files.length} page${files.length === 1 ? '' : 's'}`)
  }

  const importFiles = async () => {
    const paths = await window.api.dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Nexus content', extensions: ['md', 'json'] }]
    })
    if (!paths || paths.length === 0) return

    let imported = 0
    let failed = 0
    for (const filePath of paths) {
      try {
        const content = await window.fs.readFile(filePath)
        // Windows paths use backslashes; splitting on '/' alone kept the whole
        // path as the fallback title.
        const filename = filePath.split(/[/\\]/).pop() ?? filePath
        if (filename.endsWith('.json')) await window.api.io.importJSON(content)
        else await window.api.io.importMarkdown(content, filename)
        imported++
      } catch (e) {
        console.error('[nexus] import failed', filePath, e)
        failed++
      }
    }

    await refresh()
    if (imported) toast.success(`Imported ${imported} file${imported === 1 ? '' : 's'}`)
    if (failed) toast.error(`${failed} file${failed === 1 ? '' : 's'} could not be imported`)
  }

  return (
    <div className="nx-settings">
      <Panel title="Data">
        <div className="nx-settings__row">
          <div>
            <div className="nx-type-body">Database location</div>
            <div className="nx-type-data nx-settings__path">{dataDir || '—'}</div>
          </div>
        </div>
        <div className="nx-settings__row">
          <div>
            <div className="nx-type-body">Export all pages as Markdown</div>
            <div className="nx-type-data">One .md file per page, into a folder you choose.</div>
          </div>
          <Button variant="ghost" onClick={exportAll}>
            Export
          </Button>
        </div>
        <div className="nx-settings__row">
          <div>
            <div className="nx-type-body">Import Markdown or JSON</div>
            <div className="nx-type-data">Each file becomes a new page.</div>
          </div>
          <Button variant="ghost" onClick={importFiles}>
            Import
          </Button>
        </div>
      </Panel>

      <Panel title="Shortcuts">
        <div className="nx-settings__shortcuts">
          {SHORTCUTS.map(([key, label]) => (
            <div className="nx-settings__shortcut" key={key}>
              <span className="nx-type-body">{label}</span>
              <span className="nx-settings__kbd">{key}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="About">
        <div className="nx-settings__row">
          <span className="nx-type-body">Theme</span>
          <span className="nx-type-data">Dark</span>
        </div>
        <div className="nx-settings__row">
          <span className="nx-type-body">Network access</span>
          <span className="nx-type-data">None — Nexus runs fully offline</span>
        </div>
      </Panel>
    </div>
  )
}
