/**
 * What an IPC failure should say to a person.
 *
 * A rejected `ipcRenderer.invoke` arrives wrapped twice by the time it reaches
 * a catch block here — Electron prefixes the method it was invoking, and
 * `ipc.ts`'s `rethrow` prefixes the channel — so the message a user would have
 * seen for a mistyped password was:
 *
 *   Error invoking remote method 'lock:remove': Error: [lock:remove] Wrong password
 *
 * Both prefixes are useful in a log and useless in a dialog. This strips them,
 * and special-cases the one failure that is not an error at all but an answer:
 * a wrong password is the expected outcome of typing a password, and it should
 * read like a reply rather than like something broke.
 */
const REMOTE_PREFIX = /^Error invoking remote method '[^']*':\s*/
const ERROR_PREFIX = /^Error:\s*/
const CHANNEL_PREFIX = /^\[[^\]]+\]\s*/

export function ipcMessage(error: unknown, fallback = 'That did not work.'): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/wrong password/i.test(raw)) return 'Wrong password.'

  let message = raw.replace(REMOTE_PREFIX, '').replace(ERROR_PREFIX, '')
  // Applied after the two above, because the channel prefix sits inside them.
  message = message.replace(CHANNEL_PREFIX, '').trim()
  return message || fallback
}
