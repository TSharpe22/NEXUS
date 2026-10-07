import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { CalendarFeedInfo } from '@shared/calendar'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import { confirmDialog } from '../design/Confirm'
import { relativeTime } from '../hooks/use-relative-time'

/**
 * Settings → Calendars.
 *
 * A calendar here is a link Nexus reads — Proton's "share with anyone" link,
 * or any ICS feed. The link is typed into a password field and never shown
 * again: whoever holds it can read the calendar, so after it is added this
 * panel only ever names the host it points at.
 */
export function CalendarPanel() {
  const [feeds, setFeeds] = useState<CalendarFeedInfo[]>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => setFeeds(await window.api.calendar.feeds()), [])

  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    if (!url.trim()) return
    setBusy(true)
    try {
      const feed = await window.api.calendar.addFeed(name, url)
      if (feed.error) toast.error(`Added, but it could not be read yet: ${feed.error}`)
      else toast.success(`${feed.name} added`)
      setName('')
      setUrl('')
      setAdding(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message.replace(/^\[[^\]]+\]\s*/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (feed: CalendarFeedInfo) => {
    const ok = await confirmDialog({
      title: `Remove ${feed.name}?`,
      message: 'Nexus stops reading it and forgets the link. The calendar itself is not touched.',
      confirmLabel: 'Remove',
      danger: true
    })
    if (!ok) return
    await window.api.calendar.removeFeed(feed.id)
    await load()
  }

  const refresh = async () => {
    setBusy(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const result = await window.api.calendar.events(today, today, true)
      if (result.errors.length) toast.error(result.errors.map((e) => `${e.feedName}: ${e.message}`).join('\n'))
      else toast.success('Calendars refreshed')
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="Calendars"
      actions={
        !adding && (
          <Button variant="ghost" onClick={() => setAdding(true)}>
            Add
          </Button>
        )
      }
    >
      {feeds.length === 0 && !adding && (
        <div className="nx-settings__row">
          <div className="nx-type-data">
            No calendars yet. Paste a calendar link — in Proton Calendar, the calendar&apos;s
            Share → &ldquo;Share with anyone&rdquo; link — and its events show on Home and in the
            Tracker. Read-only: Nexus never writes to it.
          </div>
        </div>
      )}

      {feeds.map((feed) => (
        <div className="nx-settings__row" key={feed.id}>
          <div>
            <div className="nx-type-body">{feed.name}</div>
            <div className="nx-type-data">
              {feed.host}
              {' · '}
              {feed.error ? (
                <span className="nx-settings__warn">{feed.error}</span>
              ) : feed.fetchedAt ? (
                `read ${relativeTime(feed.fetchedAt)}`
              ) : (
                'not read yet'
              )}
            </div>
          </div>
          <Button variant="ghost" onClick={() => void remove(feed)}>
            Remove
          </Button>
        </div>
      ))}

      {adding && (
        <div className="nx-settings__row nx-calendar-add">
          <input
            className="nx-input"
            placeholder="Name (e.g. Proton)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {/* A password field so the link is not on screen for anyone behind you. */}
          <input
            className="nx-input"
            type="password"
            autoComplete="off"
            placeholder="Calendar link (https://…)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add()
            }}
          />
          <Button onClick={() => void add()} disabled={busy || !url.trim()}>
            {busy ? 'Reading…' : 'Add'}
          </Button>
          <Button variant="ghost" onClick={() => setAdding(false)} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}

      {feeds.length > 0 && (
        <div className="nx-settings__row">
          <div className="nx-type-data">
            Read again every 10 minutes while Nexus is showing them. The link is kept in the
            vault (and so in its backups), never in the Markdown mirror.
          </div>
          <Button variant="ghost" onClick={() => void refresh()} disabled={busy}>
            Refresh now
          </Button>
        </div>
      )}
    </Panel>
  )
}
