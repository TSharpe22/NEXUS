import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphData } from '@shared/types'
import { useAppStore } from '../store/app-store'
import './GraphView.css'

interface Props {
  graph: GraphData
  height?: number
}

interface Vec {
  x: number
  y: number
  vx: number
  vy: number
}

// Force constants. Tuned for a personal vault — tens to low hundreds of
// pages — not for a graph big enough to need Barnes-Hut.
const REPULSION = 5200
const SPRING = 0.006
const SPRING_LENGTH = 90
const CENTER_PULL = 0.012
const DAMPING = 0.86
const MAX_TICKS = 420
const MIN_ZOOM = 0.25
const MAX_ZOOM = 3
/** Auto-fit never magnifies past this, though manual zoom still reaches MAX_ZOOM. */
const FIT_MAX_ZOOM = 1.5

function nodeRadius(degree: number): number {
  // Sub-linear so a hub with 30 links doesn't dwarf everything else.
  return 5 + Math.min(7, Math.sqrt(degree) * 2.2)
}

/**
 * An interactive force-directed view of the whole link graph: drag the
 * background to pan, wheel to zoom, drag a node to reposition it, click to
 * open the page. The layout runs in the renderer over data fetched once —
 * there's no round trip per frame.
 *
 * The simulation is deliberately hand-rolled rather than pulling in d3-force:
 * it's ~40 lines of physics, and the app ships offline with no CDN.
 */
