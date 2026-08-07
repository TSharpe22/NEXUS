import toast from 'react-hot-toast'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import './Settings.css'

const SHORTCUTS: [string, string][] = [
  ['Cmd/Ctrl + K', 'Command palette'],
  ['Cmd/Ctrl + N', 'New page'],
  ['[[', 'Link to a page'],
  ['/', 'Slash command menu']
]

export function Settings() {
  const exportAll = async () => {
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
    for (const filePath of paths) {
      const content = await window.fs.readFile(filePath)
      const filename = filePath.split('/').pop() ?? filePath
      if (filename.endsWith('.json')) await window.api.io.importJSON(content)
      else await window.api.io.importMarkdown(content, filename)
      imported++
    }
    toast.success(`Imported ${imported} file${imported === 1 ? '' : 's'}`)
  }

  return (
    <div className="nx-settings">
      <Panel title="Appearance">
        <div className="nx-settings__row">
          <span className="nx-type-body">Accent</span>
          <span className="nx-type-data">
            <span className="nx-settings__accent-swatch" />
            amber
          </span>
        </div>
        <div className="nx-settings__row" style={{ marginTop: 'var(--nx-space-3)' }}>
          <span className="nx-type-body">Theme</span>
          <span className="nx-type-data">dark (fixed)</span>
        </div>
      </Panel>

      <Panel title="Data">
        <div className="nx-settings__row">
          <span className="nx-type-body">Export all pages as Markdown</span>
          <Button variant="ghost" onClick={exportAll}>
            Export
          </Button>
        </div>
        <div className="nx-settings__row" style={{ marginTop: 'var(--nx-space-3)' }}>
          <span className="nx-type-body">Import Markdown / JSON files</span>
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
    </div>
  )
}
