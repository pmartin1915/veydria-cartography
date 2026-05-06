/**
 * journey-graph.ts — Graph construction + Dijkstra pathfinding for Journey Mode
 *
 * Builds a routable graph from GeoJSON features:
 *   - Nodes: all named point features + civilization centroids
 *   - Edges: trade routes (connect civilizations), chokepoint connections,
 *            intra-civilization links (points to their civilization centroid)
 *
 * Pathfinding returns the shortest route with distance, time estimate,
 * and bottleneck warnings.
 */

import { GeoJSONFeature, GeoJSONCollection } from '../App'
import { svgDistanceToKm } from './measure'

export interface JourneyNode {
  id: string
  name: string
  category: string
  x: number
  y: number
  civ?: string
}

export interface JourneyEdge {
  from: string
  to: string
  distanceSvg: number
  type: 'trade_route' | 'chokepoint' | 'intra_civ' | 'civ_link'
  name: string
  bottleneck?: string
  seasonal?: string
}

export interface JourneyRoute {
  nodes: JourneyNode[]
  edges: JourneyEdge[]
  totalDistanceSvg: number
  totalKm: number
  estimatedDays: number
  bottlenecks: string[]
  seasonalWarnings: string[]
}

interface Graph {
  nodes: Map<string, JourneyNode>
  adj: Map<string, Array<{ to: string; edge: JourneyEdge }>>
}

// Euclidean distance between two points
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

// Determine which civilization a point belongs to by nearest centroid
function findNearestCiv(
  point: { x: number; y: number },
  civs: JourneyNode[]
): JourneyNode | null {
  let nearest: JourneyNode | null = null
  let minDist = Infinity
  for (const civ of civs) {
    const d = dist(point, civ)
    if (d < minDist) {
      minDist = d
      nearest = civ
    }
  }
  return nearest
}

