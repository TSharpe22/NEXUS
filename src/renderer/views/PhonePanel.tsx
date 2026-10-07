import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { BriefingSyncStatus, PhoneConfig } from '@shared/types'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import { relativeTime } from '../hooks/use-relative-time'

const clean = (e: unknown) => (e instanceof Error ? e.message.replace(/^\[[^\]]+\]\s*/, '') : String(e))

/**
 * Settings → Phone: where reminders go (an ntfy topic), and the Exec-Bot
 * hand-off that turns tomorrow's plans into a morning briefing.
 *
 * The topic is typed into a password field and never shown again: anyone who
 * has it can send notifications to the phone.
 */
export function PhonePanel() {
  const [phone, setPhone] = useState<PhoneConfig | null>(null)
  const [sync, setSync] = useState<BriefingSyncStatus | null>(null)
  const [topic, setTopic] = useState('')
  const [editingTopic, setEditingTopic] = useState(false)
  const [dir, setDir] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([window.api.phone.config(), window.api.briefing.status()])
    setPhone(p)
    setSync(s)
    setDir(s.dir ?? '')
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true)
    try {
      await fn()
      if (ok) toast.success(ok)
      await load()
    } catch (e) {
      toast.error(clean(e))
    } finally {
      setBusy(false)
    }
  }

  if (!phone || !sync) return null

  return (
    <Panel title="Phone">
      <div className="nx-settings__row">
        <div>
          <div className="nx-type-body">Notifications</div>
          <div className="nx-type-data">
            {phone.configured
              ? `Sending to a private ntfy topic on ${phone.server.replace(/^https?:\/\//, '')}.`
              : 'Install ntfy on the phone, subscribe to a topic only you know, and enter it here.'}
          </div>
        </div>
        <div className="nx-settings__actions">
          {phone.configured && !editingTopic && (
            <Button variant="ghost" disabled={busy} onClick={() => void run(() => window.api.phone.test(), 'Test sent')}>
              Send test
            </Button>
          )}
          {!editingTopic && (
            <Button variant="ghost" onClick={() => setEditingTopic(true)}>
              {phone.configured ? 'Change topic' : 'Set topic'}
            </Button>
          )}
        </div>
      </div>

      {editingTopic && (
        <div className="nx-settings__row nx-phone-edit">
          <input
            className="nx-input"
            type="password"
            autoComplete="off"
            placeholder="ntfy topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && topic.trim()) {
                void run(() => window.api.phone.setTopic(topic), 'Topic saved').then(() => {
                  setTopic('')
                  setEditingTopic(false)
                })
              }
            }}
          />
          <Button
            disabled={busy || !topic.trim()}
            onClick={() =>
              void run(() => window.api.phone.setTopic(topic), 'Topic saved').then(() => {
                setTopic('')
                setEditingTopic(false)
              })
            }
          >
            Save
          </Button>
          <Button variant="ghost" onClick={() => setEditingTopic(false)}>
            Cancel
          </Button>
        </div>
      )}

      <div className="nx-settings__row">
        <div className="nx-type-data">
          Reminders: the capture bar&apos;s <b>Remind</b> (&ldquo;1600 armored mma&rdquo;), or a line starting{' '}
          <code>!1600</code> in any page. A line is sent once it has stopped changing for a moment, and
          once sent it fires even if the line is deleted or the computer is off.
        </div>
      </div>

      <div className="nx-settings__row">
        <div>
          <div className="nx-type-body">Morning briefing</div>
          <div className="nx-type-data">
            {sync.enabled
              ? sync.error
                ? <span className="nx-settings__warn">{sync.error}</span>
                : `On. ${sync.lastPushAt ? `Plans for ${sync.lastSnapshotFor} sent ${relativeTime(sync.lastPushAt)}.` : 'Nothing sent yet.'}${
                    sync.lastPullAt ? ` Checked for a briefing ${relativeTime(sync.lastPullAt)}.` : ''
                  }`
              : 'Off. Sends tomorrow’s plans to the Exec-Bot repo, and shows the briefing it writes back on Home.'}
          </div>
        </div>
        <div className="nx-settings__actions">
          {sync.enabled && (
            <Button variant="ghost" disabled={busy} onClick={() => void run(() => window.api.briefing.syncNow(), 'Synced')}>
              Sync now
            </Button>
          )}
          <Button
            variant={sync.enabled ? 'ghost' : 'primary'}
            disabled={busy || (!sync.enabled && !sync.ready)}
            title={!sync.ready ? 'Set the folder of the Exec-Bot checkout first' : undefined}
            onClick={() => void run(() => window.api.briefing.setEnabled(!sync.enabled))}
          >
            {sync.enabled ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
      </div>

      <div className="nx-settings__row nx-phone-edit">
        <input
          className="nx-input"
          placeholder="Exec-Bot folder (a git checkout)"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
        />
        <Button
          variant="ghost"
          disabled={busy || dir === (sync.dir ?? '')}
          onClick={() => void run(() => window.api.briefing.setDir(dir || null), 'Folder saved')}
        >
          Save folder
        </Button>
        <span className={`nx-type-data ${sync.ready ? '' : 'nx-settings__warn'}`}>
          {sync.ready ? 'git checkout found' : 'not a git checkout'}
        </span>
      </div>
    </Panel>
  )
}
