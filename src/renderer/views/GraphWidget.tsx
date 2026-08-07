import type { GraphPreview } from '@shared/types'
import { useAppStore } from '../store/app-store'

const RADIUS = 70
const CENTER = { x: 150, y: 90 }

function satellitePosition(index: number, total: number) {
  const angle = (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2
  return {
    x: CENTER.x + Math.cos(angle) * RADIUS,
    y: CENTER.y + Math.sin(angle) * RADIUS
  }
}

interface Props {
  graph: GraphPreview
}

export function GraphWidget({ graph }: Props) {
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setActivePageId = useAppStore((s) => s.setActivePageId)

  const openPage = (id: string) => {
    setActiveView('vault')
    setActivePageId(id)
  }

  if (!graph.center) {
    return <div className="nx-type-data">no pages yet</div>
  }

  return (
    <div>
      <svg width="100%" height="180" viewBox="0 0 300 180">
        {graph.neighbors.map((n, i) => {
          const pos = satellitePosition(i, graph.neighbors.length)
          return (
            <line
              key={`edge-${n.id}`}
              x1={CENTER.x}
              y1={CENTER.y}
              x2={pos.x}
              y2={pos.y}
              stroke="var(--nx-border-2)"
              strokeWidth={1}
            />
          )
        })}
        {graph.neighbors.map((n, i) => {
          const pos = satellitePosition(i, graph.neighbors.length)
          return (
            <g key={n.id} className="nx-graph-node" onClick={() => openPage(n.id)}>
              <circle cx={pos.x} cy={pos.y} r={5} fill="var(--nx-accent)" opacity={0.6} />
              <text x={pos.x} y={pos.y + 18} textAnchor="middle" className="nx-graph-node__label">
                {(n.title || 'Untitled').slice(0, 14)}
              </text>
            </g>
          )
        })}
        <circle
          cx={CENTER.x}
          cy={CENTER.y}
          r={7}
          fill="var(--nx-critical)"
          className="nx-graph-node"
          onClick={() => openPage(graph.center!.id)}
        />
        <text x={CENTER.x} y={CENTER.y + 22} textAnchor="middle" className="nx-graph-node__label">
          {(graph.center.title || 'Untitled').slice(0, 14)}
        </text>
      </svg>
      <div className="nx-type-data">
        {graph.nodeCount} NODES // {graph.edgeCount} EDGES
      </div>
    </div>
  )
}
