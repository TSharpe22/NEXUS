import { getSetting, setSetting } from './repo'

/**
 * Sending to the phone, through ntfy.
 *
 * The topic is the only credential ntfy has (anyone who knows it can post to
 * it), so like a calendar link it stays in the main process and the
 * `settings` table; the renderer is told whether one is set and the server it
 * points at, never the topic itself.
 */

const TOPIC_KEY = 'ntfy.topic'
const SERVER_KEY = 'ntfy.server'
const DEFAULT_SERVER = 'https://ntfy.sh'
const TIMEOUT_MS = 15_000

/**
 * How far ahead ntfy.sh will hold a scheduled message. Its documented limit is
 * three days; a reminder further out waits in Nexus and is handed over once it
 * is inside this window.
 */
export const MAX_DELAY_MS = 3 * 24 * 60 * 60 * 1000 - 10 * 60 * 1000

export interface NtfyConfig {
  configured: boolean
  server: string
}

/** The server: a setting, or for the checks a local stand-in named in the environment. */
function server(): string {
  return (process.env.NEXUS_NTFY_SERVER || getSetting(SERVER_KEY) || DEFAULT_SERVER).replace(/\/+$/, '')
}

export function getConfig(): NtfyConfig {
  return { configured: !!getSetting(TOPIC_KEY), server: server() }
}

export function setTopic(topic: string | null): NtfyConfig {
  const clean = topic?.trim() ?? ''
  if (clean && !/^[A-Za-z0-9_-]{1,64}$/.test(clean)) {
    throw new Error('A topic is letters, digits, - and _ only.')
  }
  setSetting(TOPIC_KEY, clean || null)
  return getConfig()
}

export interface NtfyMessage {
  title?: string
  message: string
  tags?: string[]
  /** Deliver at this instant rather than now. */
  at?: Date
  markdown?: boolean
}

/** Post one message. Returns ntfy's message id. Throws with a readable reason. */
export async function send(msg: NtfyMessage): Promise<string> {
  const topic = getSetting(TOPIC_KEY)
  if (!topic) throw new Error('No ntfy topic set. Add one in Settings → Phone.')

  const headers: Record<string, string> = {}
  // Header values must be Latin-1; ntfy reads RFC 2047 encoded words, which is
  // how a title with "·" or an accent gets through intact.
  const encode = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v).toString('base64')}?=`)
  if (msg.title) headers['Title'] = encode(msg.title)
  if (msg.tags?.length) headers['Tags'] = msg.tags.join(',')
  if (msg.markdown) headers['Markdown'] = 'yes'
  // A Unix timestamp, never words: ntfy reads "4pm" in the server's zone.
  if (msg.at && msg.at.getTime() > Date.now() + 30_000) {
    headers['At'] = String(Math.floor(msg.at.getTime() / 1000))
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${server()}/${topic}`, {
      method: 'POST',
      headers,
      body: msg.message,
      signal: controller.signal
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`ntfy said ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`)
    }
    const body = (await response.json().catch(() => ({}))) as { id?: string }
    return body.id ?? ''
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('ntfy did not answer in time.')
    throw e
  } finally {
    clearTimeout(timer)
  }
}
