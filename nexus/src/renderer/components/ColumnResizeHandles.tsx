import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { NexusEditor } from '../blocks/schema'

interface HandleInfo {
  key: string
  /** Left offset relative to editorContainerRef */
  x: number
  /** Top offset relative to editorContainerRef */
  top: number
  height: number
  leftEl: HTMLElement
  rightEl: HTMLElement
}

interface Props {
  editor: NexusEditor
  editorContainerRef: React.RefObject<HTMLDivElement | null>
}

/** Returns true if the element is a blockContainer whose direct content is a column block. */
function isColumnContainer(el: Element): el is HTMLElement {
  if (el.getAttribute('data-node-type') !== 'blockContainer') return false
  return !!(
    el.querySelector(':scope > .bn-block > .bn-block-content[data-content-type="column"]') ||
    el.querySelector(':scope > .bn-block-content[data-content-type="column"]')
  )
}

/**
 * Renders draggable resize handles between adjacent columns inside any
 * columnList block. Handles are absolutely positioned relative to the
 * editorContainerRef so they scroll with the content naturally.
 */
export function ColumnResizeHandles({ editor, editorContainerRef }: Props) {
  const [handles, setHandles] = useState<HandleInfo[]>([])
  const [draggingKey, setDraggingKey] = useState<string | null>(null)

  const computeHandles = useCallback(() => {
    const container = editorContainerRef.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    const newHandles: HandleInfo[] = []

    // Walk every .bn-block-group; find those whose direct children are column blocks
    container.querySelectorAll('.bn-block-group').forEach((group) => {
      const columnChildren = Array.from(group.children).filter(isColumnContainer)
      if (columnChildren.length < 2) return

      // Apply flex layout directly via JS — CSS :has() can be unreliable inside
      // Electron's Chromium. getBoundingClientRect() below forces a reflow, so
      // the layout will be correct even on the very first call.
      const groupEl = group as HTMLElement
      if (groupEl.style.display !== 'flex') {
        groupEl.style.display = 'flex'
        groupEl.style.flexDirection = 'row'
        groupEl.style.alignItems = 'flex-start'
        groupEl.style.gap = '0'
      }

      for (const col of columnChildren) {
        const colEl = col as HTMLElement
        // Only initialise flex-grow if not already set by a drag interaction
        if (!colEl.style.flex) {
          let storedWidth: number | undefined
          const colId = colEl.getAttribute('data-id')
          if (colId) {
            try {
              const block = editor.getBlock(colId) as { props?: { width?: unknown } } | undefined
              const w = block?.props?.width
              if (typeof w === 'number' && w > 0) storedWidth = w
            } catch { /* ignore */ }
          }
          colEl.style.flex = `${storedWidth ?? 1} 1 0`
        }
        if (!colEl.style.minWidth) colEl.style.minWidth = '80px'
        if (!colEl.style.minHeight) colEl.style.minHeight = '2em'
      }

      for (let i = 0; i < columnChildren.length - 1; i++) {
        const leftEl = columnChildren[i]
        const rightEl = columnChildren[i + 1]
        // getBoundingClientRect() forces a reflow so positions reflect the flex
        // layout we just applied above.
        const leftRect = leftEl.getBoundingClientRect()
        const rightRect = rightEl.getBoundingClientRect()

        const leftId = leftEl.getAttribute('data-id') || ''
        const rightId = rightEl.getAttribute('data-id') || ''
        if (!leftId || !rightId) continue

        const x = (leftRect.right + rightRect.left) / 2 - containerRect.left
        const top = Math.min(leftRect.top, rightRect.top) - containerRect.top
        const bottom = Math.max(leftRect.bottom, rightRect.bottom) - containerRect.top

        newHandles.push({
          key: `${leftId}|${rightId}`,
          x,
          top,
          height: bottom - top,
          leftEl,
          rightEl,
        })
      }
    })

    setHandles(newHandles)
  }, [editorContainerRef, editor])

  // Recompute on DOM mutations (block add/remove/resize)
  useEffect(() => {
    const container = editorContainerRef.current
    if (!container) return

    computeHandles()
    const observer = new MutationObserver(() => requestAnimationFrame(computeHandles))
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'data-id'] })
    return () => observer.disconnect()
  }, [editorContainerRef, computeHandles])

  // Recompute on window resize
  useEffect(() => {
    window.addEventListener('resize', computeHandles, { passive: true })
    return () => window.removeEventListener('resize', computeHandles)
  }, [computeHandles])

  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, handle: HandleInfo) => {
      e.preventDefault()
      setDraggingKey(handle.key)

      const startX = e.clientX
      const leftRect = handle.leftEl.getBoundingClientRect()
      const rightRect = handle.rightEl.getBoundingClientRect()
      const totalWidth = leftRect.width + rightRect.width

      // Read current flex-grow values (BlockNote may have set them via inline style)
      const leftGrow = parseFloat(getComputedStyle(handle.leftEl).flexGrow) || 1
      const rightGrow = parseFloat(getComputedStyle(handle.rightEl).flexGrow) || 1
      const totalGrow = leftGrow + rightGrow

      const onMove = (me: MouseEvent) => {
        const dx = me.clientX - startX
        const leftStartPx = totalWidth * (leftGrow / totalGrow)
        const newLeftPx = Math.max(80, Math.min(totalWidth - 80, leftStartPx + dx))
        const newRightPx = totalWidth - newLeftPx

        const newLeftGrow = (newLeftPx / totalWidth) * totalGrow
        const newRightGrow = (newRightPx / totalWidth) * totalGrow

        // Live DOM update — BlockNote re-render will overwrite these on mouseup
        handle.leftEl.style.flex = `${newLeftGrow} 1 0`
        handle.rightEl.style.flex = `${newRightGrow} 1 0`
      }

      const onUp = (me: MouseEvent) => {
        setDraggingKey(null)
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)

        const dx = me.clientX - startX
        const leftStartPx = totalWidth * (leftGrow / totalGrow)
        const newLeftPx = Math.max(80, Math.min(totalWidth - 80, leftStartPx + dx))

        // Normalize to a 0–20 integer ratio for storage (gives ~5% precision)
        const leftRatio = Math.round((newLeftPx / totalWidth) * 20)
        const rightRatio = 20 - leftRatio

        const leftId = handle.leftEl.getAttribute('data-id')
        const rightId = handle.rightEl.getAttribute('data-id')

        if (leftId && rightId) {
          try {
            editor.updateBlock(leftId, { type: 'column', props: { width: leftRatio } } as never)
            editor.updateBlock(rightId, { type: 'column', props: { width: rightRatio } } as never)
          } catch {
            // column block may not have a width prop in this version — ignore
          }
        }

        // Recompute after BlockNote re-renders with new props
        setTimeout(computeHandles, 100)
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [editor, computeHandles],
  )

  if (handles.length === 0) return null

  return (
    <>
      {handles.map((handle) => (
        <div
          key={handle.key}
          className={`nx-col-resize-handle${draggingKey === handle.key ? ' is-dragging' : ''}`}
          style={{
            top: handle.top,
            left: handle.x - 4,
            height: handle.height,
          }}
          onMouseDown={(e) => onHandleMouseDown(e, handle)}
        />
      ))}
    </>
  )
}
