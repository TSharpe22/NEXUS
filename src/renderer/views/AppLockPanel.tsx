import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import type { AppLockStatus } from '@shared/types'
import { Panel } from '../design/Panel'
import { Button } from '../design/Button'
import { askNewPassword, askPassword, passwordDialog } from '../design/PasswordDialog'
import { lockApp } from '../AppLockGate'

/** What the idle menu offers, in seconds. 0 is never. */
const IDLE_CHOICES: { seconds: number; label: string }[] = [
  { seconds: 0, label: 'Never' },
  { seconds: 60, label: 'After 1 minute' },
  { seconds: 300, label: 'After 5 minutes' },
  { seconds: 600, label: 'After 10 minutes' },
  { seconds: 900, label: 'After 15 minutes' },
  { seconds: 1800, label: 'After 30 minutes' },
  { seconds: 3600, label: 'After 1 hour' }
]

/**
 * Settings → App lock.
 *
 * The copy says plainly what this is: a lock on the app. It is the one place a
 * person decides whether that is enough, so it is the one place that has to
 * be honest that the files underneath are not encrypted by it.
 */
export function AppLockPanel() {
  const [status, setStatus] = useState<AppLockStatus | null>(null)

  useEffect(() => {
    void window.api.appLock.status().then(setStatus)
    return window.api.appLock.onChanged(setStatus)
  }, [])

  if (!status) return null

  const idleChoices = IDLE_CHOICES.some((c) => c.seconds === status.idleSeconds)
    ? IDLE_CHOICES
    : [...IDLE_CHOICES, { seconds: status.idleSeconds, label: `After ${status.idleSeconds} seconds` }]

  const setPassword = () =>
    askNewPassword(
      'Set a password for Nexus',
      'Nexus will ask for it every time it opens, and after it locks. It keeps people out of the app, not out of the files on disk — see below.',
      async (password) => {
        setStatus(await window.api.appLock.setPassword(null, password))
        toast.success('Nexus now needs a password to open')
      }
    )

  const changePassword = () =>
    passwordDialog({
      title: 'Change the Nexus password',
      confirmLabel: 'Change password',
      fields: [
        { key: 'current', label: 'Current password' },
        { key: 'password', label: 'New password' },
        { key: 'confirm', label: 'Repeat it' }
      ],
      validate: (v) => {
        if (!v.current) return 'The current password is required.'
        if (!v.password) return 'A new password is required.'
        if (v.password !== v.confirm) return 'Those do not match.'
        return null
      },
      submit: async (v) => {
        setStatus(await window.api.appLock.setPassword(v.current, v.password))
        toast.success('Password changed')
      }
    })

  const removePassword = () =>
    askPassword(
      'Remove the Nexus password',
      'Nexus will open without asking, and stop locking when idle.',
      'Remove',
      async (password) => {
        setStatus(await window.api.appLock.removePassword(password))
        toast.success('Nexus no longer needs a password')
      },
      true
    )

  return (
    <Panel title="App lock">
      <div className="nx-settings__row">
        <div>
          <div className="nx-type-body">{status.enabled ? 'Nexus needs a password to open' : 'Nexus opens without a password'}</div>
          <div className="nx-type-data">
            A lock on the app, not on your files: nexus.db, attachments and the vault mirror stay
            readable to anything running as you. Use disk encryption for that. Pages you unlocked
            with their own passwords are shut again whenever the app locks.
          </div>
        </div>
        <div className="nx-settings__actions">
          {status.enabled ? (
            <>
              <Button variant="ghost" onClick={() => void changePassword()}>
                Change
              </Button>
              <Button variant="ghost" onClick={() => void removePassword()}>
                Remove
              </Button>
            </>
          ) : (
            <Button onClick={() => void setPassword()}>Set password</Button>
          )}
        </div>
      </div>

      {status.enabled && (
        <>
          <div className="nx-settings__row">
            <div>
              <div className="nx-type-body">Lock when idle</div>
              <div className="nx-type-data">
                Time with no typing, clicking or scrolling in Nexus. Anything unsaved is saved first.
              </div>
            </div>
            <select
              className="nx-input nx-settings__select"
              aria-label="Lock when idle"
              value={status.idleSeconds}
              onChange={(e) => void window.api.appLock.setIdleSeconds(Number(e.target.value)).then(setStatus)}
            >
              {idleChoices.map((c) => (
                <option key={c.seconds} value={c.seconds}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="nx-settings__row">
            <div>
              <div className="nx-type-body">Lock when the computer sleeps</div>
              <div className="nx-type-data">Also when the system screen lock comes on.</div>
            </div>
            <input
              type="checkbox"
              aria-label="Lock when the computer sleeps"
              checked={status.lockOnSleep}
              onChange={(e) => void window.api.appLock.setLockOnSleep(e.target.checked).then(setStatus)}
            />
          </div>
          <div className="nx-settings__row">
            <div>
              <div className="nx-type-body">Lock now</div>
              <div className="nx-type-data">Cmd/Ctrl + Shift + L, from anywhere in Nexus.</div>
            </div>
            <Button variant="ghost" onClick={() => void lockApp()}>
              Lock
            </Button>
          </div>
        </>
      )}
    </Panel>
  )
}
