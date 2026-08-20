import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import { useAppStore } from '../store/app-store'
import { relativeTime } from '../hooks/use-relative-time'
import type { MirrorConfig, BackupInfo } from '@shared/types'
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
  const [backups, setBackups] = useState<BackupInfo | null>(null)
  const [mirror, setMirror] = useState<MirrorConfig | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    window.api.stats.getDataDir().then(setDataDir)
    window.api.stats.getBackups().then(setBackups)
    window.api.mirror.getConfig().then(setMirror)
  }, [])

  const chooseMirrorFolder = async () => {
    const folder = await window.api.dialog.showSelectFolder()
    if (!folder) return
    try {
      setMirror(await window.api.mirror.setFolder(folder))
      setSyncing(true)
      const result = await window.api.mirror.syncNow()
      setMirror(await window.api.mirror.getConfig())
      toast.success(`Mirroring to ${folder} — ${result.written} file(s) written`)
    } catch (e) {
      console.error('[nexus] could not set the mirror folder', e)
      toast.error('Could not set the mirror folder')
    } finally {
      setSyncing(false)
    }
  }

  const toggleMirror = async () => {
    if (!mirror) return
    try {
      setMirror(await window.api.mirror.setEnabled(!mirror.enabled))
    } catch {
      toast.error('Could not change the vault mirror')
    }
  }

  const syncMirrorNow = async () => {
    setSyncing(true)
    try {
      const r = await window.api.mirror.syncNow()
      setMirror(await window.api.mirror.getConfig())
      toast.success(`Mirrored — ${r.written} written, ${r.deleted} removed, ${r.unchanged} unchanged`)
    } catch {
      toast.error('Vault mirror sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const reveal = async (target: string) => {
    const problem = await window.api.shell.openPath(target)
    if (problem) toast.error('Could not open that folder')
  }

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
          <Button variant="ghost" onClick={() => reveal(dataDir)} disabled={!dataDir}>
            Open
          </Button>
        </div>
        <div className="nx-settings__row">
          <div>
            <div className="nx-type-body">Snapshots</div>
            <div className="nx-type-data">
              {backups && backups.count > 0
                ? `${backups.count} kept — a copy of the database is taken each time Nexus starts, if anything changed since the last one.`
                : 'A copy of the database is taken each time Nexus starts, if anything changed since the last one.'}
            </div>
            {backups?.latest && (
              <div className="nx-type-data nx-settings__path">Newest: {backups.latest}</div>
            )}
          </div>
          <Button
            variant="ghost"
            onClick={() => backups && reveal(backups.folder)}
            disabled={!backups || backups.count === 0}
          >
            Open
          </Button>
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

      <Panel title="Vault mirror">
        <div className="nx-settings__row">
          <div>
            <div className="nx-type-body">Mirror folder</div>
            <div className="nx-type-data nx-settings__path">
              {mirror?.folder ?? 'Not set — the mirror is off'}
            </div>
            <div className="nx-type-data">
              Writes every page as a Markdown file, mirroring your folder tree, so other
              tools and assistants can read the vault directly. One-way: edits made to
              those files are not read back.
            </div>
          </div>
          <Button variant="ghost" onClick={chooseMirrorFolder} disabled={syncing}>
            {mirror?.folder ? 'Change…' : 'Choose…'}
          </Button>
        </div>

        {mirror?.folder && (
          <>
            <div className="nx-settings__row">
              <div>
                <div className="nx-type-body">{mirror.enabled ? 'On' : 'Off'}</div>
                <div className="nx-type-data">
                  {mirror.lastSyncAt
                    ? `Last synced ${relativeTime(mirror.lastSyncAt)}`
                    : 'Not synced yet'}
                </div>
              </div>
              <Button variant="ghost" onClick={toggleMirror}>
                {mirror.enabled ? 'Turn off' : 'Turn on'}
              </Button>
            </div>
            <div className="nx-settings__row">
              <div>
                <div className="nx-type-body">Sync now</div>
                <div className="nx-type-data">
                  Normally automatic a moment after each change.
                </div>
              </div>
              <Button variant="ghost" onClick={syncMirrorNow} disabled={syncing || !mirror.enabled}>
                {syncing ? 'Syncing…' : 'Sync'}
              </Button>
            </div>
          </>
        )}
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
