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
/**
 * Above this many nodes, repulsion is computed against a spatial grid rather
 * than every other node. Below it the all-pairs loop is a few tens of
 * thousands of operations — cheaper than bucketing — and it is the exact
 * behaviour the force constants above were tuned against, so the graphs this
 * was built for are left running the code it was built with.
 */
const GRID_ABOVE = 260
/**
 * How far a node's repulsion reaches. Not an approximation so much as an
 * honest reading of the force: at this distance `REPULSION / distSq` is under
 * 0.05, two orders of magnitude below the centre pull, so the pairs the grid
 * skips were contributing nothing that survives a round of damping.
 */
const REPULSION_CUTOFF = 320
/**
 * Two nodes closer than this repel as if they were exactly this far apart.
 *
 * `REPULSION / distSq` has a singularity at zero: a pair that drifts together
 * gets an impulse of thousands, and with `DAMPING` at 0.86 a node carries a
 * kick roughly seven times as far as the kick itself before it stops. That is
 * how the layout used to sprawl to tens of thousands of pixels wide and pin
 * the auto-fit at minimum zoom. It went unnoticed because the simulation was
 * too slow to reach `MAX_TICKS` at those sizes — it was always measured
 * mid-expansion. Clamping the denominator caps the impulse without changing
 * anything at ordinary spacings.
 */
const MIN_SEPARATION_SQ = 12 * 12
/** Belt and braces on the same problem: no node crosses more than this a tick. */
const MAX_SPEED = 30
/**
 * Label every node up to this many; past it only the hubs get a standing
 * label, and everything else is named on hover. 1500 labels in a panel is not
 * a denser graph, it is an unreadable one.
 */
const LABEL_ALL_BELOW = 90
/** How many of the highest-degree nodes stay labelled in a large graph. */
const LABELLED_HUBS = 25
/**
 * Zoomed all the way out. Low enough that the auto-fit can actually frame a
 * few hundred nodes inside Home's short panel — at 0.25 the fit hit this floor
 * and gave up with the graph still overflowing, which reads as a bug rather
 * than as a limit.
 */
