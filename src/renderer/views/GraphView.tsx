import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { GraphData } from '@shared/types'
import { useAppStore } from '../store/app-store'
import './GraphView.css'

/** How a node is coloured. `recency` fades from accent to dim as a page goes quiet. */
export type GraphColour = 'recency' | 'type' | 'none'

/** Pinned node positions, in world coordinates, by node id. */
export type GraphPins = Record<string, [number, number]>

interface Props {
  graph: GraphData
  /** A pixel height, or `'fill'` to take the height of the containing box. */
  height?: number | 'fill'
  /**
   * Positions under this key outlive the component. Home's panel and the full
   * view share one, so expanding the graph shows the layout you were looking
   * at rather than a fresh one, and coming back to Home does not re-settle it.
   */
  layoutKey?: string
  /** Draw each tag as a hub every page carrying it is tied to. */
  showTags?: boolean
  /** Draw each folder as a hub its pages, and its child folders, are tied to. */
  showFolders?: boolean
  /** Draw each canvas as a hub tied to the pages it shows or links to. */
  showCanvases?: boolean
  colour?: GraphColour
  pins?: GraphPins
  onPinsChange?: (next: GraphPins) => void
  onOpenTag?: (tagId: string) => void
  /** Rendered over the top-left corner. */
  toolbar?: ReactNode
  /** Appended to the zoom controls in the top-right corner. */
  controls?: ReactNode
}

const ZERO_DRIFT = { dx: 0, dy: 0 }
const EMPTY_PINS: GraphPins = {}

interface Vec {
  x: number
  y: number
  vx: number
  vy: number
  /** Held where the user put it: forces still act on its neighbours, never on it. */
  fixed?: boolean
}

type NodeKind = 'page' | 'tag' | 'folder' | 'canvas'

interface SimNode {
  id: string
  kind: NodeKind
  title: string
  degree: number
  type_id?: string
  updated_at?: string
  /** The tag or folder id behind a hub. */
  refId?: string
  /** A tag's semantic colour name. */
  tone?: string
}

interface SimEdge {
  source: string
  target: string
  hub: boolean
}

// Force constants. Tuned for a personal vault — tens to low hundreds of
// pages — not for a graph big enough to need Barnes-Hut.
const REPULSION = 5200
const SPRING = 0.006
const SPRING_LENGTH = 90
/**
 * A page is tied to its tag or folder by a longer, weaker spring than to a
 * page it links to. Membership should gather pages into a loose cluster around
 * the hub, not pile every one of them onto it — at link strength five pages in
 * one folder became five overlapping labels.
 */
const HUB_SPRING = 0.003
const HUB_SPRING_LENGTH = 120
const CENTER_PULL = 0.012
const DAMPING = 0.86
const MAX_TICKS = 420
/**
 * The last this-many ticks scale motion down to nothing, so a settling graph
 * eases to a stop. Before this the loop simply stopped at `MAX_TICKS`, and a
 * graph still moving at that tick froze mid-step.
 */
const COOL_TICKS = 90
/** Below this top speed, after a minimum run, the layout counts as settled. */
const REST_SPEED = 0.02
const MIN_TICKS = 60
/** How many ticks a grab or a release is given to play out. */
const REHEAT_TICKS = 160
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
 * the auto-fit at minimum zoom. Clamping the denominator caps the impulse
 * without changing anything at ordinary spacings.
 */
const MIN_SEPARATION_SQ = 12 * 12
/** Belt and braces on the same problem: no node crosses more than this a tick. */
const MAX_SPEED = 30
/**
 * How far the pointer may travel between press and release and still count as
 * a click.
 *
 * A node carries both drag handlers and a click that opens its page, and a
 * drag ends in a native click — so nudging a node and letting go navigated
 * away from the graph you were arranging. Anything past this is a drag, and
 * the click that follows it is swallowed.
 */
const CLICK_SLOP_PX = 4
/**
 * Idle drift: how far a settled node wanders, and how long one cycle takes.
 *
 * Purely for the look of the thing — a graph frozen mid-air reads as a
 * screenshot. The amplitude is deliberately under half a node radius, so it
 * never suggests the layout is still deciding, and it moves nothing that
 * matters: positions are untouched, the offset is applied at paint time only,
 * so hit-testing, dragging and the fit all still see a stationary graph.
 */
