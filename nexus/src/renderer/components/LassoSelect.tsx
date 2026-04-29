import React, { useCallback, useRef, useEffect, useState } from 'react'
import { useAppStore } from '../stores/app-store'

interface Props {
  // The scroll container — we listen for mousedown here via native listener
  // so we never block clicks on actual content.
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  editorContainerRef: React.RefObject<HTMLDivElement | null>
}

interface LassoRect {
  x: number
  y: number
  width: number
  height: number
}

export function LassoSelect({ scrollContainerRef, editorContainerRef }: Props) {
  const {
    selectedBlockIds,
    selectBlocks,
    deselectAllBlocks,
    setLassoActive,
  } = useAppStore()

  // Lasso rect lives locally — it updates every mouse frame and we don't
  // want to trigger re-renders in every Zustand subscriber while dragging.
  const [lassoRect, setLocalLassoRect] = useState<LassoRect | null>(null)

  const startPos = useRef<{ x: number; y: number } | null>(null)
  const blockRectsCache = useRef<Map<string, DOMRect>>(new Map())
  const editorBoundsRef = useRef<{ top: number; bottom: number; left: number; right: number } | null>(null)
  const rafRef = useRef<number>(0)
  const lastComputedRect = useRef<LassoRect | null>(null)
  // Track whether we've moved enough to actually be lassoing
  const isDragging = useRef(false)

  const cacheBlockRects = useCallback(() => {
    blockRectsCache.current.clear()
    if (!editorContainerRef.current) return
    // IMPORTANT: same selector as Editor.tsx's findBlock lookup. If these
    // diverge, the lasso produces IDs that Editor.tsx can't find, so the
    // selection class never lands and highlights stay invisible.
    const elements = editorContainerRef.current.querySelectorAll(
      '[data-node-type="blockContainer"][data-id]',
    )
    elements.forEach((el) => {
      // Headings are structural — do not make them lasso-selectable
      if (el.querySelector(':scope > .bn-block-content[data-content-type="heading"]')) return
      const id = el.getAttribute('data-id')
      if (id) blockRectsCache.current.set(id, el.getBoundingClientRect())
    })
    // Cache the editor's viewport bounds so we can clamp the visual overlay
    // (prevents the translucent rect from visually covering the page title).
    const bounds = editorContainerRef.current.getBoundingClientRect()
    editorBoundsRef.current = {
      top: bounds.top,
      bottom: bounds.bottom,
      left: bounds.left,
      right: bounds.right,
    }
  }, [editorContainerRef])

  const computeIntersections = useCallback(
    (rect: LassoRect) => {
      const lassoLeft = Math.min(rect.x, rect.x + rect.width)
      const lassoRight = Math.max(rect.x, rect.x + rect.width)
      const lassoTop = Math.min(rect.y, rect.y + rect.height)
      const lassoBottom = Math.max(rect.y, rect.y + rect.height)
      const ids: string[] = []
      for (const [id, blockRect] of blockRectsCache.current) {
        // A block is selected only when the lasso contains its vertical midpoint.
        // This prevents partial overlaps from grabbing adjacent blocks unintentionally.
        const blockCenterY = (blockRect.top + blockRect.bottom) / 2
        if (
          blockCenterY >= lassoTop &&
          blockCenterY <= lassoBottom &&
          blockRect.right > lassoLeft &&
          blockRect.left < lassoRight
        ) {
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

      // Allow lasso to start from anywhere EXCEPT inside live editable text
      // or interactive controls. This kills the "dead click" / sticky-keys
      // feel the previous strict guard caused.
      if (
        target.isContentEditable ||
        target.closest('[contenteditable="true"]') ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'BUTTON' ||
        target.tagName === 'A' ||
        target.tagName === 'SELECT' ||
        target.closest('[role="menu"]') ||
        target.closest('.nx-col-resize-handle') ||
        // BlockNote side menu — the six-dots drag handle and the "+" add
        // button. Without this guard the lasso swallows mousedown and the
        // user can't grab/drag a block to reorder it or insert via the
        // plus button.
        target.closest('.bn-side-menu') ||
        target.closest('[data-test-id="dragHandle"]') ||
        target.closest('[draggable="true"]')
      ) {
        return
      }

      // Good — remember start position and cache block positions.
      // Blur whatever currently has focus (typically the page-title
      // <textarea> if the user just edited it) and clear any existing
      // selection range so no native caret can survive into the drag.
      // Then preventDefault stops the browser from anchoring a fresh
      // text-range selection at the mousedown point.
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
      window.getSelection()?.removeAllRanges()
      e.preventDefault()
      startPos.current = { x: e.clientX, y: e.clientY }
      isDragging.current = false
      cacheBlockRects()
    }

    container.addEventListener('mousedown', onMouseDown)
    return () => container.removeEventListener('mousedown', onMouseDown)
  }, [scrollContainerRef, cacheBlockRects])

  // Once a start position is set, listen for drag movement at the document level.
  useEffect(() => {
    const DRAG_THRESHOLD = 4 // px — don't show lasso for tiny accidental movements
    const MIN_DELTA = 1 // px — skip redundant computation for sub-pixel moves

    const onMouseMove = (e: MouseEvent) => {
      if (!startPos.current) return

      const dx = e.clientX - startPos.current.x
      const dy = e.clientY - startPos.current.y

      if (!isDragging.current) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
        isDragging.current = true
        deselectAllBlocks()
        setLassoActive(true)
        // Block native text-range selection for the duration of the drag
        // and wipe any range that slipped through before preventDefault.
        document.body.classList.add('nx-lassoing')
        window.getSelection()?.removeAllRanges()
      }
      // Keep killing any new selection the browser tries to extend as the
      // cursor moves (belt-and-suspenders alongside body.nx-lassoing).
      if (isDragging.current) {
        e.preventDefault()
      }

      const rect: LassoRect = {
        x: startPos.current.x,
        y: startPos.current.y,
        width: dx,
        height: dy,
      }

      // Cheap short-circuit: skip RAF if the rect barely moved
      const prev = lastComputedRect.current
      if (
        prev &&
        Math.abs(prev.width - rect.width) < MIN_DELTA &&
        Math.abs(prev.height - rect.height) < MIN_DELTA
      ) {
        return
      }

      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        lastComputedRect.current = rect
        setLocalLassoRect(rect)
        computeIntersections(rect)
      })
    }

    const onMouseUp = () => {
      const wasDragging = isDragging.current
      startPos.current = null
      isDragging.current = false
      lastComputedRect.current = null
      setLassoActive(false)
      setLocalLassoRect(null)
      cancelAnimationFrame(rafRef.current)
      document.body.classList.remove('nx-lassoing')

      // After a drag on content-editable text, the browser fires a synthetic
      // `click` event. Editor.tsx has a document-level click handler that
      // calls deselectAllBlocks() when the click target is inside editable
      // content — which wipes the selection we just made. Swallow the
      // next click in the capture phase so it never reaches that handler.
      if (wasDragging) {
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation()
          ev.preventDefault()
          document.removeEventListener('click', swallow, true)
        }
        document.addEventListener('click', swallow, true)
        // Safety: if no synthetic click ever fires, clean up after a tick.
        setTimeout(() => document.removeEventListener('click', swallow, true), 50)
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      cancelAnimationFrame(rafRef.current)
      document.body.classList.remove('nx-lassoing')
    }
  }, [deselectAllBlocks, setLassoActive, computeIntersections])

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

  // Raw viewport rect
  const rawLeft = Math.min(lassoRect.x, lassoRect.x + lassoRect.width)
  const rawTop = Math.min(lassoRect.y, lassoRect.y + lassoRect.height)
  const rawRight = Math.max(lassoRect.x, lassoRect.x + lassoRect.width)
  const rawBottom = Math.max(lassoRect.y, lassoRect.y + lassoRect.height)

  // Clamp to editor bounds so the translucent rect can never visually
  // cover the page title / header area above the editor.
  const bounds = editorBoundsRef.current
  const left = bounds ? Math.max(rawLeft, bounds.left) : rawLeft
  const top = bounds ? Math.max(rawTop, bounds.top) : rawTop
  const right = bounds ? Math.min(rawRight, bounds.right) : rawRight
  const bottom = bounds ? Math.min(rawBottom, bounds.bottom) : rawBottom
  const width = Math.max(0, right - left)
  const height = Math.max(0, bottom - top)

  if (width === 0 || height === 0) return null

  return (
    <div
      className="nx-lasso-rect"
      style={{
        position: 'fixed',
        left,
        top,
        width,
        height,
        pointerEvents: 'none',
        zIndex: 9998,
      }}
    />
  )
}
