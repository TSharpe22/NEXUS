/**
 * How a document refers to an attachment.
 *
 * Split from `main/files.ts` — which owns the bytes on disk — for the same
 * reason the document walkers live in `shared/`: the main process serves these
 * URLs and rewrites them into Markdown, the renderer puts them into blocks,
 * and a second copy of this grammar in either is how the two drift.
 */

/**
 * The scheme attachments are served on.
 *
 * A scheme of its own rather than `file://`: the renderer is loaded from
 * `file://` in a packaged build but from `http://localhost` under
 * `electron-vite dev`, and an `img` pointing at `file://` is blocked from the
 * second. A custom scheme behaves the same in both, and — being served by a
 * handler rather than by the filesystem — it can refuse to serve anything
 * outside the store, which a `file://` URL sitting in a document cannot.
 */
export const ATTACHMENT_SCHEME = 'nexus-file'

/**
 * `nexus-file://vault/<name>`. The host is not decoration: the scheme is
 * registered as `standard`, and a standard scheme with an empty host
 * normalises unpredictably across the URL parsers this string passes through
 * (Chromium's, Node's, and whatever a Markdown reader uses). One fixed host
 * keeps the form stable.
 */
export const ATTACHMENT_URL_PREFIX = `${ATTACHMENT_SCHEME}://vault/`

/**
 * A stored name is a 64-character hex digest plus an optional short extension,
 * and nothing else.
 *
 * This is the first half of the traversal defence, and it is deliberately a
 * shape check rather than a path comparison: a document is user data that can
 * be edited outside the app — through the JSON import, or by hand — so the URL
 * in a block is untrusted input, and `../../../.ssh/id_rsa` must not be
 * expressible as a name at all. `attachmentPath` resolves and re-checks the
 * store root afterwards, because one guard for this is not enough.
 */
export const ATTACHMENT_NAME_RE = /^[0-9a-f]{64}(\.[a-z0-9]{1,12})?$/

export function attachmentUrl(name: string): string {
  return `${ATTACHMENT_URL_PREFIX}${name}`
}

/**
 * The stored name inside an attachment URL, or null for anything else.
 *
 * Null covers three different things on purpose — a URL on another scheme (an
 * ordinary web image whose address someone pasted), a malformed one, and a
 * name that fails the shape check. Every caller wants the same answer for all
 * three: this is not one of ours, leave it alone.
 */
export function attachmentName(url: unknown): string | null {
  if (typeof url !== 'string') return null
  if (!url.startsWith(ATTACHMENT_URL_PREFIX)) return null
  let name: string
  try {
    name = decodeURIComponent(url.slice(ATTACHMENT_URL_PREFIX.length)).trim()
  } catch {
    // A malformed percent-escape. Not one of ours.
    return null
  }
  return ATTACHMENT_NAME_RE.test(name) ? name : null
}
