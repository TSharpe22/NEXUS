// Renderer-side registry of pending-write flushers. Editor.tsx registers a
// flush callback on mount; lifecycle hooks (page switch, app quit) call
// flushAllPending() to drain debounced writes synchronously before
// navigation/exit.

type Flusher = () => void | Promise<void>

const flushers = new Set<Flusher>()

export function registerFlusher(fn: Flusher): () => void {
  flushers.add(fn)
  return () => flushers.delete(fn)
}

export async function flushAllPending(): Promise<void> {
  const all = Array.from(flushers)
  await Promise.allSettled(all.map((fn) => Promise.resolve().then(fn)))
}
