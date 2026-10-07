import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { BriefingInfo, BriefingSyncStatus, ReminderInfo } from '@shared/types'
import { describeFireAt } from '@shared/reminder-time'
import { Button } from '../design/Button'
import type { WidgetProps } from './context'

/** How often the widget looks again: the briefing lands once a morning, a reminder any time. */
const POLL_MS = 5 * 60 * 1000

type Line = { kind: 'label'; label: string; rest: string } | { kind: 'bullet'; text: string } | { kind: 'text'; text: string }

/** The message body, read as the routine writes it: `**Section:**` labels and `- ` bullets. */
function readBody(body: string): Line[] {
  const lines: Line[] = []
  for (const raw of body.split('\n')) {
    const t = raw.trim()
    if (!t) continue
    const label = /^\*\*(.+?):?\*\*:?\s*(.*)$/.exec(t)
    if (label) {
      lines.push({ kind: 'label', label: label[1].replace(/:$/, ''), rest: label[2] })
      continue
    }
    const bullet = /^[-•]\s+(.*)$/.exec(t)
    lines.push(bullet ? { kind: 'bullet', text: bullet[1] } : { kind: 'text', text: t })
  }
  return lines
}

/** `**bold**` inside a line, as bold. Nothing else of Markdown is honoured. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        /^\*\*[^*]+\*\*$/.test(p) ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>
      )}
    </>
  )
}

/**
 * The morning briefing on Home, and the reminders still to come.
 *
 * The briefing is written by the Exec-Bot routine at 8:30 from the plans
 * Nexus sent the evening before; this only shows it. Reminders are listed so a
 * `!1600` line typed in a page visibly lands somewhere.
 */
export function BriefingWidget({ ctx }: WidgetProps) {
  const [briefing, setBriefing] = useState<BriefingInfo | null | undefined>(undefined)
  const [status, setStatus] = useState<BriefingSyncStatus | null>(null)
  const [pings, setPings] = useState<ReminderInfo[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [b, s, r] = await Promise.all([
        ctx.read.briefingToday(),
        ctx.read.briefingStatus(),
        ctx.read.remindersUpcoming()
      ])
      if (cancelled) return
      setBriefing(b)
      setStatus(s)
      setPings(r)
    }
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    const onChange = () => void load()
    window.addEventListener('nexus:reminders-changed', onChange)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('nexus:reminders-changed', onChange)
    }
  }, [ctx])

  if (briefing === undefined || !status) return null

  const openBriefingPage = async () => {
    try {
      await ctx.write.openBriefingPage()
    } catch (e) {
      toast.error(e instanceof Error ? e.message.replace(/^\[[^\]]+\]\s*/, '') : String(e))
    }
  }

  const addToEntry = async () => {
    setBusy(true)
    try {
      await ctx.write.addBriefingToEntry()
      toast.success("Linked from today's entry")
    } catch (e) {
      toast.error(e instanceof Error ? e.message.replace(/^\[[^\]]+\]\s*/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="nx-brief">
      {briefing ? (
        <>
          <div className="nx-brief__body">
            {readBody(briefing.body).map((line, i) =>
              line.kind === 'label' ? (
                <div key={i} className="nx-brief__section">
                  <span className="nx-brief__label nx-type-data">{line.label}</span>
                  {line.rest && (
                    <span className="nx-brief__rest">
                      <Inline text={line.rest} />
                    </span>
                  )}
                </div>
              ) : line.kind === 'bullet' ? (
                <div key={i} className="nx-brief__bullet">
                  <Inline text={line.text} />
                </div>
              ) : (
                <div key={i} className="nx-brief__text">
                  <Inline text={line.text} />
                </div>
              )
            )}
          </div>
          <div className="nx-brief__foot">
            <button className="nx-home__link nx-type-data" onClick={() => void openBriefingPage()}>
              open page
            </button>
            <button className="nx-home__link nx-type-data" disabled={busy} onClick={() => void addToEntry()}>
              link in today&apos;s entry
            </button>
          </div>
        </>
      ) : (
        <div className="nx-home__entry nx-home__entry--absent">
          <span className="nx-home__entry-absent-text">
            {status.enabled ? 'No briefing yet today' : 'Morning briefing is off'}
          </span>
          <span className="nx-type-data">
            {status.enabled
              ? 'It arrives after 8:30, written from the plans you jotted the evening before.'
              : 'Turn it on in Settings → Phone to have tomorrow’s plans turned into a briefing here and on the phone.'}
          </span>
          {!status.enabled && <Button onClick={ctx.openSettings}>Open Settings</Button>}
        </div>
      )}

      {pings.length > 0 && (
        <div className="nx-brief__pings">
          <div className="nx-type-label">Upcoming pings</div>
          {pings.slice(0, 6).map((p) => (
            <div
              key={p.id}
              className={`nx-brief__ping ${p.status === 'pending' ? 'nx-brief__ping--waiting' : ''} ${
                p.status === 'failed' ? 'nx-brief__ping--failed' : ''
              }`}
              title={
                p.status === 'pending'
                  ? 'Waiting: sent once the line stops changing, or once it is within 3 days'
                  : p.status === 'failed'
                    ? p.error ?? 'Could not be sent'
                    : 'Handed to ntfy; it will arrive on time'
              }
            >
              <span className="nx-brief__ping-time nx-type-data">{describeFireAt(new Date(p.fireAt))}</span>
              <span className="nx-brief__ping-text">{p.text}</span>
              {p.pageId && (
                <button className="nx-home__link nx-type-data" onClick={() => ctx.openPage(p.pageId!)}>
                  {p.pageTitle || 'page'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
