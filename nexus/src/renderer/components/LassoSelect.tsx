import React, { useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '../stores/app-store'

interface Props {
  // The scroll container — we listen for mousedown here via native listener
  // so we never block clicks on actual content.
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  editorContainerRef: React.RefObject<HTMLDivElement | null>
}

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
}

export function LassoSelect({ scrollContainerRef, editorContainerRef }: Props) {
  const {
    selectedBlockIds,
    isLassoActive,
    lassoRect,
    selectBlocks,
    deselectAllBlocks,
    setLassoActive,
    setLassoRect,
  } = useAppStore()

  const startPos = useRef<{ x: number; y: number } | null>(null)
  const blockRectsCache = useRef<Map<string, DOMRect>>(new Map())
  const rafRef = useRef<number>(0)
  // Track whether we've moved enough to actually be lassoing
  const isDragging = useRef(false)

  const cacheBlockRects = useCallback(() => {
    blockRectsCache.current.clear()
    if (!editorContainerRef.current) return
    const elements = editorContainerRef.current.querySelectorAll('[data-node-type="blockContainer"]')
    elements.forEach((el) => {
      const id = el.getAttribute('data-id')
      if (id) blockRectsCache.current.set(id, el.getBoundingClientRect())
    })
  }, [editorContainerRef])

  const computeIntersections = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      const lassoLeft = Math.min(rect.x, rect.x + rect.width)
      const lassoRight = Math.max(rect.x, rect.x + rect.width)
      const lassoTop = Math.min(rect.y, rect.y + rect.height)
      const lassoBottom = Math.max(rect.y, rect.y + rect.height)
      const lassoBounds = { left: lassoLeft, top: lassoTop, right: lassoRight, bottom: lassoBottom }
      const ids: string[] = []
      for (const [id, blockRect] of blockRectsCache.current) {
        if (rectsIntersect(lassoBounds, { left: blockRect.left, top: blockRect.top, right: blockRect.right, bottom: blockRect.bottom })) {
          ids.push(id)
        }
      }
      selectBlocks(ids)
    },
    [selectBlocks],
  )

  // Native mousedown on scroll container — does NOT call preventDefault so
  // normal clicks on blocks, buttons, inputs are completely unaffected.
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return

      const target = e.target as HTMLElement

      // Only start lasso from truly empty space — not from inside any block.
      // Allowing lasso starts inside blocks causes the entire vertical swath of
      // blocks to be selected (all blocks span full width, so any downward drag
      // intersects them all). Restricting to empty space makes selection intentional:
      // the user drags from the padding below blocks upward to sweep across them.
      if (target.closest('[data-node-type="blockContainer"]')) return

      // Also guard interactive / editable elements in the container padding area.
      if (
        target.isContentEditable ||
        target.closest('[contenteditable]') ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'BUTTON' ||
        target.tagName === 'A' ||
        target.tagName === 'SELECT' ||
        target.closest('[role="menu"]')
      ) {
        return
      }

      // Good — remember start position and cache block positions.
      // We do NOT preventDefault here so existing click behavior is preserved.
      startPos.current = { x: e.clientX, y: e.clientY }
      isDragging.current = false
      cacheBlockRects()
    }

    container.addEventListener('mousedown', onMouseDown)
    return () => container.removeEventListener('mousedown', onMouseDown)
  }, [scrollContainerRef, cacheBlockRects])

  // Once a start position is set, listen for drag movement at the document level.
  useEffect(() => {
    const DRAG_THRESHOLD = 5 // px — don't show lasso for tiny accidental movements

    const onMouseMove = (e: MouseEvent) => {
      if (!startPos.current) return

      const dx = e.clientX - startPos.current.x
      const dy = e.clientY - startPos.current.y

      if (!isDragging.current) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
        isDragging.current = true
        deselectAllBlocks()
        setLassoActive(true)
      }

      const rect = { x: startPos.current.x, y: startPos.current.y, width: dx, height: dy }
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        setLassoRect(rect)
        computeIntersections(rect)
      })
    }

    const onMouseUp = () => {
      startPos.current = null
      isDragging.current = false
      setLassoActive(false)
      setLassoRect(null)
      cancelAnimationFrame(rafRef.current)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      cancelAnimationFrame(rafRef.current)
    }
  }, [deselectAllBlocks, setLassoActive, setLassoRect, computeIntersections])

  // Escape to deselect
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedBlockIds.length > 0) deselectAllBlocks()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedBlockIds, deselectAllBlocks])

  // Lasso rect overlay only — no invisible capture div
  if (!lassoRect) return null

  return (
    <div
      className="nx-lasso-rect"
      style={{
        position: 'fixed',
        left: Math.min(lassoRect.x, lassoRect.x + lassoRect.width),
        top: Math.min(lassoRect.y, lassoRect.y + lassoRect.height),
        width: Math.abs(lassoRect.width),
        height: Math.abs(lassoRect.height),
        pointerEvents: 'none',
        zIndex: 9998,
      }}
    />
  )
}