const DRIFT_PX = 2.2
const DRIFT_PERIOD_MS = 7000
/** Idle frames are painted at about this rate, not at 60fps. It is a breath. */
const DRIFT_FRAME_MS = 45
/**
 * Label every node up to this many; past it only the hubs get a standing
 * label, and everything else is named on hover. 1500 labels in a panel is not
 * a denser graph, it is an unreadable one.
 */
const LABEL_ALL_BELOW = 90
/** How many of the highest-degree nodes stay labelled in a large graph. */
const LABELLED_HUBS = 25
/**
 * Below this zoom, page labels are hidden until hovered. Labels scale with
 * the transform, and at a third of their size they are a grey smear between
 * the dots rather than names. Tag and folder hubs keep theirs: there are few
 * of them and they are what a zoomed-out graph is navigated by.
 */
const LABEL_MIN_ZOOM = 0.5
/**
 * Zoomed all the way out. Low enough that the auto-fit can actually frame a
 * few hundred nodes inside Home's panel.
 */
const MIN_ZOOM = 0.08
const MAX_ZOOM = 3
/** Auto-fit never magnifies past this, though manual zoom still reaches MAX_ZOOM. */
const FIT_MAX_ZOOM = 1.5
const WHEEL_STEP = 1.12

/** Recency buckets, in days since the last edit. */
const FRESH_DAYS = 1
const RECENT_DAYS = 7
const AGING_DAYS = 30

/**
 * Type colours, in the order types are listed. The semantic tokens rather
 * than a palette of their own, and `critical` left out: a type drawn in the
 * error colour reads as a type that is broken.
 */
const TYPE_TONES = ['accent', 'info', 'warning', 'success']

/**
 * Where layouts live between mounts. Keyed by `layoutKey`; one entry per
 * graph the app draws, so this never grows past a handful of maps.
 */
const layouts = new Map<string, Map<string, Vec>>()

/**
 * How much larger labels are drawn than their nominal size, in world units.
 *
 * Labels live inside the zoom transform, so a Home panel fitted at 0.6 drew
 * 10px names at 6px — technically there, practically unreadable. Growing them
 * by the inverse of the zoom holds them near their real size on screen, up to
 * `LABEL_MAX_SCALE`; past that they shrink with everything else, until
 * `LABEL_MIN_ZOOM` hides them. Zooming in leaves them alone, so they still get
 * bigger when you look closer.
 */
const LABEL_MAX_SCALE = 1.8
function labelScale(zoom: number): number {
  return Math.min(LABEL_MAX_SCALE, Math.max(1, 1 / zoom))
}

function nodeRadius(node: SimNode): number {
  if (node.kind !== 'page') return 6 + Math.min(6, Math.sqrt(node.degree) * 1.6)
  // Sub-linear so a hub with 30 links doesn't dwarf everything else.
  return 5 + Math.min(7, Math.sqrt(node.degree) * 2.2)
}

/** Stored timestamps are UTC `YYYY-MM-DD HH:MM:SS`. */
function daysSince(timestamp: string | undefined, nowMs: number): number {
  if (!timestamp) return Infinity
  const ms = Date.parse(timestamp.replace(' ', 'T') + (timestamp.includes('Z') ? '' : 'Z'))
  return Number.isNaN(ms) ? Infinity : (nowMs - ms) / 86_400_000
}

function recencyClass(days: number): string {
  if (days < FRESH_DAYS) return 'nx-graph__node--fresh'
  if (days < RECENT_DAYS) return 'nx-graph__node--recent'
  if (days < AGING_DAYS) return 'nx-graph__node--aging'
  return 'nx-graph__node--old'
}

/** A cheap stable hash of an id: scatters phases and seeds, nothing more. */
function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return h
}

/**
 * An interactive force-directed view of the vault: drag the background to pan,
 * wheel to zoom at the pointer, drag a node and the rest follow, right-click a
 * node to pin it where it is, click to open the page.
 *
 * The simulation is deliberately hand-rolled rather than pulling in d3-force:
 * it's ~60 lines of physics, and the app ships offline with no CDN.
 */