export function GraphView({ graph, height = 420 }: Props) {
  const openPage = useAppStore((s) => s.openPage)
  const activePageId = useAppStore((s) => s.activePageId)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const positions = useRef(new Map<string, Vec>())
  const ticks = useRef(0)
  const frame = useRef<number | null>(null)
  const dragged = useRef<string | null>(null)

  const [, forceRender] = useState(0)
  const [hovered, setHovered] = useState<string | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const [size, setSize] = useState({ width: 0, height })
  const panning = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  // Read inside the animation frame, where React state would be a stale closure.
  const sizeRef = useRef({ width: 0, height })
  // Once the view has been panned/zoomed/dragged by hand, auto-fit stops so it
  // doesn't yank the viewport back from under the user.
  const userMovedView = useRef(false)

  // The SVG fills its panel, whose width depends on the window — so the
  // centre point has to be measured rather than assumed.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect
      sizeRef.current = { width: w, height: h }
      setSize({ width: w, height: h })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { nodes, edges } = graph

  /** Adjacency, used to dim everything unrelated to the hovered node. */
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const node of nodes) map.set(node.id, new Set())
    for (const edge of edges) {
      map.get(edge.source)?.add(edge.target)
      map.get(edge.target)?.add(edge.source)
    }
    return map
  }, [nodes, edges])

  // Seed positions on a circle. New nodes get seeded without disturbing the
  // ones already settled, so adding a page doesn't reshuffle the whole layout.
  useEffect(() => {
    const map = positions.current
    const existing = new Set(map.keys())

    nodes.forEach((node, index) => {
      if (map.has(node.id)) return
      const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2
      const radius = 60 + (index % 5) * 24
      map.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0 })
    })

    for (const id of existing) {
      if (!nodes.some((n) => n.id === id)) map.delete(id)
    }

    ticks.current = 0
  }, [nodes])

  // Held in a ref so the simulation effect doesn't list it as a dependency —
  // that would tear down and restart the loop on every re-render. Assigned
  // below, once fitToView exists.
  const fitToViewRef = useRef<() => void>(() => {})

  // Simulation loop. Stops once it has settled so an idle graph costs nothing.
  useEffect(() => {
    const step = () => {
      const map = positions.current
      const list = nodes.map((n) => ({ id: n.id, p: map.get(n.id)! })).filter((n) => n.p)

      for (let i = 0; i < list.length; i++) {
        const a = list[i].p
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j].p
          let dx = a.x - b.x
          let dy = a.y - b.y
          let distSq = dx * dx + dy * dy
          if (distSq < 0.01) {
            // Perfectly coincident nodes produce no direction to separate
            // along — nudge them apart deterministically.
            dx = (i - j) * 0.1
            dy = 0.1
            distSq = dx * dx + dy * dy
          }
          const force = REPULSION / distSq
          const dist = Math.sqrt(distSq)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          a.vx += fx
          a.vy += fy
          b.vx -= fx
          b.vy -= fy
        }
      }

      for (const edge of edges) {
        const a = map.get(edge.source)
        const b = map.get(edge.target)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (dist - SPRING_LENGTH) * SPRING
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }

      for (const { id, p } of list) {
        if (id === dragged.current) {
          p.vx = 0
          p.vy = 0
          continue
        }
        p.vx = (p.vx - p.x * CENTER_PULL) * DAMPING
        p.vy = (p.vy - p.y * CENTER_PULL) * DAMPING
        p.x += p.vx
        p.y += p.vy
      }

      ticks.current += 1
      // Re-frame periodically rather than every frame: often enough to look
      // continuous, cheap enough not to matter.
      if (!userMovedView.current && ticks.current % 6 === 0) fitToViewRef.current()
      forceRender((n) => n + 1)

      if (ticks.current < MAX_TICKS || dragged.current) {
        frame.current = requestAnimationFrame(step)
      } else {
        frame.current = null
      }
    }

    frame.current = requestAnimationFrame(step)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [nodes, edges])

  /**
   * Frame the current layout in the panel. Called repeatedly while the
   * simulation settles, so the graph visibly grows to fill its box instead of
   * sitting as a cluster of dots in the middle of an empty panel — and so it's
   * already framed by the time anyone looks at it, rather than seven seconds
   * later when the simulation finally stops.
   */
  const fitToView = useCallback(() => {
    const list = [...positions.current.values()]
    const { width, height: h } = sizeRef.current
    if (list.length === 0 || width === 0) return

    const xs = list.map((p) => p.x)
    const ys = list.map((p) => p.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)

    // Padding leaves room for the labels, which hang below each dot.
    const pad = 64
    const spanX = Math.max(maxX - minX, 1)
    const spanY = Math.max(maxY - minY, 1)
    // Nodes and labels scale with the transform, so an unbounded fit turns a
    // two-node vault into two enormous dots with headline-sized captions.
    // Capped low enough to stay legible, high enough that a small graph still
    // fills its panel. Manual zoom goes all the way to MAX_ZOOM.
    const zoom = Math.min(
      FIT_MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min((width - pad * 2) / spanX, (h - pad * 2) / spanY))
    )

    setView({ x: -(minX + maxX) / 2, y: -(minY + maxY) / 2, zoom })
  }, [])

  fitToViewRef.current = fitToView

  // A fresh set of nodes re-enables auto-fit.
  useEffect(() => {
    userMovedView.current = false
  }, [nodes])

  /** Restart the simulation after an interaction that moved something. */
  const reheat = useCallback(() => {
    if (ticks.current >= MAX_TICKS) {
      ticks.current = MAX_TICKS - 90
      if (frame.current === null) frame.current = requestAnimationFrame(() => {})
    }
  }, [])

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      // Inverse of the render transform: translate to centre, scale, pan.
      return {
        x: (clientX - rect.left - rect.width / 2) / view.zoom - view.x,
        y: (clientY - rect.top - rect.height / 2) / view.zoom - view.y
      }
    },
    [view]
  )

  const onPointerDownNode = (e: React.PointerEvent, id: string) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    dragged.current = id
    userMovedView.current = true
    ticks.current = 0
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => forceRender((n) => n + 1))
    }
  }

  const onPointerMoveNode = (e: React.PointerEvent, id: string) => {
    if (dragged.current !== id) return
    const world = toWorld(e.clientX, e.clientY)
    const p = positions.current.get(id)
    if (!p) return
    p.x = world.x
    p.y = world.y
    p.vx = 0
    p.vy = 0
    forceRender((n) => n + 1)
  }

  const onPointerUpNode = (e: React.PointerEvent) => {
    if (!dragged.current) return
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    dragged.current = null
    reheat()
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    userMovedView.current = true
    setView((v) => ({
      ...v,
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
    }))
  }

  const onPointerDownBackground = (e: React.PointerEvent) => {
    userMovedView.current = true
    panning.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }

  const onPointerMoveBackground = (e: React.PointerEvent) => {
    const pan = panning.current
    if (!pan) return
    setView((v) => ({
      ...v,
      x: pan.ox + (e.clientX - pan.x) / v.zoom,
      y: pan.oy + (e.clientY - pan.y) / v.zoom
    }))
  }

  const onPointerUpBackground = (e: React.PointerEvent) => {
    panning.current = null
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
  }

  const resetView = () => {
    userMovedView.current = false
    fitToView()
  }

  if (nodes.length === 0) {
    return (
      <div className="nx-graph__empty nx-type-data" style={{ height }}>
        no pages yet
      </div>
    )
  }

  const highlighted = hovered ? neighbours.get(hovered) : null
  const isDimmed = (id: string) => !!hovered && id !== hovered && !highlighted?.has(id)

  return (
    <div className="nx-graph" style={{ height }}>
      <svg
        ref={svgRef}
        className="nx-graph__canvas"
        onWheel={onWheel}
        onPointerDown={onPointerDownBackground}
        onPointerMove={onPointerMoveBackground}
        onPointerUp={onPointerUpBackground}
        onPointerLeave={onPointerUpBackground}
      >
        {/* SVG transforms take no percentages, so the origin is centred from
            the measured size rather than with translate(50%, 50%). */}
        <g transform={`translate(${size.width / 2}, ${size.height / 2})`}>
          <g transform={`scale(${view.zoom}) translate(${view.x}, ${view.y})`}>
            {edges.map((edge, i) => {
              const a = positions.current.get(edge.source)
              const b = positions.current.get(edge.target)
              if (!a || !b) return null
              const dim = isDimmed(edge.source) && isDimmed(edge.target)
              const touchesHover =
                hovered && (edge.source === hovered || edge.target === hovered)
              return (
                <line
                  key={`${edge.source}-${edge.target}-${i}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={`nx-graph__edge ${dim ? 'nx-graph__edge--dim' : ''} ${
                    touchesHover ? 'nx-graph__edge--active' : ''
                  }`}
                />
              )
            })}

            {nodes.map((node) => {
              const p = positions.current.get(node.id)
              if (!p) return null
              const r = nodeRadius(node.degree)
              const active = node.id === activePageId
              return (
                <g
                  key={node.id}
                  className={`nx-graph__node ${isDimmed(node.id) ? 'nx-graph__node--dim' : ''} ${
                    active ? 'nx-graph__node--active' : ''
                  }`}
                  transform={`translate(${p.x}, ${p.y})`}
                  onPointerDown={(e) => onPointerDownNode(e, node.id)}
                  onPointerMove={(e) => onPointerMoveNode(e, node.id)}
                  onPointerUp={onPointerUpNode}
                  onPointerEnter={() => setHovered(node.id)}
                  onPointerLeave={() => setHovered(null)}
                  onClick={(e) => {
                    e.stopPropagation()
                    openPage(node.id)
                  }}
                >
                  <circle className="nx-graph__node-hit" r={r + 8} />
                  <circle className="nx-graph__node-dot" r={r} />
                  <text className="nx-graph__node-label" y={r + 13} textAnchor="middle">
                    {(node.title || 'Untitled').slice(0, 22)}
                  </text>
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      <div className="nx-graph__controls">
        <button onClick={() => setView((v) => ({ ...v, zoom: Math.min(MAX_ZOOM, v.zoom * 1.2) }))} title="Zoom in">
          +
        </button>
        <button onClick={() => setView((v) => ({ ...v, zoom: Math.max(MIN_ZOOM, v.zoom / 1.2) }))} title="Zoom out">
          −
        </button>
        <button onClick={resetView} title="Fit graph to view">
          fit
        </button>
      </div>

      <div className="nx-graph__legend nx-type-data">
        {nodes.length} pages · {edges.length} links · drag to pan · scroll to zoom
      </div>
    </div>
  )
}