// Build the routable graph from GeoJSON
export function buildGraph(geojson: GeoJSONCollection): Graph {
  const nodes = new Map<string, JourneyNode>()
  const adj = new Map<string, Array<{ to: string; edge: JourneyEdge }>>()

  function addNode(n: JourneyNode) {
    if (!nodes.has(n.id)) {
      nodes.set(n.id, n)
      adj.set(n.id, [])
    }
  }

  function addEdge(e: JourneyEdge) {
    const a = adj.get(e.from)
    const b = adj.get(e.to)
    if (a) a.push({ to: e.to, edge: e })
    if (b) b.push({ to: e.from, edge: { ...e, from: e.to, to: e.from } })
  }

  // Compute centroid for a polygon feature
  function polygonCentroid(rings: number[][][]): [number, number] {
    const ring = rings[0]
    let cx = 0, cy = 0
    for (const [x, y] of ring) { cx += x; cy += y }
    return [cx / ring.length, cy / ring.length]
  }

  // ── 1. Civilization centroids + key polygon features ──
  const civNodes: JourneyNode[] = []
  for (const f of geojson.features) {
    const cat = f.properties.category as string
    if (cat !== 'civilization' && cat !== 'water') continue
    const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
    if (!id) continue

    let centroid: [number, number] | undefined = f.properties.centroid as [number, number] | undefined
    if (!centroid && f.geometry.type === 'Polygon') {
      centroid = polygonCentroid(f.geometry.coordinates as number[][][])
    }
    if (!centroid) continue

    const node: JourneyNode = {
      id,
      name: f.properties.name as string || id,
      category: cat,
      x: centroid[0],
      y: centroid[1],
      civ: id,
    }
    addNode(node)
    if (cat === 'civilization') civNodes.push(node)
  }

  // Alias mapping for trade route endpoints that use short names
  const ID_ALIASES: Record<string, string> = {
    basin: 'aethelian_basin',
  }

// Seasonal restrictions keyed by trade route name (lowercase, spaces→underscores)
const SEASONAL_DATA: Record<string, string> = {
  'coastal_monsoon': 'Monsoon-gated: SE trade season (late spring–early autumn) only. NW monsoon (Nov–Mar) is marginal with cyclone risk.',
  'caravan_thread': 'Desert crossing: Irrah caravans avoid high summer. Qalībin escorts required for Basin leg.',
}

  // ── 2. Point features (ports, oases, landmarks, chokepoints, contested sites) ──
  const pointFeatures: Array<{ feature: GeoJSONFeature; node: JourneyNode }> = []
  for (const f of geojson.features) {
    if (f.geometry.type !== 'Point') continue
    const cat = f.properties.category as string
    if (cat === 'civilization') continue
    const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
    if (!id) continue
    const [x, y] = f.geometry.coordinates as number[]
    const node: JourneyNode = {
      id,
      name: f.properties.name as string || id,
      category: cat,
      x,
      y,
    }
    addNode(node)
    pointFeatures.push({ feature: f, node })
  }

  // ── 3. Link each point to its nearest civilization ──
  for (const { node } of pointFeatures) {
    const nearestCiv = findNearestCiv(node, civNodes)
    if (nearestCiv) {
      node.civ = nearestCiv.id
      const d = dist(node, nearestCiv)
      addEdge({
        from: node.id,
        to: nearestCiv.id,
        distanceSvg: d,
        type: 'intra_civ',
        name: `Within ${nearestCiv.name}`,
      })
    }
  }

  // Helper to resolve an endpoint id (with alias fallback)
  function resolveId(id: string): string {
    if (nodes.has(id)) return id
    const aliased = ID_ALIASES[id]
    return aliased && nodes.has(aliased) ? aliased : id
  }

  // ── 4. Trade routes as edges between civilizations ──
  for (const f of geojson.features) {
    if (f.properties.category !== 'trade_route') continue
    const endpoints = f.properties.endpoints as string[] | undefined
    if (!endpoints || endpoints.length < 2) continue

    // Resolve endpoint ids through aliases
    const resolved = endpoints.map(resolveId)

    // Calculate route length from LineString
    let routeLen = 0
    if (f.geometry.type === 'LineString') {
      const coords = f.geometry.coordinates as number[][]
      for (let i = 1; i < coords.length; i++) {
        routeLen += dist(
          { x: coords[i - 1][0], y: coords[i - 1][1] },
          { x: coords[i][0], y: coords[i][1] }
        )
      }
    }

    // Look up seasonal warning by route name
    const routeKey = (f.properties.id as string || '').toLowerCase()
    const routeSeasonal = SEASONAL_DATA[routeKey]

    // If route has no geometry length, estimate from centroid-to-centroid
    if (routeLen === 0) {
      const nodeA = nodes.get(resolved[0])
      const nodeB = nodes.get(resolved[1])
      if (nodeA && nodeB) routeLen = dist(nodeA, nodeB)
    }

    // Connect each pair of endpoints (usually just 2)
    for (let i = 0; i < resolved.length - 1; i++) {
      const a = resolved[i]
      const b = resolved[i + 1]
      if (!nodes.has(a) || !nodes.has(b)) continue
      addEdge({
        from: a,
        to: b,
        distanceSvg: routeLen,
        type: 'trade_route',
        name: f.properties.name as string || 'Trade Route',
        bottleneck: f.properties.bottleneck as string | undefined,
        seasonal: routeSeasonal,
      })
    }
  }

  // ── 5. Chokepoints as edges between connected civilizations ──
  for (const f of geojson.features) {
    if (f.properties.category !== 'chokepoint') continue
    const connects = f.properties.connects as string[] | undefined
    if (!connects || connects.length < 2) continue

    // Seasonal warning for maritime chokepoints
    const chokeSeasonal = f.properties.type === 'maritime_strait'
      ? 'Maritime passage subject to monsoon windows and naval patrols.'
      : undefined

    // Connect all pairs in the connects list
    for (let i = 0; i < connects.length; i++) {
      for (let j = i + 1; j < connects.length; j++) {
        const a = resolveId(connects[i])
        const b = resolveId(connects[j])
        if (!nodes.has(a) || !nodes.has(b)) continue
        const civA = nodes.get(a)!
        const civB = nodes.get(b)!
        // Chokepoints are harder: multiply distance by penalty
        const baseDist = dist(civA, civB)
        const penalty = f.properties.type === 'mountain_pass' ? 2.5 :
                        f.properties.type === 'river_crossing' ? 1.8 :
                        f.properties.type === 'maritime_strait' ? 1.5 :
                        2.0
        addEdge({
          from: a,
          to: b,
          distanceSvg: baseDist * penalty,
          type: 'chokepoint',
          name: f.properties.name as string || 'Chokepoint',
          bottleneck: f.properties.strategic_value as string | undefined,
          seasonal: chokeSeasonal,
        })
      }
    }
  }

  // ── 6. Direct civ-to-civ edges for adjacent civilizations (border crossings) ──
  // Derive from terrain_cell adjacency: if two civs share a border, add a direct link
  const civBorderPairs = new Set<string>()
  // We don't have explicit cell adjacency, so infer from chokepoint connections
  // and trade route endpoints. Any civ pair that shares a chokepoint or trade
  // route is already connected. For additional adjacency, we'd need cell
  // neighbor computation — skip for now to keep it simple.

  return { nodes, adj }
}

