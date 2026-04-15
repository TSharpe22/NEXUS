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

/**
 * Find a stable data-id for a column element. BlockNote 0.24's
 * @blocknote/xl-multi-column may place data-id on the column element itself,
 * on a direct .bn-block child, or on a deeper descendant. Try each in order.
 */
function getColumnId(col: HTMLElement): string {
  return (
    col.getAttribute('data-id') ||
    col.querySelector(':scope > .bn-block[data-id]')?.getAttribute('data-id') ||
    col.querySelector('[data-id]')?.getAttribute('data-id') ||
    ''
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

    // Real BlockNote DOM: .bn-block-column-list[data-node-type="columnList"]
    // contains .bn-block-column[data-node-type="column"] siblings. Query both
    // class- and attribute-based selectors so we tolerate minor DOM shape
    // changes between BlockNote versions.
    const lists = container.querySelectorAll<HTMLElement>(
      '.bn-block-column-list, [data-node-type="columnList"]',
    )
    lists.forEach((list) => {
      const cols = Array.from(
        list.querySelectorAll<HTMLElement>(
          ':scope > .bn-block-column, :scope > [data-node-type="column"]',
        ),
      )
      if (cols.length < 2) return

      // Force flex inline — CSS :has() can be unreliable inside Electron's
      // Chromium and BlockNote's own CSS may load after first paint.
      // getBoundingClientRect() below forces a reflow so positions reflect
      // the layout we just applied.
      list.style.display = 'flex'
      list.style.flexDirection = 'row'
      list.style.alignItems = 'flex-start'
      list.style.gap = '0'

      for (const col of cols) {
        // Only initialise flex-grow if not already set by a drag interaction
        if (!col.style.flex) {
          let storedWidth: number | undefined
          const colId = getColumnId(col)
          if (colId) {
            try {
              const block = editor.getBlock(colId) as { props?: { width?: unknown } } | undefined
              const w = block?.props?.width
              if (typeof w === 'number' && w > 0) storedWidth = w
            } catch { /* ignore */ }
          }
          col.style.flex = `${storedWidth ?? 1} 1 0`
        }
        if (!col.style.minWidth) col.style.minWidth = '80px'
        if (!col.style.minHeight) col.style.minHeight = '2em'
      }

      for (let i = 0; i < cols.length - 1; i++) {
        const leftEl = cols[i]
        const rightEl = cols[i + 1]

        const leftId = getColumnId(leftEl)
        const rightId = getColumnId(rightEl)
        if (!leftId || !rightId) continue

        const leftRect = leftEl.getBoundingClientRect()
        const rightRect = rightEl.getBoundingClientRect()

        // Midpoint between the left column's right edge and the right
        // column's left edge, expressed in coordinates relative to the
        // editor container. Rounded to integer pixels so the CSS-centered
        // 2px line renders crisply instead of on a sub-pixel boundary.
        const midX = (leftRect.right + rightRect.left) / 2
        const x = Math.round(midX - containerRect.left)
        const top = Math.round(Math.min(leftRect.top, rightRect.top) - containerRect.top)
        const bottom = Math.round(Math.max(leftRect.bottom, rightRect.bottom) - containerRect.top)

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

        const leftId = getColumnId(handle.leftEl)
        const rightId = getColumnId(handle.rightEl)

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
