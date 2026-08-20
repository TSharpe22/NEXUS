import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import type {
  CaptureTarget,
  GraphData,
  Page,
  PageListItem,
  StorageStats,
  TrackerTask
} from '@shared/types'
import { STALE_DAYS, dayOfYear, isOlderThan, isoWeek } from '@shared/date-range'
import { documentPreview } from '@shared/document'
import { localDateISO } from '@shared/journal-date'
import { useAppStore } from '../store/app-store'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import { EmptyState } from '../design/EmptyState'
import { ErrorState } from '../design/ErrorState'
import { Icon } from '../design/Icon'
import { GraphView } from './GraphView'
import { HabitStrips, STRIP_DAYS } from './HabitStrips'
import { relativeTime } from '../hooks/use-relative-time'
import './Home.css'

/**
 * Home — the day.
 *
 * Nexus opens here, so this screen answers what today is: the journal entry,
 * what is due, whether the habits are alive, and one box to capture into
 * without going anywhere. The instrument panel — graph, vault, what has gone
 * quiet — sits underneath it rather than above.
 *
 * Everything here is a view over something that already exists. There is no
 * Home-specific storage and no Home-specific projection: tasks come from the
 * `tasks` table, habits from two properties on a user-made type, pinned and
 * stale from `pages`. The one thing Home added to the model is the pin, and
 * that is a flag on a page rather than a table of its own.
 */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const CAPTURE_TARGETS: { value: CaptureTarget; label: string; hint: string }[] = [
  { value: 'page', label: 'New page', hint: 'A page of its own, ready to type or link' },
  { value: 'journal', label: "Today's entry", hint: "Appended to today's journal entry" },
  { value: 'task', label: 'Task', hint: "A checkbox in today's entry — @2026-08-22 sets a due date" }
]

/** How many rows each of the short side panels shows before it stops. */
const SIDE_ROWS = 7

/**
 * `GraphView` takes a pixel height rather than filling its box, so this has to
 * match the bottom row's height in `Home.css` less the dense panel's header.
 */
const GRAPH_HEIGHT = 210

// ------------------------------------------------------------------
// Pieces
// ------------------------------------------------------------------

function TaskRow({ task, onToggle, onOpen }: {
  task: TrackerTask
  onToggle: (task: TrackerTask) => void
  onOpen: (pageId: string) => void
}) {
  return (
    <div className={`nx-home__task ${task.isDone ? 'nx-home__task--done' : ''}`}>
      <button
        className="nx-home__check"
        onClick={() => onToggle(task)}
        aria-pressed={task.isDone}
        title={task.isDone ? 'Mark as not done' : 'Mark as done'}
      >
        <Icon
          shape="square"
          filled={task.isDone}
          size={13}
          color={task.isDone ? 'var(--nx-accent)' : 'var(--nx-text-dim)'}
        />
      </button>
      <span className="nx-home__task-text">{task.text || 'Untitled task'}</span>
      <button className="nx-home__task-src nx-type-data" onClick={() => onOpen(task.pageId)}>
        {task.pageTitle || 'Untitled'}
      </button>
    </div>
  )
}

