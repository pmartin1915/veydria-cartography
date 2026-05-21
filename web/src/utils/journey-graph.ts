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

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type RouteMode = 'direct' | 'fastest' | 'safest' | 'cheapest'

export type TravelPace = 'slow' | 'normal' | 'fast'
export type Mount = 'foot' | 'mounted'
export type PartySize = 'small' | 'medium' | 'large' // <5 / 5–10 / 10+

export interface PartyConfig {
  pace: TravelPace
  mount: Mount
  size: PartySize
  forcedMarch: boolean
}

export const DEFAULT_PARTY: PartyConfig = {
  pace: 'normal',
  mount: 'foot',
  size: 'medium',
  forcedMarch: false,
}

export function isDefaultParty(p: PartyConfig): boolean {
  return p.pace === 'normal' && p.mount === 'foot' && p.size === 'medium' && !p.forcedMarch
}

/**
 * Multiplier applied to the base km/day speed of an edge given the party config.
 * Chokepoints are deliberately resistant to pace/mount so bottleneck warnings
 * remain meaningful — at most a 25% lift from forced march, then a small drag
 * from a large party. Open roads benefit fully from pace and mount.
 */
export function getPaceMultiplier(p: PartyConfig, edgeType: JourneyEdge['type']): number {
  const isChokepoint = edgeType === 'chokepoint'

  let m = 1
  // Pace
  if (p.pace === 'slow') m *= 0.75
  else if (p.pace === 'fast') m *= 1.33

  // Mount: open road benefit only
  if (p.mount === 'mounted' && !isChokepoint) m *= 1.5

  // Forced march: 25% lift, applies everywhere (it's the point of the toggle)
  if (p.forcedMarch) m *= 1.25

  // Large party drags caravans through tight terrain
  if (p.size === 'large' && isChokepoint) m *= 0.9

  return m
}

export interface SeasonalRestriction {
  warning: string
  blockedIn: Season[]
  riskyIn: Season[]
}

