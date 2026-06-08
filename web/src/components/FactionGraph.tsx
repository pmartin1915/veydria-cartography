/**
 * FactionGraph — modal SVG view of civilization relationships.
 *
 * Nodes are positioned by their geographic centroid (from the GeoJSON),
 * normalised into the SVG viewBox. Edges are the canonical cross-civ
 * relationships from canon.json: TYPELESS and UNDIRECTED, with stroke width
 * scaled by canon `density`. Clicking an edge opens a prose panel (the canon
 * lede). The factions layer owns relationships as prose, not categorical
 * stance (worldbuilder ADR-0019 D4) — so there is no per-type colouring.
 *
 * Clicking a civ node closes the modal and invokes onSelectFaction(civId);
 * the parent (App.tsx) typically opens the InfoPanel for that civ. Place nodes
 * (e.g. the Aethelian Basin) are place-as-actors with no InfoPanel — their
 * click is a no-op.
 */

import { useMemo, useEffect, useState } from 'react'
import type { GeoJSONCollection, GeoJSONFeature } from '../App'
import {
  buildFactionGraph,
  PLACE_NODE_SOURCE_FEATURE,
  type FactionEdge,
  type CanonCrossCivEntity,
} from '../utils/faction-graph'

interface FactionGraphProps {
  open: boolean
  geojson: GeoJSONCollection | null
  crossCivEntities?: CanonCrossCivEntity[]
  onClose: () => void
  onSelectFaction: (civId: string) => void
}

const VIEWBOX_W = 720
const VIEWBOX_H = 480
const PAD = 60
const NODE_R = 22

// Neutral edge colour (canon relationships carry no stance). Selected edge
// brightens to the app's gold accent.
const EDGE_STROKE = '#8a8f99'
const EDGE_STROKE_SELECTED = '#d4a854'

// Density → stroke width. Canon density runs ~4–8; clamp outside that band.
const DENSITY_MIN = 4
const DENSITY_MAX = 8
function edgeWidth(weight: number): number {
  const MIN_W = 1.5
  const MAX_W = 6
  const t = Math.max(0, Math.min(1, (weight - DENSITY_MIN) / (DENSITY_MAX - DENSITY_MIN)))
  return MIN_W + t * (MAX_W - MIN_W)
}

function getCentroid(props: Record<string, unknown>): [number, number] | null {
  const c = props.centroid
  if (Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
    return [c[0], c[1]]
  }
  return null
}

/** Bounding-box centre of a Polygon's outer ring — fallback position for place nodes. */
function polygonBboxCentroid(geometry: GeoJSONFeature['geometry']): [number, number] | null {
  if (!geometry || geometry.type !== 'Polygon') return null
  const ring = (geometry.coordinates as unknown as number[][][])[0]
  if (!Array.isArray(ring) || ring.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2) continue
    const [x, y] = pt as number[]
    if (typeof x !== 'number' || typeof y !== 'number') continue
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (!isFinite(minX)) return null
  return [(minX + maxX) / 2, (minY + maxY) / 2]
}

