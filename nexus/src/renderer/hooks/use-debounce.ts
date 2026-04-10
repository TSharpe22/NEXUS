import { useRef, useCallback, useEffect } from 'react'

export function useDebounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): { call: (...args: Parameters<T>) => void; flush: () => void; cancel: () => void } {
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

  const flush = useCallback(() => {
    if (timeoutRef.current && pendingArgs.current) {
      cancel()
      fnRef.current(...pendingArgs.current)
      pendingArgs.current = null
    }
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

  // Flush on unmount
  useEffect(() => {
    return () => {
      flush()
    }
  }, [flush])

  return { call, flush, cancel }
}