// Dijkstra shortest path
export function findRoute(graph: Graph, startId: string, endId: string): JourneyRoute | null {
  if (!graph.nodes.has(startId) || !graph.nodes.has(endId)) return null
  if (startId === endId) {
    const node = graph.nodes.get(startId)!
    return {
      nodes: [node],
      edges: [],
      totalDistanceSvg: 0,
      totalKm: 0,
      estimatedDays: 0,
      bottlenecks: [],
      seasonalWarnings: [],
    }
  }

  const distMap = new Map<string, number>()
  const prev = new Map<string, { node: string; edge: JourneyEdge } | null>()
  const visited = new Set<string>()
  const pq: Array<{ id: string; d: number }> = []

  for (const id of graph.nodes.keys()) {
    distMap.set(id, Infinity)
    prev.set(id, null)
  }
  distMap.set(startId, 0)
  pq.push({ id: startId, d: 0 })

  while (pq.length > 0) {
    pq.sort((a, b) => a.d - b.d)
    const { id: u } = pq.shift()!
    if (visited.has(u)) continue
    visited.add(u)
    if (u === endId) break

    const neighbors = graph.adj.get(u) || []
    for (const { to: v, edge } of neighbors) {
      if (visited.has(v)) continue
      const alt = (distMap.get(u) || Infinity) + edge.distanceSvg
      if (alt < (distMap.get(v) || Infinity)) {
        distMap.set(v, alt)
        prev.set(v, { node: u, edge })
        pq.push({ id: v, d: alt })
      }
    }
  }

  if (distMap.get(endId) === Infinity) return null

  // Reconstruct path
  const pathNodes: JourneyNode[] = []
  const pathEdges: JourneyEdge[] = []
  let u: string | null = endId
  while (u !== null) {
    const node = graph.nodes.get(u)
    if (node) pathNodes.unshift(node)
    const p = prev.get(u)
    if (p) {
      pathEdges.unshift(p.edge)
      u = p.node
    } else {
      u = null
    }
  }

  const totalSvg = distMap.get(endId) || 0
  const totalKm = svgDistanceToKm(totalSvg)
  // Mixed travel speed: 25 km/day average for overland + mountain/chokepoint penalties
  const estimatedDays = totalKm / 25

  const bottlenecks: string[] = []
  const seasonalWarnings: string[] = []
  for (const edge of pathEdges) {
    if (edge.bottleneck && !bottlenecks.includes(edge.bottleneck)) {
      bottlenecks.push(edge.bottleneck)
    }
    if (edge.seasonal && !seasonalWarnings.includes(edge.seasonal)) {
      seasonalWarnings.push(edge.seasonal)
    }
  }

  return {
    nodes: pathNodes,
    edges: pathEdges,
    totalDistanceSvg: totalSvg,
    totalKm,
    estimatedDays,
    bottlenecks,
    seasonalWarnings,
  }
}

// Get all selectable journey nodes (named points + civilizations)
export function getJourneyNodes(geojson: GeoJSONCollection): JourneyNode[] {
  const graph = buildGraph(geojson)
  return Array.from(graph.nodes.values()).sort((a, b) => a.name.localeCompare(b.name))
}
