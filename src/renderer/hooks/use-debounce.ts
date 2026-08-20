import { useRef, useCallback, useEffect } from 'react'

export function useDebounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): {
  call: (...args: Parameters<T>) => void
  /**
   * Run a pending call now, and hand back whatever it returns — which for an
   * async save is the promise the caller has to wait on. Shutdown flushes the
   * editor and then waits for this; a `void` return would have made that wait
   * a no-op and put the edit right back in the race it was rescued from.
   * Undefined when there was nothing pending.
   */
  flush: () => ReturnType<T> | undefined
  cancel: () => void
} {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fnRef = useRef(fn)
  const pendingArgs = useRef<Parameters<T> | null>(null)

  fnRef.current = fn

  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const flush = useCallback((): ReturnType<T> | undefined => {
    if (!timeoutRef.current || !pendingArgs.current) return undefined
    const args = pendingArgs.current
    cancel()
    pendingArgs.current = null
    return fnRef.current(...args)
  }, [cancel])

  const call = useCallback(
    (...args: Parameters<T>) => {
      pendingArgs.current = args
      cancel()
      timeoutRef.current = setTimeout(() => {
        fnRef.current(...args)
        pendingArgs.current = null
        timeoutRef.current = null
      }, delay)
    },
    [delay, cancel]
  )

  useEffect(() => {
    return () => {
      flush()
    }
  }, [flush])

  return { call, flush, cancel }
}