export interface JourneyEdge {
  from: string
  to: string
  distanceSvg: number
  type: 'trade_route' | 'chokepoint' | 'intra_civ' | 'civ_link'
  name: string
  bottleneck?: string
  seasonal?: string
  seasonalKey?: string
  segmentDays?: number
  commodities?: string
  consequenceIfClosed?: string
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

// Seasonal restrictions keyed by route/chokepoint id
const SEASONAL_DATA: Record<string, SeasonalRestriction> = {
  'coastal_monsoon': {
    warning: 'Monsoon-gated: SE trade season (late spring–early autumn) only. NW monsoon (Nov–Mar) is marginal with cyclone risk.',
    blockedIn: ['winter'],
    riskyIn: [],
  },
  'caravan_thread': {
    warning: 'Desert crossing: Irrah caravans avoid high summer. Qalībin escorts required for Basin leg.',
    blockedIn: ['summer'],
    riskyIn: [],
  },
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

    // Look up seasonal restriction by route name
    const routeKey = (f.properties.id as string || '').toLowerCase()
    const routeSeasonalInfo = SEASONAL_DATA[routeKey]

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
        seasonal: routeSeasonalInfo?.warning,
        seasonalKey: routeSeasonalInfo ? routeKey : undefined,
        commodities: f.properties.commodities as string | undefined,
        consequenceIfClosed: f.properties.consequence_if_closed as string | undefined,
      })
    }
  }

  // ── 5. Chokepoints as edges between connected civilizations ──
  for (const f of geojson.features) {
    if (f.properties.category !== 'chokepoint') continue
    const connects = f.properties.connects as string[] | undefined
    if (!connects || connects.length < 2) continue

    // Seasonal restriction for maritime chokepoints
    const isMaritimeStrait = f.properties.type === 'maritime_strait'
    const chokeSeasonalInfo: SeasonalRestriction | undefined = isMaritimeStrait
      ? { warning: 'Maritime passage subject to monsoon windows and naval patrols.', blockedIn: ['winter'], riskyIn: [] }
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
          seasonal: chokeSeasonalInfo?.warning,
          seasonalKey: chokeSeasonalInfo ? `choke_${f.properties.id as string}` : undefined,
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

function getEdgeWeight(edge: JourneyEdge, mode: RouteMode): number {
  if (mode === 'direct') return edge.distanceSvg

  const distance = edge.distanceSvg

  if (mode === 'fastest') {
    const speed = edge.type === 'trade_route' ? 2.0 :
                  edge.type === 'chokepoint' ? 0.5 :
                  edge.type === 'intra_civ' ? 1.0 :
                  1.0
    return distance / speed
  }

  if (mode === 'safest') {
    const risk = edge.type === 'trade_route' ? 1.0 :
                 edge.type === 'chokepoint' ? 3.0 :
                 edge.type === 'intra_civ' ? 1.2 :
                 1.5
    return distance * risk
  }

  if (mode === 'cheapest') {
    const cost = edge.type === 'trade_route' ? 1.0 :
                 edge.type === 'chokepoint' ? 2.0 :
                 edge.type === 'intra_civ' ? 1.0 :
                 1.5
    return distance * cost
  }

  return distance
}

/** Dijkstra shortest path with optional seasonal filtering and route mode.
 *  If a season is given, edges blocked in that season get a 10× penalty.
 */
export function findRoute(graph: Graph, startId: string, endId: string, season?: Season, mode: RouteMode = 'direct', party: PartyConfig = DEFAULT_PARTY): JourneyRoute | null {
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
      let edgeCost = getEdgeWeight(edge, mode)
      if (season && edge.seasonalKey) {
        const restriction = SEASONAL_DATA[edge.seasonalKey]
        if (restriction?.blockedIn.includes(season)) {
          edgeCost *= 10
        }
      }
      const alt = (distMap.get(u) ?? Infinity) + edgeCost
      if (alt < (distMap.get(v) ?? Infinity)) {
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

  // Raw geographic distance (not penalized cost)
  const rawTotalSvg = pathEdges.reduce((sum, e) => sum + e.distanceSvg, 0)
  const totalKm = svgDistanceToKm(rawTotalSvg)

  // Per-segment day estimates based on edge type, modulated by party config
  const speedByType: Record<string, number> = {
    trade_route: 50,
    chokepoint: 12.5,
    intra_civ: 25,
    civ_link: 25,
  }
  for (const edge of pathEdges) {
    const km = svgDistanceToKm(edge.distanceSvg)
    const baseSpeed = speedByType[edge.type] || 25
    const speed = baseSpeed * getPaceMultiplier(party, edge.type)
    edge.segmentDays = km / speed
  }

  // estimatedDays = sum of per-edge segmentDays so it stays consistent with
  // the day-by-day breakdown (and reflects party config automatically).
  const estimatedDays = pathEdges.reduce((sum, e) => sum + (e.segmentDays || 0), 0)

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
    totalDistanceSvg: rawTotalSvg,
    totalKm,
    estimatedDays,
    bottlenecks,
    seasonalWarnings,
  }
}

/** Compute a multi-stop route through a series of waypoints.
 *  Returns null if any leg is unreachable.
 */
export function findMultiStopRoute(
  graph: Graph,
  stops: string[],
  season?: Season,
  mode: RouteMode = 'direct',
  party: PartyConfig = DEFAULT_PARTY
): JourneyRoute | null {
  if (stops.length < 2) return null

  const allNodes: JourneyNode[] = []
  const allEdges: JourneyEdge[] = []
  const allBottlenecks: string[] = []
  const allSeasonal: string[] = []
  let totalRawSvg = 0
  let totalDays = 0

  for (let i = 0; i < stops.length - 1; i++) {
    const leg = findRoute(graph, stops[i], stops[i + 1], season, mode, party)
    if (!leg) return null

    if (i === 0) {
      allNodes.push(...leg.nodes)
    } else {
      // Skip the first node of subsequent legs (it's the last node of previous leg)
      allNodes.push(...leg.nodes.slice(1))
    }
    allEdges.push(...leg.edges)
    totalRawSvg += leg.totalDistanceSvg
    totalDays += leg.estimatedDays
    for (const b of leg.bottlenecks) {
      if (!allBottlenecks.includes(b)) allBottlenecks.push(b)
    }
    for (const s of leg.seasonalWarnings) {
      if (!allSeasonal.includes(s)) allSeasonal.push(s)
    }
  }

  const totalKm = svgDistanceToKm(totalRawSvg)

  return {
    nodes: allNodes,
    edges: allEdges,
    totalDistanceSvg: totalRawSvg,
    totalKm,
    estimatedDays: totalDays,
    bottlenecks: allBottlenecks,
    seasonalWarnings: allSeasonal,
  }
}

/** Find a route, falling back to single- or double-civ pivots if a direct
 *  Dijkstra search returns null. The graph is mostly connected through
 *  civilization centroids, so when the direct call fails we look for the
 *  cheapest single intermediate civ that bridges start and end, and if
 *  none works, the cheapest pair of intermediate civs.
 *
 *  Returns the best route found and the list of pivots used (so the UI can
 *  surface "auto-routed via X").
 */
export function findRouteWithFallback(
  graph: Graph,
  startId: string,
  endId: string,
  season?: Season,
  mode: RouteMode = 'direct',
  party: PartyConfig = DEFAULT_PARTY
): { route: JourneyRoute | null; pivots: JourneyNode[] } {
  const direct = findRoute(graph, startId, endId, season, mode, party)
  if (direct) return { route: direct, pivots: [] }

  const civs = Array.from(graph.nodes.values()).filter(n =>
    n.category === 'civilization' && n.id !== startId && n.id !== endId
  )

  // Try single-civ pivots
  let best: { route: JourneyRoute; pivots: JourneyNode[] } | null = null
  for (const c of civs) {
    const r = findMultiStopRoute(graph, [startId, c.id, endId], season, mode, party)
    if (r && (!best || r.totalKm < best.route.totalKm)) {
      best = { route: r, pivots: [c] }
    }
  }
  if (best) return best

  // Two-civ pivots — bounded combinatorial since civs.length is small (≤6)
  for (const c1 of civs) {
    for (const c2 of civs) {
      if (c1.id === c2.id) continue
      const r = findMultiStopRoute(graph, [startId, c1.id, c2.id, endId], season, mode, party)
      if (r && (!best || r.totalKm < (best as { route: JourneyRoute }).route.totalKm)) {
        best = { route: r, pivots: [c1, c2] }
      }
    }
  }
  if (best) return best

  return { route: null, pivots: [] }
}

export type ComparisonRoutes = Record<'direct' | 'safest' | 'cheapest', JourneyRoute | null>

/** Compute direct, safest, and cheapest routes for side-by-side comparison. */
export function findComparisonRoutes(
  graph: Graph,
  startId: string,
  endId: string,
  season?: Season,
  party: PartyConfig = DEFAULT_PARTY
): ComparisonRoutes {
  return {
    direct: findRouteWithFallback(graph, startId, endId, season, 'direct', party).route,
    safest: findRouteWithFallback(graph, startId, endId, season, 'safest', party).route,
    cheapest: findRouteWithFallback(graph, startId, endId, season, 'cheapest', party).route,
  }
}

/** Derive a difficulty class from edge composition. */
export function getRouteDifficulty(route: JourneyRoute): { class: string; label: string } {
  if (route.edges.length === 0) return { class: 'trivial', label: 'Trivial' }
  const tradeCount = route.edges.filter(e => e.type === 'trade_route').length
  const chokeCount = route.edges.filter(e => e.type === 'chokepoint').length
  const tradeRatio = tradeCount / route.edges.length
  const chokeRatio = chokeCount / route.edges.length

  if (chokeRatio >= 0.5) return { class: 'explorer', label: 'Explorer-grade' }
  if (tradeRatio >= 0.7) return { class: 'merchant', label: 'Merchant-grade' }
  if (chokeRatio >= 0.25) return { class: 'mixed', label: 'Mixed-trail' }
  return { class: 'merchant', label: 'Merchant-grade' }
}

// Get all selectable journey nodes (named points + civilizations)
export function getJourneyNodes(geojson: GeoJSONCollection): JourneyNode[] {
  const graph = buildGraph(geojson)
  return Array.from(graph.nodes.values()).sort((a, b) => a.name.localeCompare(b.name))
}