export default function FactionGraph({ open, geojson, crossCivEntities, onClose, onSelectFaction }: FactionGraphProps) {
  const [selectedEdge, setSelectedEdge] = useState<FactionEdge | null>(null)

  const graph = useMemo(() => {
    if (!geojson) return null
    return buildFactionGraph(geojson, crossCivEntities)
  }, [geojson, crossCivEntities])

  // Centroid lookup — keyed by node id, normalised to viewBox. Place nodes have
  // no civilization feature, so we read their source feature's polygon centroid.
  const positions = useMemo(() => {
    if (!graph || !geojson) return new Map<string, [number, number]>()
    const findFeature = (id: string): GeoJSONFeature | undefined =>
      geojson.features.find(
        f => (f.properties?.id as string) === id || ((f as unknown as { id?: string }).id) === id,
      )
    const raw = new Map<string, [number, number]>()
    for (const node of graph.nodes) {
      let c: [number, number] | null = null
      if (node.isPlace) {
        const srcId = PLACE_NODE_SOURCE_FEATURE[node.id]
        const feat = srcId ? findFeature(srcId) : undefined
        c = feat ? (getCentroid(feat.properties || {}) ?? polygonBboxCentroid(feat.geometry)) : null
      } else {
        const feature = findFeature(node.id)
        c = feature ? getCentroid(feature.properties || {}) : null
      }
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
      if (e.key === 'Escape') {
        if (selectedEdge) setSelectedEdge(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, selectedEdge])

  // Reset any open prose panel when the modal closes.
  useEffect(() => {
    if (!open) setSelectedEdge(null)
  }, [open])

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

  // Thinner (lower-density) edges drawn first so heavier ties sit on top.
  const sortedEdges = [...graph.edges].sort((a, b) => a.weight - b.weight)
  const selectedKey = selectedEdge ? `${selectedEdge.source}--${selectedEdge.target}` : null

  const civCount = graph.nodes.filter(n => !n.isPlace).length
  const placeCount = graph.nodes.length - civCount

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="faction-graph-modal" onClick={(e) => e.stopPropagation()}>
        <div className="faction-graph-header">
          <span className="faction-graph-title">Faction Relationships</span>
          <span className="faction-graph-meta">
            {civCount} civilizations
            {placeCount > 0 ? ` · ${placeCount} place${placeCount === 1 ? '' : 's'}` : ''}
            {' · '}{graph.edges.length} relationships
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
          {/* Edges. A transparent wide line provides a comfortable click target. */}
          {sortedEdges.map((edge, i) => {
            const a = positions.get(edge.source)
            const b = positions.get(edge.target)
            if (!a || !b) return null
            const key = `${edge.source}--${edge.target}`
            const isSel = key === selectedKey
            return (
              <g key={`${key}-${i}`} className="faction-graph-edge" role="button" tabIndex={0}
                 onClick={() => setSelectedEdge(edge)}>
                <title>{edge.name ?? `${edge.source} ↔ ${edge.target}`}{typeof edge.weight === 'number' ? ` (density ${edge.weight})` : ''}</title>
                <line
                  x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
                  stroke="transparent" strokeWidth={14}
                  style={{ cursor: 'pointer' }}
                />
                <line
                  x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
                  stroke={isSel ? EDGE_STROKE_SELECTED : EDGE_STROKE}
                  strokeWidth={edgeWidth(edge.weight) + (isSel ? 1 : 0)}
                  opacity={isSel ? 1 : 0.8}
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            )
          })}

          {/* Nodes */}
          {graph.nodes.map(node => {
            const pos = positions.get(node.id)
            if (!pos) return null
            const clickable = !node.isPlace
            return (
              <g
                key={node.id}
                className={`faction-graph-node${node.isPlace ? ' faction-graph-node-place' : ''}`}
                transform={`translate(${pos[0]}, ${pos[1]})`}
                onClick={clickable ? () => { onSelectFaction(node.id); onClose() } : undefined}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                style={clickable ? undefined : { cursor: 'default' }}
              >
                <circle
                  r={NODE_R}
                  className="faction-graph-node-circle"
                  strokeDasharray={node.isPlace ? '4,3' : undefined}
                />
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

        {/* Prose panel for the selected relationship. */}
        {selectedEdge && (
          <div className="faction-graph-edge-panel">
            <div className="faction-graph-edge-panel-head">
              <span className="faction-graph-edge-panel-title">
                {selectedEdge.name ?? `${selectedEdge.source} ↔ ${selectedEdge.target}`}
              </span>
              <button
                className="faction-graph-edge-panel-close"
                onClick={() => setSelectedEdge(null)}
                aria-label="Close relationship detail"
                title="Close"
              >
                ✕
              </button>
            </div>
            <p className="faction-graph-edge-panel-body">
              {selectedEdge.lede || selectedEdge.summary || 'No description available.'}
            </p>
          </div>
        )}

        <div className="faction-graph-legend">
          {graph.edges.length > 0 ? (
            <>
              <span className="faction-graph-legend-item">
                <svg width={40} height={8} className="faction-graph-legend-swatch">
                  <line x1={0} y1={4} x2={40} y2={4} stroke={EDGE_STROKE} strokeWidth={edgeWidth(DENSITY_MIN)} />
                </svg>
                <span>fewer ties</span>
              </span>
              <span className="faction-graph-legend-item">
                <svg width={40} height={8} className="faction-graph-legend-swatch">
                  <line x1={0} y1={4} x2={40} y2={4} stroke={EDGE_STROKE} strokeWidth={edgeWidth(DENSITY_MAX)} />
                </svg>
                <span>denser ties</span>
              </span>
              <span className="faction-graph-legend-hint">Click an edge to read the relationship.</span>
            </>
          ) : (
            <span className="faction-graph-legend-empty">
              No cross-civ relationships loaded — ensure canon.json is synced (npm run sync:data).
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
