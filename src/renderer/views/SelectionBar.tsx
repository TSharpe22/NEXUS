import { useState } from 'react'
import toast from 'react-hot-toast'
import type { PageListItem } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { Button } from '../design/Button'
import { confirmDialog } from '../design/Confirm'

/**
 * What to do with several pages at once.
 *
 * Everything here could be done one page at a time already, which is exactly
 * the problem: filing a week of captures meant twenty drags, and tagging a
 * reading list meant opening every book. A second brain accumulates faster than
 * it can be tidied one row at a time.
 *
 * Export is here rather than on a row for the same reason it was missing:
 * `io.exportPageMarkdown` has existed, tested, reachable from nothing, because
 * Settings only ever offered the whole vault. One selected page exported from
 * here *is* the single-page export, and the same control does forty.
 */
export function SelectionBar({
  selected,
  pages,
  onClear
}: {
  selected: ReadonlySet<string>
  /** The pages currently in the list, so a selection can be resolved to rows. */
  pages: PageListItem[]
  onClear: () => void
}) {
  const folders = useAppStore((s) => s.folders)
  const tags = useAppStore((s) => s.tags)
  const movePageToFolder = useAppStore((s) => s.movePageToFolder)
  const addTag = useAppStore((s) => s.addTag)
  const trashPage = useAppStore((s) => s.trashPage)
  const refresh = useAppStore((s) => s.refresh)
  const [busy, setBusy] = useState(false)

  const chosen = pages.filter((p) => selected.has(p.id))
  if (chosen.length === 0) return null

  const count = `${chosen.length} page${chosen.length === 1 ? '' : 's'}`

  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await work()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const move = (folderId: string | null) =>
    run(async () => {
      // Sequential rather than in parallel: each of these writes a page, and
      // every write reprojects and schedules a mirror sync. Forty at once is
      // forty main-process passes racing the one after it.
      for (const page of chosen) await movePageToFolder(page.id, folderId)
      toast.success(`Moved ${count}`)
      onClear()
    })

  const tag = (name: string) =>
    run(async () => {
      for (const page of chosen) await addTag(page.id, name)
      toast.success(`Tagged ${count}`)
    })

  const exportAs = (format: 'md' | 'json') =>
    run(async () => {
      const folder = await window.api.dialog.showSelectFolder()
      if (!folder) return

      const used = new Set<string>()
      const files = []
      for (const page of chosen) {
        const content =
          format === 'md'
            ? await window.api.io.exportPageMarkdown(page.id)
            : await window.api.io.exportPageJSON(page.id)
        // Two pages can share a title, and the writer overwrites — the same
        // collision `exportAllMarkdown` disambiguates, and for the same reason.
        const base = (page.title || 'untitled').replace(/[/\\?%*:|"<>]/g, '-').trim() || 'untitled'
        let filename = `${base}.${format}`
        for (let n = 2; used.has(filename.toLowerCase()); n++) filename = `${base} (${n}).${format}`
        used.add(filename.toLowerCase())
        files.push({ filename, content })
      }

      await window.fs.writeFiles(folder, files)
      toast.success(`Exported ${count}`)
    })

  const trash = () =>
    run(async () => {
      const accepted = await confirmDialog({
        title: `Move ${count} to the trash?`,
        message: 'They can be restored from the trash afterwards.',
        confirmLabel: 'Move to trash',
        danger: true
      })
      if (!accepted) return
      for (const page of chosen) await trashPage(page.id)
      await refresh()
      toast.success(`Trashed ${count}`)
      onClear()
    })

  return (
    <div className="nx-selection">
      <span className="nx-selection__count nx-type-label">{count} selected</span>

      <select
        className="nx-select nx-selection__control"
        value=""
        disabled={busy}
        onChange={(e) => {
          const value = e.target.value
          if (!value) return
          void move(value === '__root__' ? null : value)
        }}
      >
        <option value="">Move to…</option>
        <option value="__root__">the root</option>
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.name}
          </option>
        ))}
      </select>

      <select
        className="nx-select nx-selection__control"
        value=""
        disabled={busy || tags.length === 0}
        title={tags.length === 0 ? 'No tags yet — add one on a page first' : 'Add a tag to all of these'}
        onChange={(e) => {
          if (!e.target.value) return
          void tag(e.target.value)
        }}
      >
        <option value="">Tag…</option>
        {tags.map((t) => (
          <option key={t.id} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>

      <select
        className="nx-select nx-selection__control"
        value=""
        disabled={busy}
        onChange={(e) => {
          if (!e.target.value) return
          void exportAs(e.target.value as 'md' | 'json')
        }}
      >
        <option value="">Export…</option>
        <option value="md">as Markdown</option>
        <option value="json">as JSON</option>
      </select>

      <Button variant="ghost" disabled={busy} onClick={() => void trash()}>
        Trash
      </Button>
      <Button variant="quiet" onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}
