/**
 * FactionGraph — modal SVG view of civilization relationships.
 *
 * Nodes are positioned by their geographic centroid (from the GeoJSON),
 * normalised into the SVG viewBox. Edges are drawn between them with
 * styling by edge type (trade/hostile/vassal/allied/shared_chokepoint).
 *
 * Clicking a node closes the modal and invokes onSelectFaction(civId);
 * the parent (App.tsx) decides what to do with that — typically open
 * the InfoPanel for that civ on the main map.
 */

import { useMemo, useEffect } from 'react'
import type { GeoJSONCollection } from '../App'
import { buildFactionGraph, type FactionEdge } from '../utils/faction-graph'

interface FactionGraphProps {
  open: boolean
  geojson: GeoJSONCollection | null
  onClose: () => void
  onSelectFaction: (civId: string) => void
}

const VIEWBOX_W = 720
const VIEWBOX_H = 480
const PAD = 60
const NODE_R = 22

// Color per edge type. trade is gold (matches our app's accent), hostile
// red, allied teal, vassal violet, shared_chokepoint dashed grey.
const EDGE_STYLE: Record<FactionEdge['type'], { stroke: string; dash?: string }> = {
  trade: { stroke: '#d4a854' },
  hostile: { stroke: '#e25b5b' },
  allied: { stroke: '#5bb5a8' },
  vassal: { stroke: '#a87ad4', dash: '6,3' },
  shared_chokepoint: { stroke: '#8a8f99', dash: '3,4' },
}

function getCentroid(props: Record<string, unknown>): [number, number] | null {
  const c = props.centroid
  if (Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
    return [c[0], c[1]]
  }
  return null
}

export default function FactionGraph({ open, geojson, onClose, onSelectFaction }: FactionGraphProps) {
  const graph = useMemo(() => {
    if (!geojson) return null
    return buildFactionGraph(geojson)
  }, [geojson])

  // Centroid lookup — keyed by node id, normalised to viewBox.
  const positions = useMemo(() => {
    if (!graph || !geojson) return new Map<string, [number, number]>()
    const raw = new Map<string, [number, number]>()
    for (const node of graph.nodes) {
      const feature = geojson.features.find(
        f => (f.properties?.id as string) === node.id || ((f as unknown as { id?: string }).id) === node.id,
      )
      const c = feature ? getCentroid(feature.properties || {}) : null
      if (c) raw.set(node.id, c)
    }
    if (raw.size === 0) return raw

    // Normalise: scale the centroid bounding box into [PAD, VIEWBOX-PAD].
    const xs = [...raw.values()].map(p => p[0])
    const ys = [...raw.values()].map(p => p[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const sx = maxX === minX ? 1 : (VIEWBOX_W - 2 * PAD) / (maxX - minX)
    const sy = maxY === minY ? 1 : (VIEWBOX_H - 2 * PAD) / (maxY - minY)
    const s = Math.min(sx, sy)
    const offsetX = (VIEWBOX_W - (maxX - minX) * s) / 2 - minX * s
    const offsetY = (VIEWBOX_H - (maxY - minY) * s) / 2 - minY * s

    const out = new Map<string, [number, number]>()
    for (const [id, [x, y]] of raw) {
      out.set(id, [x * s + offsetX, y * s + offsetY])
    }
    return out
  }, [graph, geojson])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  if (!graph) {
    return (
      <div className="search-overlay" onClick={onClose}>
        <div className="faction-graph-modal" onClick={(e) => e.stopPropagation()}>
          <div className="faction-graph-empty">Loading map data…</div>
        </div>
      </div>
    )
  }

  // Edge type → drawing order: shared_chokepoint at the bottom (visual
  // noise floor), then trade, then hostile/allied/vassal on top.
  const order: FactionEdge['type'][] = ['shared_chokepoint', 'trade', 'allied', 'vassal', 'hostile']
  const sortedEdges = [...graph.edges].sort(
    (a, b) => order.indexOf(a.type) - order.indexOf(b.type),
  )

  const edgesByType = sortedEdges.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1
    return acc
  }, {} as Partial<Record<FactionEdge['type'], number>>)

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="faction-graph-modal" onClick={(e) => e.stopPropagation()}>
        <div className="faction-graph-header">
          <span className="faction-graph-title">Faction Relationships</span>
          <span className="faction-graph-meta">
            {graph.nodes.length} civilizations · {graph.edges.length} relationships
          </span>
          <button
            className="faction-graph-close"
            onClick={onClose}
            aria-label="Close graph"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        <svg
          viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
          className="faction-graph-svg"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Edges */}
          {sortedEdges.map((edge, i) => {
            const a = positions.get(edge.source)
            const b = positions.get(edge.target)
            if (!a || !b) return null
            const style = EDGE_STYLE[edge.type]
            return (
              <line
                key={`${edge.source}-${edge.target}-${edge.type}-${i}`}
                x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
                stroke={style.stroke}
                strokeWidth={edge.type === 'trade' ? 2.5 : 1.8}
                strokeDasharray={style.dash}
                opacity={0.85}
              />
            )
          })}

          {/* Nodes */}
          {graph.nodes.map(node => {
            const pos = positions.get(node.id)
            if (!pos) return null
            return (
              <g
                key={node.id}
                className="faction-graph-node"
                transform={`translate(${pos[0]}, ${pos[1]})`}
                onClick={() => {
                  onSelectFaction(node.id)
                  onClose()
                }}
                role="button"
                tabIndex={0}
              >
                <circle r={NODE_R} className="faction-graph-node-circle" />
                <text
                  y={NODE_R + 14}
                  textAnchor="middle"
                  className="faction-graph-node-label"
                >
                  {node.name}
                </text>
              </g>
            )
          })}
        </svg>

        <div className="faction-graph-legend">
          {(Object.entries(EDGE_STYLE) as [FactionEdge['type'], typeof EDGE_STYLE[FactionEdge['type']]][]).map(([type, style]) => {
            const count = edgesByType[type] ?? 0
            if (count === 0) return null
            return (
              <span key={type} className="faction-graph-legend-item">
                <svg width={28} height={6} className="faction-graph-legend-swatch">
                  <line x1={0} y1={3} x2={28} y2={3} stroke={style.stroke} strokeWidth={2} strokeDasharray={style.dash} />
                </svg>
                <span>{type.replace('_', ' ')}</span>
                <span className="faction-graph-legend-count">×{count}</span>
              </span>
            )
          })}
          {graph.edges.length === 0 && (
            <span className="faction-graph-legend-empty">
              No relationships yet — extend data/veydria-topology.yaml with a relationships block to populate this view.
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
