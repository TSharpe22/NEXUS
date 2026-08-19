import { useEffect, useRef, useState } from 'react'
import type { SearchResult } from '../../shared/types'

/**
 * Debounced full-text search against the main process.
 *
 * Results are sequence-guarded: a response arriving after the query has moved
 * on is discarded, so fast typing can never leave stale hits on screen.
 */
export function useSearch(query: string, limit = 200) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    const trimmed = query.trim()

    if (!trimmed) {
      seq.current++
      setResults([])
      setLoading(false)
      return
    }

    const mine = ++seq.current
    setLoading(true)

    const timer = setTimeout(async () => {
      try {
        const found = await window.api.search.pages(trimmed, limit)
        if (seq.current === mine) setResults(found)
      } catch {
        if (seq.current === mine) setResults([])
      } finally {
        if (seq.current === mine) setLoading(false)
      }
    }, 120)

    return () => clearTimeout(timer)
  }, [query, limit])

  return { results, loading }
}
