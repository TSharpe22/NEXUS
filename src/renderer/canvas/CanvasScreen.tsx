import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { Canvas, CanvasListItem } from '@shared/canvas'
import { useAppStore } from '../store/app-store'
import { Button } from '../design/Button'
import { EmptyState } from '../design/EmptyState'
import { confirmDialog } from '../design/Confirm'
import { useDebounce } from '../hooks/use-debounce'
import { registerPendingWrite } from '../pending-writes'
import { relativeTime } from '../hooks/use-relative-time'
import { CanvasBoard } from './CanvasBoard'
import './Canvas.css'

/**
 * The Canvas section: a list of canvases on the left, the open one on the right.
 *
 * Its own section rather than a kind of page, by choice. A canvas is not in
 * the Notes tree, carries no tags and cannot be pinned — the table is shaped
 * so any of those can be added as a column later without touching a document.
 */
export function CanvasScreen() {
  const canvases = useAppStore((s) => s.canvases)
  const activeCanvasId = useAppStore((s) => s.activeCanvasId)
  const setActiveCanvasId = useAppStore((s) => s.setActiveCanvasId)
  const refreshCanvases = useAppStore((s) => s.refreshCanvases)
  const setSaveStatus = useAppStore((s) => s.setSaveStatus)

  const [canvas, setCanvas] = useState<Canvas | null>(null)
  const [title, setTitle] = useState('')
  const [showTrash, setShowTrash] = useState(false)
  const [trashed, setTrashed] = useState<CanvasListItem[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void refreshCanvases().then(() => setLoaded(true))
  }, [refreshCanvases])

  // Open the most recent canvas when none is chosen, rather than an empty pane
  // asking you to pick the thing you were obviously about to pick.
  useEffect(() => {
    if (loaded && !activeCanvasId && canvases.length > 0 && !showTrash) setActiveCanvasId(canvases[0].id)
  }, [loaded, activeCanvasId, canvases, showTrash, setActiveCanvasId])

  useEffect(() => {
    let cancelled = false
    if (!activeCanvasId) {
      setCanvas(null)
      return
    }
    void window.api.canvases.get(activeCanvasId).then((next) => {
      if (cancelled) return
      setCanvas(next)
      setTitle(next?.title ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [activeCanvasId])

  const loadTrash = useCallback(async () => setTrashed(await window.api.canvases.listTrashed()), [])
  useEffect(() => {
    if (showTrash) void loadTrash()
  }, [showTrash, loadTrash])

  const saveTitle = useDebounce(async (id: string, next: string) => {
    setSaveStatus('saving')
    try {
      await window.api.canvases.update(id, { title: next })
      await refreshCanvases()
      setSaveStatus('saved')
    } catch (e) {
      console.error('[nexus] failed to rename canvas', e)
      setSaveStatus('error')
    }
  }, 500)
  useEffect(() => registerPendingWrite(() => saveTitle.flush()), [saveTitle])

  const create = async () => {
    const made = await window.api.canvases.create('')
    setShowTrash(false)
    await refreshCanvases()
    setActiveCanvasId(made.id)
  }

  const trash = async (id: string) => {
    await window.api.canvases.trash(id)
    if (id === activeCanvasId) setActiveCanvasId(null)
    await refreshCanvases()
    toast.success('Canvas moved to the trash')
  }

  const restore = async (id: string) => {
    await window.api.canvases.restore(id)
    await Promise.all([refreshCanvases(), loadTrash()])
    setShowTrash(false)
    setActiveCanvasId(id)
  }

  const removeForever = async (item: CanvasListItem) => {
    const ok = await confirmDialog({
      title: 'Delete this canvas for good?',
      message: `“${item.title || 'Untitled'}” and its cards are removed. The pages on it are not touched.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    await window.api.canvases.remove(item.id)
    await loadTrash()
  }

  const list = showTrash ? trashed : canvases

  return (
    <div className="nx-canvas-screen">
      <aside className="nx-canvas-rail">
        <div className="nx-canvas-rail__top">
          <Button onClick={() => void create()} style={{ width: '100%' }}>
            New canvas
          </Button>
        </div>
        <div className="nx-canvas-rail__list">
          {showTrash && <div className="nx-type-label nx-canvas-rail__head">Trash</div>}
          {list.length === 0 && (
            <div className="nx-canvas-rail__empty nx-type-data">
              {showTrash ? 'nothing in the trash' : loaded ? 'no canvases yet' : ''}
            </div>
          )}
          {list.map((item) => (
            <div
              key={item.id}
              data-canvas-id={item.id}
              className={`nx-canvas-rail__item ${!showTrash && item.id === activeCanvasId ? 'is-active' : ''}`}
            >
              <button
                className="nx-canvas-rail__open"
                onClick={() => (showTrash ? undefined : setActiveCanvasId(item.id))}
                disabled={showTrash}
              >
                <span className="nx-canvas-rail__name">{item.title || 'Untitled'}</span>
                <span className="nx-canvas-rail__meta nx-type-data">{relativeTime(item.updated_at)}</span>
              </button>
              {showTrash ? (
                <span className="nx-canvas-rail__actions">
                  <button onClick={() => void restore(item.id)}>restore</button>
                  <button className="is-danger" onClick={() => void removeForever(item)}>
                    delete
                  </button>
                </span>
              ) : (
                <span className="nx-canvas-rail__actions nx-canvas-rail__actions--hover">
                  <button onClick={() => void trash(item.id)} title="Move to trash">
                    trash
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
        <button className="nx-canvas-rail__trash nx-type-data" onClick={() => setShowTrash((v) => !v)}>
          {showTrash ? '← canvases' : 'trash'}
        </button>
      </aside>

      <section className="nx-canvas-main">
        {canvas && !showTrash ? (
          <>
            <div className="nx-canvas-main__head">
              <input
                className="nx-canvas-main__title"
                value={title}
                placeholder="Untitled canvas"
                spellCheck={false}
                onChange={(e) => {
                  setTitle(e.target.value)
                  saveTitle.call(canvas.id, e.target.value)
                }}
              />
            </div>
            <CanvasBoard key={canvas.id} canvas={canvas} />
          </>
        ) : (
          <EmptyState
            text={showTrash ? 'Trashed canvases' : 'No canvas open'}
            meta={showTrash ? 'restore one to open it' : 'cards, pages and arrows on an open board'}
            action={showTrash ? undefined : <Button onClick={() => void create()}>New canvas</Button>}
          />
        )}
      </section>
    </div>
  )
}