const MIN_ZOOM = 0.08
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
  /**
   * The rendered elements, by node id and by edge index.
   *
   * The simulation moves things every frame, and re-rendering through React to
   * say so meant reconciling two elements per node and one per edge, sixty
   * times a second: at 1500 pages that was 4500 elements a frame and the
   * reason Home ran at 15fps for the first several seconds of every visit. The
   * physics was never the expensive half. React still owns what exists here —
   * which nodes, which classes, which labels — and the loop only writes the
   * coordinates onto elements React already made.
   */
  const nodeEls = useRef(new Map<string, SVGGElement>())
  const edgeEls = useRef<(SVGLineElement | null)[]>([])
  const ticks = useRef(0)
  const frame = useRef<number | null>(null)
  const dragged = useRef<string | null>(null)

  const [, forceRender] = useState(0)
  const [hovered, setHovered] = useState<string | null>(null)
  /**
   * Pan and zoom, in a ref rather than in state, applied to the transform
   * group by hand.
   *
   * The auto-fit re-frames the graph ten times a second while it settles, and
   * as React state each of those was a full re-render of every node and edge —
   * which put back most of what painting positions imperatively had just
   * saved. Panning and zooming are the same shape of change: one attribute on
   * one element, and nothing above it needs to know.
   */
  const viewRef = useRef({ x: 0, y: 0, zoom: 1 })
  const zoomGroupRef = useRef<SVGGElement | null>(null)
  const [size, setSize] = useState({ width: 0, height })
  const panning = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  // Read inside the animation frame, where React state would be a stale closure.
  const sizeRef = useRef({ width: 0, height })
  // Once the view has been panned/zoomed/dragged by hand, auto-fit stops so it
  // doesn't yank the viewport back from under the user.
  const userMovedView = useRef(false)

  /** Move the viewport. Writes the transform straight onto the group. */
  const applyView = useCallback((next: { x: number; y: number; zoom: number }) => {
    viewRef.current = next
    zoomGroupRef.current?.setAttribute(
      'transform',
      `scale(${next.zoom}) translate(${next.x}, ${next.y})`
    )
  }, [])

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

  /**
   * Which nodes carry a standing label. Everything, until there are enough of
   * them that the labels stop being readable — past that the hubs keep theirs
   * (they are what you navigate by) and the rest are named on hover.
   */
  const labelled = useMemo(() => {
    if (nodes.length <= LABEL_ALL_BELOW) return null
    return new Set(
      [...nodes]
        .sort((a, b) => b.degree - a.degree)
        .slice(0, LABELLED_HUBS)
        .map((n) => n.id)
    )
  }, [nodes])

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
    // Draw now that there are positions to draw at. Effects run after the
    // first render, so on that render every node is skipped for having none —
    // and the simulation loop no longer re-renders on each tick to cover for
    // it, it paints the elements React made. Without this the panel stays
    // empty forever.
    forceRender((n) => n + 1)
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

      const repel = (i: number, j: number): void => {
        const a = list[i].p
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
        const force = REPULSION / Math.max(distSq, MIN_SEPARATION_SQ)
        const dist = Math.sqrt(distSq)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }

      if (list.length <= GRID_ABOVE) {
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) repel(i, j)
        }
      } else {
        // Every node against the 3×3 block of cells around it, rather than
        // against all of them. This is the whole difference between a graph
        // that settles and one that pins the main thread: at 1500 pages the
        // all-pairs loop is 1.1M pairs *per tick*, and Home — the screen the
        // app opens on — runs 420 of them.
        const buckets = new Map<string, number[]>()
        for (let i = 0; i < list.length; i++) {
          const p = list[i].p
          const key = `${Math.floor(p.x / REPULSION_CUTOFF)},${Math.floor(p.y / REPULSION_CUTOFF)}`
          const bucket = buckets.get(key)
          if (bucket) bucket.push(i)
          else buckets.set(key, [i])
        }

        for (let i = 0; i < list.length; i++) {
          const p = list[i].p
          const cx = Math.floor(p.x / REPULSION_CUTOFF)
          const cy = Math.floor(p.y / REPULSION_CUTOFF)
          for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              const bucket = buckets.get(`${cx + ox},${cy + oy}`)
              if (!bucket) continue
              // `j > i` only: each pair is handled once, by its lower index,
              // and `repel` already applies the force to both ends.
              for (const j of bucket) if (j > i) repel(i, j)
            }
          }
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
        const speed = Math.hypot(p.vx, p.vy)
        if (speed > MAX_SPEED) {
          p.vx = (p.vx / speed) * MAX_SPEED
          p.vy = (p.vy / speed) * MAX_SPEED
        }
        p.x += p.vx
        p.y += p.vy
      }

      ticks.current += 1
      // Re-frame periodically rather than every frame: often enough to look
      // continuous, cheap enough not to matter.
      if (!userMovedView.current && ticks.current % 6 === 0) fitToViewRef.current()
      paintRef.current()

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
   * Push the current positions onto the elements React has already rendered.
   *
   * Everything React decides — which nodes exist, what they are called, which
   * are dimmed — still goes through a render. This only moves them, which is
   * the part that happens every frame.
   */
  const paint = useCallback(() => {
    const map = positions.current
    for (const [id, el] of nodeEls.current) {
      const p = map.get(id)
      if (p) el.setAttribute('transform', `translate(${p.x}, ${p.y})`)
    }
    const list = edgesRef.current
    for (let i = 0; i < list.length; i++) {
      const el = edgeEls.current[i]
      if (!el) continue
      const a = map.get(list[i].source)
      const b = map.get(list[i].target)
      if (!a || !b) continue
      el.setAttribute('x1', String(a.x))
      el.setAttribute('y1', String(a.y))
      el.setAttribute('x2', String(b.x))
      el.setAttribute('y2', String(b.y))
    }
  }, [])

  // Both held in refs so the simulation effect doesn't restart on every render.
  const paintRef = useRef(paint)
  paintRef.current = paint
  const edgesRef = useRef(edges)
  edgesRef.current = edges

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

    // Padding leaves room for the labels, which hang below each dot —
    // proportional to the box, because a flat 64 was two thirds of the height
    // of Home's 210px panel and left the fit computing a zoom for a strip 82
    // pixels tall. The graph came out a small blob in the middle of an empty
    // panel, which is exactly what fitting is supposed to prevent.
    const pad = Math.max(8, Math.min(64, Math.min(width, h) * 0.1))
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

    applyView({ x: -(minX + maxX) / 2, y: -(minY + maxY) / 2, zoom })
  }, [applyView])

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
      const view = viewRef.current
      return {
        x: (clientX - rect.left - rect.width / 2) / view.zoom - view.x,
        y: (clientY - rect.top - rect.height / 2) / view.zoom - view.y
      }
    },
    []
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
    const v = viewRef.current
    applyView({
      ...v,
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
    })
  }

  const onPointerDownBackground = (e: React.PointerEvent) => {
    userMovedView.current = true
    panning.current = { x: e.clientX, y: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }

  const onPointerMoveBackground = (e: React.PointerEvent) => {
    const pan = panning.current
    if (!pan) return
    const v = viewRef.current
    applyView({
      ...v,
      x: pan.ox + (e.clientX - pan.x) / v.zoom,
      y: pan.oy + (e.clientY - pan.y) / v.zoom
    })
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
          <g
            ref={zoomGroupRef}
            transform={`scale(${viewRef.current.zoom}) translate(${viewRef.current.x}, ${viewRef.current.y})`}
          >
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
                  ref={(el) => {
                    edgeEls.current[i] = el
                  }}
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
                  ref={(el) => {
                    if (el) nodeEls.current.set(node.id, el)
                    else nodeEls.current.delete(node.id)
                  }}
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
                  {(labelled === null ||
                    labelled.has(node.id) ||
                    node.id === hovered ||
                    active) && (
                    <text className="nx-graph__node-label" y={r + 13} textAnchor="middle">
                      {(node.title || 'Untitled').slice(0, 22)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      <div className="nx-graph__controls">
        <button
          onClick={() => applyView({ ...viewRef.current, zoom: Math.min(MAX_ZOOM, viewRef.current.zoom * 1.2) })}
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => applyView({ ...viewRef.current, zoom: Math.max(MIN_ZOOM, viewRef.current.zoom / 1.2) })}
          title="Zoom out"
        >
          −
        </button>
        <button onClick={resetView} title="Fit graph to view">
          fit
        </button>
      </div>

      <div className="nx-graph__legend nx-type-data">
        {nodes.length} pages · {edges.length} links · drag to pan · scroll to zoom
        {labelled !== null && ' · hover to name a node'}
      </div>
    </div>
  )
}