export function GraphView({
  graph,
  height = 420,
  layoutKey,
  showTags = false,
  showFolders = false,
  showCanvases = false,
  colour = 'none',
  pins = EMPTY_PINS,
  onPinsChange,
  onOpenTag,
  toolbar,
  controls
}: Props) {
  const openPage = useAppStore((s) => s.openPage)
  const openCanvas = useAppStore((s) => s.openCanvas)
  const activePageId = useAppStore((s) => s.activePageId)
  const types = useAppStore((s) => s.types)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [positionsMap] = useState(() => {
    if (!layoutKey) return new Map<string, Vec>()
    let map = layouts.get(layoutKey)
    if (!map) layouts.set(layoutKey, (map = new Map()))
    return map
  })
  const positions = useRef(positionsMap)
  /**
   * The rendered elements, by node id and by edge index.
   *
   * The simulation moves things every frame, and re-rendering through React to
   * say so meant reconciling two elements per node and one per edge, sixty
   * times a second. React still owns what exists here — which nodes, which
   * classes, which labels — and the loop only writes the coordinates onto
   * elements React already made.
   */
  const nodeEls = useRef(new Map<string, SVGGElement>())
  const edgeEls = useRef<(SVGLineElement | null)[]>([])
  const ticks = useRef(0)
  /** The pending animation frame of the simulation, or null when it is at rest. */
  const frame = useRef<number | null>(null)
  const dragged = useRef<string | null>(null)
  /** Where a node press started, and whether it has travelled far enough to be a drag. */
  const pressOrigin = useRef<{ x: number; y: number } | null>(null)
  const draggedFar = useRef(false)

  const [, forceRender] = useState(0)
  const [hovered, setHovered] = useState<string | null>(null)
  /**
   * Pan and zoom, in a ref rather than in state, applied to the transform
   * group by hand. The auto-fit re-frames the graph ten times a second while it
   * settles, and as React state each of those was a full re-render of every
   * node and edge.
   */
  const viewRef = useRef({ x: 0, y: 0, zoom: 1 })
  const zoomGroupRef = useRef<SVGGElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const panning = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  // Read inside the animation frame, where React state would be a stale closure.
  const sizeRef = useRef({ width: 0, height: 0 })
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
    const root = rootRef.current
    if (root) {
      root.classList.toggle('nx-graph--far', next.zoom < LABEL_MIN_ZOOM)
      root.style.setProperty('--nx-graph-label-scale', String(labelScale(next.zoom)))
    }
  }, [])

  // ----------------------------------------------------------------
  // What is drawn
  // ----------------------------------------------------------------

  const { nodes, edges, pageCount, linkCount } = useMemo(() => {
    const nodes: SimNode[] = graph.nodes.map((n) => ({
      id: n.id,
      kind: 'page',
      title: n.title || 'Untitled',
      degree: n.degree,
      type_id: n.type_id,
      updated_at: n.updated_at
    }))
    const edges: SimEdge[] = graph.edges.map((e) => ({ ...e, hub: false }))

    if (showTags) {
      const counts = new Map<string, number>()
      for (const page of graph.nodes) {
        for (const tagId of page.tag_ids) {
          counts.set(tagId, (counts.get(tagId) ?? 0) + 1)
          edges.push({ source: page.id, target: `tag:${tagId}`, hub: true })
        }
      }
      for (const tag of graph.tags) {
        const count = counts.get(tag.id)
        // A tag nothing carries is not part of the shape of the vault.
        if (!count) continue
        nodes.push({ id: `tag:${tag.id}`, kind: 'tag', title: `#${tag.name}`, degree: count, refId: tag.id, tone: tag.color })
      }
    }

    if (showFolders) {
      const counts = new Map<string, number>()
      for (const page of graph.nodes) {
        if (!page.folder_id) continue
        counts.set(page.folder_id, (counts.get(page.folder_id) ?? 0) + 1)
        edges.push({ source: page.id, target: `folder:${page.folder_id}`, hub: true })
      }
      const known = new Set(graph.folders.map((f) => f.id))
      for (const folder of graph.folders) {
        if (folder.parent_folder_id && known.has(folder.parent_folder_id)) {
          edges.push({ source: `folder:${folder.id}`, target: `folder:${folder.parent_folder_id}`, hub: true })
          counts.set(folder.parent_folder_id, (counts.get(folder.parent_folder_id) ?? 0) + 1)
        }
      }
      for (const folder of graph.folders) {
        nodes.push({
          id: `folder:${folder.id}`,
          kind: 'folder',
          title: `/${folder.name}`,
          degree: counts.get(folder.id) ?? 0,
          refId: folder.id
        })
      }
    }

    if (showCanvases) {
      const live = new Set(graph.nodes.map((n) => n.id))
      for (const canvas of graph.canvases ?? []) {
        const pageIds = canvas.page_ids.filter((id) => live.has(id))
        nodes.push({
          id: `canvas:${canvas.id}`,
          kind: 'canvas',
          title: canvas.title || 'Untitled canvas',
          degree: pageIds.length,
          refId: canvas.id
        })
        for (const pageId of pageIds) edges.push({ source: pageId, target: `canvas:${canvas.id}`, hub: true })
      }
    }

    const present = new Set(nodes.map((n) => n.id))
    return {
      nodes,
      edges: edges.filter((e) => present.has(e.source) && present.has(e.target)),
      pageCount: graph.nodes.length,
      linkCount: graph.edges.length
    }
  }, [graph, showTags, showFolders, showCanvases])

  /**
   * Which page nodes carry a standing label. Everything, until there are
   * enough of them that the labels stop being readable — past that the
   * best-connected keep theirs and the rest are named on hover.
   */
  const labelled = useMemo(() => {
    if (pageCount <= LABEL_ALL_BELOW) return null
    return new Set(
      nodes
        .filter((n) => n.kind === 'page')
        .sort((a, b) => b.degree - a.degree)
        .slice(0, LABELLED_HUBS)
        .map((n) => n.id)
    )
  }, [nodes, pageCount])

  /** Adjacency, used to light up everything related to the hovered node. */
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const node of nodes) map.set(node.id, new Set())
    for (const edge of edges) {
      map.get(edge.source)?.add(edge.target)
      map.get(edge.target)?.add(edge.source)
    }
    return map
  }, [nodes, edges])

  const typeTone = useMemo(() => {
    const map = new Map<string, string>()
    // The seeded Note type means "no type", so it keeps the default grey.
    types
      .filter((t) => t.name !== 'Note')
      .forEach((t, i) => map.set(t.id, TYPE_TONES[i % TYPE_TONES.length]))
    return map
  }, [types])

  // ----------------------------------------------------------------
  // Measuring
  // ----------------------------------------------------------------

  const hasNodes = nodes.length > 0

  /**
   * The SVG fills its panel, whose size depends on the window — so the centre
   * point is measured rather than assumed.
   *
   * Keyed on whether there is an SVG at all. Home mounts this before the graph
   * has been fetched, when it renders the empty state and `svgRef` is null; an
   * observer attached once on mount never saw the SVG that replaced it. The
   * graph then drew itself centred on x = 0 while pointer maths used the real
   * width, which put a grabbed node half a panel away from the cursor and made
   * the fit a no-op.
   */
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const measure = (width: number, h: number) => {
      sizeRef.current = { width, height: h }
      setSize((prev) => (prev.width === width && prev.height === h ? prev : { width, height: h }))
    }
    const rect = el.getBoundingClientRect()
    measure(rect.width, rect.height)
    const observer = new ResizeObserver(([entry]) => {
      measure(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNodes])

  // ----------------------------------------------------------------
  // Positions
  // ----------------------------------------------------------------

  // Seed positions for nodes that have none, and apply pins. Settled nodes are
  // left where they are, so a new page or a toggled hub doesn't reshuffle the
  // layout: a new node starts beside something it is tied to.
  useEffect(() => {
    const map = positions.current
    const existing = new Set(map.keys())

    const missing = nodes.filter((n) => !map.has(n.id))
    // Hubs are placed after pages, at the centre of the pages they gather.
    missing.sort((a, b) => Number(a.kind !== 'page') - Number(b.kind !== 'page'))
    missing.forEach((node, index) => {
      const h = hashId(node.id)
      const jitterX = ((h % 97) / 97 - 0.5) * 30
      const jitterY = (((h >> 8) % 89) / 89 - 0.5) * 30
      const placed = [...(neighbours.get(node.id) ?? [])]
        .map((id) => map.get(id))
        .filter((p): p is Vec => !!p)
      if (placed.length > 0) {
        const cx = placed.reduce((s, p) => s + p.x, 0) / placed.length
        const cy = placed.reduce((s, p) => s + p.y, 0) / placed.length
        map.set(node.id, { x: cx + jitterX, y: cy + jitterY, vx: 0, vy: 0 })
        return
      }
      const angle = (index / Math.max(missing.length, 1)) * Math.PI * 2
      const radius = 60 + (index % 5) * 24
      map.set(node.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0 })
    })

    const ids = new Set(nodes.map((n) => n.id))
    for (const id of existing) if (!ids.has(id)) map.delete(id)

    for (const [id, p] of map) {
      const pin = pins[id]
      if (pin) {
        p.x = pin[0]
        p.y = pin[1]
        p.vx = 0
        p.vy = 0
        p.fixed = true
      } else {
        p.fixed = false
      }
    }

    // A node set that was already laid out only needs a short settle; a fresh
    // one needs the full run.
    ticks.current = missing.length === 0 ? MAX_TICKS - REHEAT_TICKS : missing.length === nodes.length ? 0 : MAX_TICKS - 240
    kickRef.current()
    // Draw now that there are positions to draw at: effects run after the
    // render that skipped every node for having none.
    forceRender((n) => n + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, pins])

  // ----------------------------------------------------------------
  // Simulation
  // ----------------------------------------------------------------

  // Held in refs so effects don't list them as dependencies — that would tear
  // down and restart the loop on every re-render.
  const fitToViewRef = useRef<() => void>(() => {})
  const paintRef = useRef<(t?: number) => void>(() => {})
  /** Start the loop if it is at rest. Safe to call at any time. */
  const kickRef = useRef<() => void>(() => {})
  const edgesRef = useRef(edges)
  edgesRef.current = edges
  edgeEls.current.length = edges.length

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
        // against all of them: at 1500 pages the all-pairs loop is 1.1M pairs
        // per tick, and Home — the screen the app opens on — runs hundreds.
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

      for (const edge of edgesRef.current) {
        const a = map.get(edge.source)
        const b = map.get(edge.target)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = edge.hub
          ? (dist - HUB_SPRING_LENGTH) * HUB_SPRING
          : (dist - SPRING_LENGTH) * SPRING
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }

      // Held for as long as a node is: a long grab should not run the clock
      // out and leave the rest of the graph frozen around it.
      if (dragged.current) ticks.current = Math.min(ticks.current, MAX_TICKS - REHEAT_TICKS)
      const cool = Math.min(1, Math.max(0, (MAX_TICKS - ticks.current) / COOL_TICKS))

      let top = 0
      for (const { id, p } of list) {
        if (id === dragged.current || p.fixed) {
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
        p.x += p.vx * cool
        p.y += p.vy * cool
        top = Math.max(top, speed * cool)
      }

      ticks.current += 1
      // Re-frame periodically rather than every frame: often enough to look
      // continuous, cheap enough not to matter.
      if (!userMovedView.current && ticks.current % 6 === 0) fitToViewRef.current()
      paintRef.current()

      const atRest = ticks.current >= MAX_TICKS || (ticks.current > MIN_TICKS && top < REST_SPEED)
      if (dragged.current || !atRest) {
        frame.current = requestAnimationFrame(step)
      } else {
        frame.current = null
        if (!userMovedView.current) fitToViewRef.current()
      }
    }

    kickRef.current = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(step)
    }
    // Always a fresh loop over this node set, never whatever is pending. React
    // runs every effect's cleanup before any effect's body, so the seeding
    // effect above kicks the *previous* `step` in the gap — and a kick that
    // found that frame pending and left it alone kept simulating the old node
    // list. On Home the old list is the empty one rendered before the graph is
    // fetched: the real layout never ran, and sat at its seed positions until
    // something was dragged.
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(step)

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [nodes])

  /** Give the simulation some more ticks to play out, and make sure it runs. */
  const reheat = useCallback((by = REHEAT_TICKS) => {
    ticks.current = Math.min(ticks.current, MAX_TICKS - by)
    kickRef.current()
  }, [])

  /**
   * Idle drift — the graph breathing once it has settled.
   *
   * A separate loop from the simulation, and a much lazier one: no physics, no
   * React, just the paint that is already there being handed a phase. It backs
   * off entirely while the simulation is running (that is already motion) and
   * while the window is hidden.
   */
  useEffect(() => {
    if (!hasNodes) return
    let raf: number | null = null
    let last = 0

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (frame.current !== null || document.hidden) return
      if (now - last < DRIFT_FRAME_MS) return
      last = now
      paintRef.current((now / DRIFT_PERIOD_MS) * Math.PI * 2)
    }

    raf = requestAnimationFrame(tick)
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [hasNodes])

  // ----------------------------------------------------------------
  // Painting
  // ----------------------------------------------------------------

  /**
   * A node's idle offset — a slow ellipse, its phase fixed by the node's own id
   * so neighbours never drift in step. Pinned and held nodes do not drift:
   * they are where they were put.
   */
  const driftFor = useCallback((id: string, t: number) => {
    if (t === 0 || id === dragged.current || positions.current.get(id)?.fixed) return ZERO_DRIFT
    const phase = ((hashId(id) % 1000) / 1000) * Math.PI * 2
    const angle = t + phase
    return { dx: Math.sin(angle) * DRIFT_PX, dy: Math.cos(angle * 0.77) * DRIFT_PX }
  }, [])

  /**
   * Push positions onto the elements React has already rendered. `t` is the
   * drift phase in radians, or 0 while the simulation is running.
   */
  const paint = useCallback(
    (t = 0) => {
      const map = positions.current
      for (const [id, el] of nodeEls.current) {
        const p = map.get(id)
        if (!p) continue
        const d = driftFor(id, t)
        el.setAttribute('transform', `translate(${p.x + d.dx}, ${p.y + d.dy})`)
      }
      const list = edgesRef.current
      for (let i = 0; i < list.length; i++) {
        const el = edgeEls.current[i]
        if (!el) continue
        const a = map.get(list[i].source)
        const b = map.get(list[i].target)
        if (!a || !b) continue
        const da = driftFor(list[i].source, t)
        const db = driftFor(list[i].target, t)
        el.setAttribute('x1', String(a.x + da.dx))
        el.setAttribute('y1', String(a.y + da.dy))
        el.setAttribute('x2', String(b.x + db.dx))
        el.setAttribute('y2', String(b.y + db.dy))
      }
    },
    [driftFor]
  )
  paintRef.current = paint

  /**
   * Frame the current layout in the panel. Called repeatedly while the
   * simulation settles, so the graph visibly grows to fill its box instead of
   * sitting as a cluster of dots in the middle of an empty panel.
   */
  const fitToView = useCallback(() => {
    const list = [...positions.current.values()]
    const { width, height: h } = sizeRef.current
    if (list.length === 0 || width === 0 || h === 0) return

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const p of list) {
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }

    // Padding leaves room for the labels, which hang below each dot, and for
    // the toolbar and legend laid over the top and bottom edges.
    const padX = Math.max(16, Math.min(72, width * 0.08))
    const padY = Math.max(28, Math.min(72, h * 0.14))
    const spanX = Math.max(maxX - minX, 1)
    const spanY = Math.max(maxY - minY, 1)
    // Nodes and labels scale with the transform, so an unbounded fit turns a
    // two-node vault into two enormous dots with headline-sized captions.
    const zoom = Math.min(
      FIT_MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min((width - padX * 2) / spanX, (h - padY * 2) / spanY))
    )

    applyView({ x: -(minX + maxX) / 2, y: -(minY + maxY) / 2, zoom })
  }, [applyView])
  fitToViewRef.current = fitToView

  // A resize — the window, or the panel's own size setting — re-frames the
  // graph unless the user has taken the view over.
  useEffect(() => {
    if (!userMovedView.current) fitToView()
  }, [size, fitToView])

  // A fresh set of nodes re-enables auto-fit.
  useEffect(() => {
    userMovedView.current = false
  }, [nodes])

  // ----------------------------------------------------------------
  // Pointer
  // ----------------------------------------------------------------

  /** Screen point → world point. The inverse of the two transforms below. */
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    const view = viewRef.current
    return {
      x: (clientX - rect.left - rect.width / 2) / view.zoom - view.x,
      y: (clientY - rect.top - rect.height / 2) / view.zoom - view.y
    }
  }, [])

  const onPointerDownNode = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragged.current = id
    pressOrigin.current = { x: e.clientX, y: e.clientY }
    draggedFar.current = false
  }

  const onPointerMoveNode = (e: React.PointerEvent, id: string) => {
    if (dragged.current !== id) return
    const origin = pressOrigin.current
    if (!draggedFar.current) {
      if (!origin || Math.hypot(e.clientX - origin.x, e.clientY - origin.y) <= CLICK_SLOP_PX) return
      // Only now is it a drag. A press that never moves must not stop the
      // auto-fit or wake the simulation — it is a click.
      draggedFar.current = true
      userMovedView.current = true
    }
    const world = toWorld(e.clientX, e.clientY)
    const p = positions.current.get(id)
    if (!p) return
    p.x = world.x
    p.y = world.y
    p.vx = 0
    p.vy = 0
    reheat()
    paint()
  }

  const onPointerUpNode = (e: React.PointerEvent) => {
    const id = dragged.current
    if (!id) return
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
    dragged.current = null
    if (!draggedFar.current) return
    const p = positions.current.get(id)
    // A pinned node that is dragged moves its pin; anything else is let go
    // and settles back into the layout.
    if (p?.fixed && onPinsChange) {
      onPinsChange({ ...pins, [id]: [Math.round(p.x), Math.round(p.y)] })
    }
    reheat()
  }

  const togglePin = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!onPinsChange) return
    const p = positions.current.get(id)
    if (!p) return
    if (pins[id]) {
      const next = { ...pins }
      delete next[id]
      onPinsChange(next)
    } else {
      onPinsChange({ ...pins, [id]: [Math.round(p.x), Math.round(p.y)] })
    }
  }

  const onPointerDownBackground = (e: React.PointerEvent) => {
    if (e.button !== 0) return
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

  /** Zoom by a factor, keeping the world point under `at` (client coordinates) still. */
  const zoomBy = useCallback(
    (factor: number, at?: { x: number; y: number }) => {
      const v = viewRef.current
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor))
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect || !at) {
        applyView({ ...v, zoom })
        return
      }
      const sx = at.x - rect.left - rect.width / 2
      const sy = at.y - rect.top - rect.height / 2
      const wx = sx / v.zoom - v.x
      const wy = sy / v.zoom - v.y
      applyView({ zoom, x: sx / zoom - wx, y: sy / zoom - wy })
    },
    [applyView]
  )

  /**
   * The wheel, attached natively. React registers wheel listeners as passive,
   * so `preventDefault` inside `onWheel` did nothing — scrolling to zoom the
   * graph also scrolled Home out from under it.
   */
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      userMovedView.current = true
      // Trackpads send many small deltas; a mouse wheel sends a few large ones.
      const factor = Math.pow(WHEEL_STEP, -Math.max(-3, Math.min(3, e.deltaY / 40)))
      zoomBy(factor, { x: e.clientX, y: e.clientY })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [hasNodes, zoomBy])

  const resetView = () => {
    userMovedView.current = false
    fitToView()
  }

  const unpinAll = () => {
    onPinsChange?.({})
    reheat(240)
  }

  if (!hasNodes) {
    return (
      <div
        className="nx-graph__empty nx-type-data"
        style={{ height: height === 'fill' ? '100%' : height }}
      >
        no pages yet
      </div>
    )
  }

  const highlighted = hovered ? neighbours.get(hovered) : null
  const isDimmed = (id: string) => !!hovered && id !== hovered && !highlighted?.has(id)
  const nowMs = Date.now()
  const pinCount = Object.keys(pins).filter((id) => positions.current.has(id)).length
  const hubCount = nodes.length - pageCount

  const nodeTone = (node: SimNode): { className: string; tone?: string } => {
    if (node.kind === 'tag') return { className: '', tone: node.tone }
    if (node.kind === 'folder') return { className: '' }
    if (node.kind === 'canvas') return { className: '', tone: 'info' }
    if (colour === 'recency') return { className: recencyClass(daysSince(node.updated_at, nowMs)) }
    if (colour === 'type') return { className: '', tone: node.type_id ? typeTone.get(node.type_id) : undefined }
    return { className: '' }
  }

  return (
    <div
      ref={rootRef}
      className={`nx-graph ${viewRef.current.zoom < LABEL_MIN_ZOOM ? 'nx-graph--far' : ''} ${
        hovered ? 'nx-graph--focus' : ''
      }`}
      style={
        {
          height: height === 'fill' ? '100%' : height,
          '--nx-graph-label-scale': labelScale(viewRef.current.zoom)
        } as React.CSSProperties
      }
    >
      <svg
        ref={svgRef}
        className="nx-graph__canvas"
        onPointerDown={onPointerDownBackground}
        onPointerMove={onPointerMoveBackground}
        onPointerUp={onPointerUpBackground}
        onPointerLeave={onPointerUpBackground}
        onDoubleClick={resetView}
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
              const touchesHover = !!hovered && (edge.source === hovered || edge.target === hovered)
              const dim = !!hovered && !touchesHover
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
                  className={`nx-graph__edge ${edge.hub ? 'nx-graph__edge--hub' : ''} ${
                    dim ? 'nx-graph__edge--dim' : ''
                  } ${touchesHover ? 'nx-graph__edge--active' : ''}`}
                />
              )
            })}

            {nodes.map((node) => {
              const p = positions.current.get(node.id)
              if (!p) return null
              const r = nodeRadius(node)
              const active = node.id === activePageId
              const pinned = !!pins[node.id]
              const { className: toneClass, tone } = nodeTone(node)
              const showLabel =
                node.kind !== 'page' ||
                labelled === null ||
                labelled.has(node.id) ||
                node.id === hovered ||
                active
              const clickable = node.kind === 'page' || node.kind === 'canvas' || (node.kind === 'tag' && !!onOpenTag)
              return (
                <g
                  key={node.id}
                  ref={(el) => {
                    if (el) nodeEls.current.set(node.id, el)
                    else nodeEls.current.delete(node.id)
                  }}
                  data-node-id={node.id}
                  className={[
                    'nx-graph__node',
                    `nx-graph__node--${node.kind}`,
                    toneClass,
                    isDimmed(node.id) ? 'nx-graph__node--dim' : '',
                    node.id === hovered || highlighted?.has(node.id) ? 'nx-graph__node--lit' : '',
                    active ? 'nx-graph__node--active' : '',
                    pinned ? 'nx-graph__node--pinned' : '',
                    clickable ? '' : 'nx-graph__node--inert'
                  ].join(' ')}
                  style={tone ? ({ '--nx-graph-tone': `var(--nx-${tone})` } as React.CSSProperties) : undefined}
                  transform={`translate(${p.x}, ${p.y})`}
                  onPointerDown={(e) => onPointerDownNode(e, node.id)}
                  onPointerMove={(e) => onPointerMoveNode(e, node.id)}
                  onPointerUp={onPointerUpNode}
                  onPointerEnter={() => setHovered(node.id)}
                  onPointerLeave={() => setHovered(null)}
                  onContextMenu={(e) => togglePin(e, node.id)}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    // A drag ends in a click. Only an intentional one opens
                    // anything.
                    if (draggedFar.current) {
                      draggedFar.current = false
                      return
                    }
                    if (node.kind === 'page') openPage(node.id)
                    else if (node.kind === 'tag' && node.refId) onOpenTag?.(node.refId)
                    else if (node.kind === 'canvas' && node.refId) openCanvas(node.refId)
                  }}
                >
                  <circle className="nx-graph__node-hit" r={r + 8} />
                  {pinned && (
                    <circle className="nx-graph__node-pin" r={r + 4} />
                  )}
                  {node.kind === 'page' ? (
                    <circle className="nx-graph__node-dot" r={r} />
                  ) : node.kind === 'tag' ? (
                    <rect
                      className="nx-graph__node-dot nx-graph__node-dot--hub"
                      x={-r * 0.8}
                      y={-r * 0.8}
                      width={r * 1.6}
                      height={r * 1.6}
                      transform="rotate(45)"
                    />
                  ) : node.kind === 'canvas' ? (
                    // A board: wider than it is tall, and split by a rule, so
                    // it can never be read as a folder's square at a glance.
                    <g className="nx-graph__node-dot nx-graph__node-dot--hub nx-graph__node-dot--canvas">
                      <rect x={-r * 1.15} y={-r * 0.75} width={r * 2.3} height={r * 1.5} />
                      <line x1={-r * 0.2} y1={-r * 0.75} x2={-r * 0.2} y2={r * 0.75} />
                    </g>
                  ) : (
                    <rect
                      className="nx-graph__node-dot nx-graph__node-dot--hub"
                      x={-r * 0.85}
                      y={-r * 0.85}
                      width={r * 1.7}
                      height={r * 1.7}
                    />
                  )}
                  {showLabel && (
                    <text className="nx-graph__node-label" y={r + 4} dominantBaseline="hanging" textAnchor="middle">
                      {node.title.length > 26 ? `${node.title.slice(0, 25)}…` : node.title}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      {toolbar && <div className="nx-graph__toolbar">{toolbar}</div>}

      <div className="nx-graph__controls">
        {pinCount > 0 && onPinsChange && (
          <button onClick={unpinAll} title="Let every pinned node go">
            unpin {pinCount}
          </button>
        )}
        <button onClick={() => zoomBy(1.2)} title="Zoom in" aria-label="Zoom in">
          +
        </button>
        <button onClick={() => zoomBy(1 / 1.2)} title="Zoom out" aria-label="Zoom out">
          −
        </button>
        <button onClick={resetView} title="Fit graph to view (or double-click the background)">
          fit
        </button>
        {controls}
      </div>

      <div className="nx-graph__legend nx-type-data">
        {pageCount} pages · {linkCount} links
        {hubCount > 0 && ` · ${hubCount} hubs`}
        {onPinsChange ? ' · right-click to pin' : ''}
        {labelled !== null && ' · hover to name a node'}
      </div>
    </div>
  )
}
