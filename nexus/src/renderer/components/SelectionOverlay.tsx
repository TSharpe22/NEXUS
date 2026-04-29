import React, { useEffect, useState, useCallback } from 'react'
import { useEditorStore } from '../stores/editor-store'

interface OverlayRect {
  id: string
  top: number
  left: number
  width: number
  height: number
}

interface Props {
  editorContainerRef: React.RefObject<HTMLDivElement | null>
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Renders absolutely-positioned overlay rectangles over every currently
 * selected block. We use this instead of applying a class to the block
 * element directly because both React (BlockNote) and ProseMirror
 * aggressively rewrite className/DOM on re-render and strip any class
 * we add, leaving the highlight invisible.
 *
 * Same approach the lasso rect uses: query block rects via
 * getBoundingClientRect(), render sibling divs positioned in the editor
 * container's coordinate space. Zero interaction with BlockNote's DOM.
 */
export function SelectionOverlay({ editorContainerRef, scrollContainerRef }: Props) {
  const selectedBlockIds = useEditorStore((s) => s.selectedBlockIds)
  const [rects, setRects] = useState<OverlayRect[]>([])

  const compute = useCallback(() => {
    const container = editorContainerRef.current
    if (!container) {
      setRects([])
      return
    }
    if (selectedBlockIds.length === 0) {
      setRects([])
      return
    }

    const containerRect = container.getBoundingClientRect()
    const next: OverlayRect[] = []

    for (const id of selectedBlockIds) {
      const el = container.querySelector<HTMLElement>(
        `[data-node-type="blockContainer"][data-id="${CSS.escape(id)}"]`,
      )
      if (!el) continue

      // Skip headings — they are structural and shouldn't be highlighted.
      const isHeading = el.querySelector(
        ':scope > .bn-block-content[data-content-type="heading"]',
      )
      if (isHeading) continue

      const r = el.getBoundingClientRect()
      next.push({
        id,
        top: r.top - containerRect.top,
        left: r.left - containerRect.left,
        width: r.width,
        height: r.height,
      })
    }

    setRects(next)
  }, [editorContainerRef, selectedBlockIds])

  // Recompute whenever the selection changes or block DOM mutates.
  useEffect(() => {
    const container = editorContainerRef.current
    if (!container) return

    compute()
    const observer = new MutationObserver(() => requestAnimationFrame(compute))
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'data-id', 'class'],
    })
    return () => observer.disconnect()
  }, [editorContainerRef, compute])

  // Recompute on window resize and scroll container scroll.
  useEffect(() => {
    const onResize = () => requestAnimationFrame(compute)
    window.addEventListener('resize', onResize, { passive: true })
    const scroll = scrollContainerRef.current
    scroll?.addEventListener('scroll', onResize, { passive: true })
    return () => {
      window.removeEventListener('resize', onResize)
      scroll?.removeEventListener('scroll', onResize)
    }
  }, [compute, scrollContainerRef])

  if (rects.length === 0) return null

  return (
    <>
      {rects.map((r) => (
        <div
          key={r.id}
          className="nx-selection-overlay"
          style={{
            position: 'absolute',
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
            pointerEvents: 'none',
          }}
        />
      ))}
    </>
  )
}