function PageRow({ page, meta, shape, onOpen, onRemove, removeTitle }: {
  page: PageListItem
  meta: string
  shape: 'diamond' | 'circle'
  onOpen: (id: string) => void
  onRemove?: (id: string) => void
  removeTitle?: string
}) {
  return (
    <div className="nx-home__row">
      <button className="nx-home__row-open" onClick={() => onOpen(page.id)}>
        <Icon shape={shape} size={11} color="var(--nx-text-dim)" />
        <span className="nx-home__row-title">{page.title || 'Untitled'}</span>
        <span className="nx-home__row-meta nx-type-data">{meta}</span>
      </button>
      {onRemove && (
        <button className="nx-home__row-x" title={removeTitle} onClick={() => onRemove(page.id)}>
          ×
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// Home
// ------------------------------------------------------------------

export function Home() {
  const openPage = useAppStore((s) => s.openPage)
  const createPage = useAppStore((s) => s.createPage)
  const openTodayEntry = useAppStore((s) => s.openTodayEntry)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setTrackerMode = useAppStore((s) => s.setTrackerMode)
  const setPagePinned = useAppStore((s) => s.setPagePinned)
  const capture = useAppStore((s) => s.capture)
  const patchPage = useAppStore((s) => s.patchPage)
  const pages = useAppStore((s) => s.pages)
  const types = useAppStore((s) => s.types)

  const [entry, setEntry] = useState<Page | null>(null)
  const [todayTasks, setTodayTasks] = useState<TrackerTask[]>([])
  const [overdue, setOverdue] = useState<TrackerTask[]>([])
  const [storage, setStorage] = useState<StorageStats | null>(null)
  const [graph, setGraph] = useState<GraphData>({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Bumped by anything Home itself changes — a capture, a task ticked off.
  // The page list cannot serve as that signal: capturing into today's entry
  // edits a page rather than adding one, so the list comes back the same
  // length and nothing would reload.
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((n) => n + 1), [])

  const today = localDateISO()

  const loadDay = useCallback(async () => {
    try {
      const [todayEntry, dueToday, late, stats] = await Promise.all([
        // `peek`, never `today()`: the latter creates the entry, and merely
        // looking at a dashboard must not write to the vault.
        window.api.journal.peek(),
        window.api.tasks.inRange(today, today),
        window.api.tasks.overdue(today),
        window.api.stats.getStorage()
      ])
      setEntry(todayEntry)
      setTodayTasks(dueToday)
      setOverdue(late)
      setStorage(stats)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [today])

  useEffect(() => {
    void loadDay()
  }, [loadDay, pages.length, reloadKey])

  // Fetched on the page count rather than on `pages`, which is a fresh array
  // after every mutation. `GraphView` restarts its simulation whenever the
  // node list changes identity, so refetching on each keystroke's save would
  // leave the layout permanently unsettled.
  useEffect(() => {
    let cancelled = false
    void window.api.stats.getGraph().then((data) => {
      if (!cancelled) setGraph(data)
    })
    return () => {
      cancelled = true
    }
  }, [pages.length])

  const pinned = useMemo(
    () =>
      pages
        .filter((p) => p.is_pinned)
        // By when the pin was made, not when the page was last touched: a pin
        // kept for a month should not drop below one made today just because
        // the newer page is the one being edited.
        .sort((a, b) => (a.pinned_at ?? '').localeCompare(b.pinned_at ?? '')),
    [pages]
  )

  const stale = useMemo(
    () =>
      pages
        // A pin says the page matters; calling it neglected in the same breath
        // is noise, so a pinned page is never stale.
        .filter((p) => !p.is_pinned && isOlderThan(p.updated_at, STALE_DAYS))
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at)),
    [pages]
  )

  const toggleTask = async (task: TrackerTask) => {
    try {
      const page = await window.api.tasks.setDone(task.pageId, task.blockId, !task.isDone)
      // The write went into the block, so the renderer's cached body for that
      // page is now behind. Handing a stale document back to the editor is how
      // a page saves over what was changed elsewhere.
      patchPage(page.id, { content: page.content, updated_at: page.updated_at })
      reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const doneToday = todayTasks.filter((t) => t.isDone).length

  if (loading) return <div className="nx-type-data">Loading…</div>

  if (error) {
    return (
      <ErrorState
        label="Could not load Home"
        detail={error}
        onRetry={() => {
          setLoading(true)
          void loadDay()
        }}
      />
    )
  }

  if (pages.length === 0) {
    return (
      <EmptyState
        text="Nothing here yet"
        meta="Nexus is empty. Start today's entry, or make a page — everything on this screen fills in from what you write."
        action={
          <div className="nx-home__empty-actions">
            <Button onClick={() => void openTodayEntry()}>Start today's entry</Button>
            <Button variant="ghost" onClick={() => void createPage()}>
              New page
            </Button>
          </div>
        }
      />
    )
  }

  return (
    <div className="nx-home">
      <DayHeader />

      <CaptureBar onCapture={capture} onCaptured={reload} openPage={openPage} />

      <div className="nx-home__grid nx-home__grid--top">
        <Panel
          title="Today"
          actions={
            <button
              className="nx-home__link nx-type-data"
              onClick={() => {
                setTrackerMode('week')
                setActiveView('tracker')
              }}
            >
              tracker →
            </button>
          }
        >
          {entry ? (
            <button className="nx-home__entry" onClick={() => openPage(entry.id)}>
              <span className="nx-home__entry-head">
                <span className="nx-home__entry-title">{entry.title || 'Untitled'}</span>
                <span className="nx-type-data">
                  {types.find((t) => t.id === entry.type_id)?.name ?? 'Note'} ·{' '}
                  {relativeTime(entry.updated_at)}
                </span>
                <span className="nx-home__entry-open nx-type-data">open →</span>
              </span>
              <span className="nx-home__entry-preview">
                {documentPreview(entry.content, 180) || 'Empty so far.'}
              </span>
            </button>
          ) : (
            <div className="nx-home__entry nx-home__entry--absent">
              <span className="nx-home__entry-absent-text">No entry for today yet</span>
              <Button onClick={() => void openTodayEntry()}>Start today&apos;s entry</Button>
            </div>
          )}

          <div className="nx-home__section">
            <span className="nx-type-label">Tasks · today</span>
            <span className="nx-type-data">
              {todayTasks.length === 0 ? 'nothing due' : `${doneToday} of ${todayTasks.length} done`}
            </span>
          </div>

          <div className="nx-home__list nx-home__list--grow">
            {todayTasks.length === 0 ? (
              <div className="nx-home__hint nx-type-data">
                Nothing dated today. A checkbox on any page counts — write
                <span className="nx-home__code"> @{today}</span> in it to date it by hand.
              </div>
            ) : (
              todayTasks.map((task) => (
                <TaskRow
                  key={`${task.pageId}:${task.blockId}`}
                  task={task}
                  onToggle={toggleTask}
                  onOpen={openPage}
                />
              ))
            )}
          </div>

          {overdue.length > 0 && (
            <button
              className="nx-home__overdue"
              onClick={() => {
                setTrackerMode('week')
                setActiveView('tracker')
              }}
            >
              <Icon shape="circle" size={12} color="var(--nx-critical)" />
              <span className="nx-home__overdue-count">
                {overdue.length} overdue
              </span>
              <span className="nx-type-data nx-home__overdue-list">
                {overdue.slice(0, 3).map((t) => t.text || 'Untitled task').join(' · ')}
              </span>
            </button>
          )}
        </Panel>

        <Panel
          title="Habits"
          actions={
            <button
              className="nx-home__link nx-type-data"
              onClick={() => {
                setTrackerMode('habits')
                setActiveView('tracker')
              }}
            >
              {`last ${STRIP_DAYS} days · year →`}
            </button>
          }
        >
          <HabitStrips onOpen={openPage} />
        </Panel>

        <Panel title="Pinned" actions={<span className="nx-type-data">{pinned.length || ''}</span>}>
          {pinned.length === 0 ? (
            <div className="nx-home__hint nx-type-data">
              Nothing pinned. Hover a page in Notes and hit Pin to keep it here.
            </div>
          ) : (
            <div className="nx-home__list">
              {pinned.slice(0, SIDE_ROWS).map((page) => (
                <PageRow
                  key={page.id}
                  page={page}
                  shape="diamond"
                  meta={types.find((t) => t.id === page.type_id)?.name ?? 'Note'}
                  onOpen={openPage}
                  onRemove={(id) => void setPagePinned(id, false)}
                  removeTitle="Unpin"
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="nx-home__grid nx-home__grid--bottom">
        {/* No `actions` here: GraphView draws its own legend with the same
            counts and the same hints, and a second copy in the panel header
            wrapped to two lines and pushed the graph out of its row. */}
        <Panel title="Graph" dense actions={<span className="nx-type-data">click a node to open it</span>}>
          <GraphView graph={graph} height={GRAPH_HEIGHT} />
        </Panel>

        <Panel
          title="Stale"
          actions={<span className="nx-type-data">untouched {STALE_DAYS}d+</span>}
        >
          {stale.length === 0 ? (
            <div className="nx-home__hint nx-type-data">
              Nothing has gone quiet for {STALE_DAYS} days.
            </div>
          ) : (
            <div className="nx-home__list">
              {stale.slice(0, 5).map((page) => (
                <PageRow
                  key={page.id}
                  page={page}
                  shape="circle"
                  meta={relativeTime(page.updated_at)}
                  onOpen={openPage}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Vault">
          {storage && (
            <div className="nx-home__stats">
              <Stat value={String(storage.pageCount)} label="pages" />
              <Stat value={String(graph.edges.length)} label="links" />
              <Stat value={String(storage.openTaskCount)} label="tasks open" />
              <Stat value={formatBytes(storage.dbSizeBytes)} label="on disk" />
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="nx-home__stat">
      <span className="nx-home__stat-value">{value}</span>
      <span className="nx-type-data">{label}</span>
    </div>
  )
}

// ------------------------------------------------------------------
// Day header and capture
// ------------------------------------------------------------------

function DayHeader() {
  // Recomputed per render rather than held in state: a date cached at mount
  // is wrong for anyone who leaves the app open overnight.
  const now = new Date()
  const { day, total } = dayOfYear(now)
  const quarter = Math.floor(now.getMonth() / 3) + 1

  return (
    <div className="nx-home__day">
      <div className="nx-home__day-name">
        {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>
      <div className="nx-type-data">
        week {isoWeek(now)} · Q{quarter} · {day} / {total}
      </div>
    </div>
  )
}

function CaptureBar({ onCapture, onCaptured, openPage }: {
  onCapture: (text: string, target: CaptureTarget) => Promise<Page>
  onCaptured: () => void
  openPage: (id: string) => void
}) {
  const [text, setText] = useState('')
  const [target, setTarget] = useState<CaptureTarget>('page')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const submit = async (andOpen: boolean) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const page = await onCapture(trimmed, target)
      // Cleared before navigating, so a capture-and-open does not leave the
      // text sitting in the box to be captured twice on the way back.
      setText('')
      onCaptured()
      if (andOpen) openPage(page.id)
      else toast.success(target === 'page' ? 'Captured as a new page' : "Added to today's entry")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // The box is meant to take one thought after another. It stopped doing that
  // because the input was disabled while a capture was in flight: the browser
  // blurs a disabled element, focusing one back does nothing, and re-enabling
  // it does not restore focus — so the next thing typed went to the document
  // body and vanished. The input stays enabled now (`submit` already ignores a
  // re-entrant call) and focus is restored after the render that clears `busy`,
  // not during it.
  const wasBusy = useRef(false)
  useEffect(() => {
    if (wasBusy.current && !busy) inputRef.current?.focus()
    wasBusy.current = busy
  }, [busy])

  return (
    <Panel className="nx-home__capture">
      <div className="nx-home__capture-row">
        <Icon shape="diamond" size={14} color="var(--nx-accent)" />
        <input
          ref={inputRef}
          className="nx-input nx-home__capture-input"
          placeholder="Capture a thought…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            void submit(e.shiftKey)
          }}
        />
        <Button onClick={() => void submit(false)} disabled={busy || !text.trim()}>
          Capture
        </Button>
      </div>
      <div className="nx-home__capture-row">
        <span className="nx-type-label">into</span>
        {CAPTURE_TARGETS.map((option) => (
          <Button
            key={option.value}
            variant={target === option.value ? 'selected' : 'ghost'}
            title={option.hint}
            onClick={() => setTarget(option.value)}
          >
            {option.label}
          </Button>
        ))}
        <span className="nx-type-data nx-home__capture-hint">⏎ capture · ⇧⏎ capture and open</span>
      </div>
    </Panel>
  )
}
