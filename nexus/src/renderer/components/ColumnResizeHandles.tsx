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

      // TEMP instrumentation — dump real layout measurements so we can see
      // where the stagger is coming from. Logs at most once per computeHandles
      // call (not per mousemove).
      // eslint-disable-next-line no-console
      console.log('[nx-col-layout]', {
        list: {
          rect: list.getBoundingClientRect(),
          computed: {
            display: getComputedStyle(list).display,
            alignItems: getComputedStyle(list).alignItems,
            padding: getComputedStyle(list).padding,
          },
        },
        cols: cols.map((col, i) => ({
          i,
          rect: col.getBoundingClientRect(),
          computed: {
            flex: getComputedStyle(col).flex,
            padding: getComputedStyle(col).padding,
            marginLeft: getComputedStyle(col).marginLeft,
            marginTop: getComputedStyle(col).marginTop,
          },
          firstChild: col.firstElementChild ? {
            tag: col.firstElementChild.tagName,
            className: col.firstElementChild.className,
            rect: col.firstElementChild.getBoundingClientRect(),
            marginLeft: getComputedStyle(col.firstElementChild).marginLeft,
            marginTop: getComputedStyle(col.firstElementChild).marginTop,
          } : null,
        })),
      })

      // BlockNote core CSS sets .bn-block-column-list{display:flex;flex-direction:row}
      // and writes flex-grow inline from the column's data-width prop. Don't
      // force any inline flex/display on the list — let BlockNote own layout.

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
  }, [editorContainerRef])

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

        // Live DOM update — set only flex-grow (BlockNote writes flex-grow
        // inline from data-width, so the shorthand `flex` was overriding
        // flex-basis/shrink and could confuse BlockNote's own reflow).
        handle.leftEl.style.flexGrow = `${newLeftGrow}`
        handle.rightEl.style.flexGrow = `${newRightGrow}`
      }

      const onUp = (me: MouseEvent) => {
        setDraggingKey(null)
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)

        const dx = me.clientX - startX
        const leftStartPx = totalWidth * (leftGrow / totalGrow)
        const newLeftPx = Math.max(80, Math.min(totalWidth - 80, leftStartPx + dx))

        // Store as a fractional ratio of totalGrow (keeps precision; the column
        // node renders `flex-grow: <width>` directly from this value).
        const newLeftRatio = (newLeftPx / totalWidth) * totalGrow
        const newRightRatio = totalGrow - newLeftRatio

        const leftId = getColumnId(handle.leftEl)
        const rightId = getColumnId(handle.rightEl)

        if (leftId && rightId) {
          try {
            // TEMP instrumentation — remove after column resize is verified.
            // eslint-disable-next-line no-console
            console.log('[nx-col] updateBlock', {
              leftId, rightId, newLeftRatio, newRightRatio,
              before: {
                left: (editor.getBlock(leftId) as { props?: Record<string, unknown> } | undefined)?.props,
                right: (editor.getBlock(rightId) as { props?: Record<string, unknown> } | undefined)?.props,
              },
            })
            editor.updateBlock(leftId, { type: 'column', props: { width: newLeftRatio } } as never)
            editor.updateBlock(rightId, { type: 'column', props: { width: newRightRatio } } as never)
            // eslint-disable-next-line no-console
            console.log('[nx-col] after', {
              left: (editor.getBlock(leftId) as { props?: Record<string, unknown> } | undefined)?.props,
              right: (editor.getBlock(rightId) as { props?: Record<string, unknown> } | undefined)?.props,
            })
          } catch (err) {
            // eslint-disable-next-line no-console
            console.log('[nx-col] updateBlock threw', err)
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
