/**
 * Writes that exist only in the renderer, and how to get them onto disk before
 * the window goes away.
 *
 * Every debounced save — the editor's body and title, a property being typed —
 * lives here between the keystroke and the round trip. The main process holds
 * the window open and asks for a flush on its way out (`lifecycle
 * .onFlushRequest`), so anything registered here is what stands between the
 * last thing typed and losing it.
 *
 * A plain module-level set rather than context or the store: the flush has to
 * work from outside React, at a point where re-rendering is not going to
 * happen, and there is exactly one of these per window.
 */

type PendingWrite = () => void | Promise<unknown>

const pending = new Set<PendingWrite>()

/** Register a flusher for as long as the caller is mounted. Returns cleanup. */
export function registerPendingWrite(write: PendingWrite): () => void {
  pending.add(write)
  return () => {
    pending.delete(write)
  }
}

/**
 * Run every registered flusher and wait for all of them.
 *
 * `allSettled`, not `all`: one save failing must not stop the others from
 * being attempted — losing one page's edit is bad, losing the rest of them
 * because of it is worse.
 */
export async function flushPendingWrites(): Promise<void> {
  await Promise.allSettled(Array.from(pending, (write) => write()))
}
