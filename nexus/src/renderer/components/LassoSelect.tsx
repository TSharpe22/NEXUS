import React, { useCallback, useRef, useEffect } from 'react'
import { useAppStore } from '../stores/app-store'

interface Props {
  editorContainerRef: React.RefObject<HTMLDivElement | null>
}

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
}

export function LassoSelect({ editorContainerRef }: Props) {
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

  const getBlockElements = useCallback((): HTMLElement[] => {
    if (!editorContainerRef.current) return []
    return Array.from(
      editorContainerRef.current.querySelectorAll('[data-node-type="blockContainer"]'),
    ) as HTMLElement[]
  }, [editorContainerRef])

  const cacheBlockRects = useCallback(() => {
    blockRectsCache.current.clear()
    const elements = getBlockElements()
    for (const el of elements) {
      const id = el.getAttribute('data-id')
      if (id) {
        blockRectsCache.current.set(id, el.getBoundingClientRect())
      }
    }
  }, [getBlockElements])

  const computeIntersections = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      const lassoLeft = Math.min(rect.x, rect.x + rect.width)
      const lassoRight = Math.max(rect.x, rect.x + rect.width)
      const lassoTop = Math.min(rect.y, rect.y + rect.height)
      const lassoBottom = Math.max(rect.y, rect.y + rect.height)

      const lassoBounds = { left: lassoLeft, top: lassoTop, right: lassoRight, bottom: lassoBottom }
      const ids: string[] = []

      for (const [id, blockRect] of blockRectsCache.current) {
        const blockBounds = {
          left: blockRect.left,
          top: blockRect.top,
          right: blockRect.right,
          bottom: blockRect.bottom,
        }
        if (rectsIntersect(lassoBounds, blockBounds)) {
          ids.push(id)
        }
      }

      selectBlocks(ids)
    },
    [selectBlocks],
  )

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only start lasso on left-click in empty editor space
      if (e.button !== 0) return

      const target = e.target as HTMLElement
      // Don't lasso if clicking inside editable content
      if (
        target.isContentEditable ||
        target.closest('[contenteditable]') ||
        target.closest('.bn-inline-content') ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'BUTTON' ||
        target.tagName === 'A'
      ) {
        return
      }

      // Also skip if inside a block's main content area (but not the margin/wrapper)
      const blockContainer = target.closest('[data-node-type="blockContainer"]')
      if (blockContainer) {
        const blockContent = blockContainer.querySelector('.bn-block-content')
        if (blockContent && blockContent.contains(target)) {
          return
        }
      }

      e.preventDefault()
      deselectAllBlocks()
      startPos.current = { x: e.clientX, y: e.clientY }
      setLassoActive(true)
      cacheBlockRects()
    },
    [deselectAllBlocks, setLassoActive, cacheBlockRects],
  )

  useEffect(() => {
    if (!isLassoActive) return

    const onMouseMove = (e: MouseEvent) => {
      if (!startPos.current) return

      const rect = {
        x: startPos.current.x,
        y: startPos.current.y,
        width: e.clientX - startPos.current.x,
        height: e.clientY - startPos.current.y,
      }

      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        setLassoRect(rect)
        computeIntersections(rect)
      })
    }

    const onMouseUp = () => {
      startPos.current = null
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
  }, [isLassoActive, setLassoActive, setLassoRect, computeIntersections])

  // Escape to deselect
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedBlockIds.length > 0) {
        deselectAllBlocks()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedBlockIds, deselectAllBlocks])

  return (
    <>
      {/* Lasso rectangle overlay */}
      {lassoRect && (
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
      )}

      {/* Invisible mousedown capture layer */}
      <div
        className="absolute inset-0 z-0"
        onMouseDown={onMouseDown}
        style={{ pointerEvents: isLassoActive ? 'none' : undefined }}
      />
    </>
  )
}
