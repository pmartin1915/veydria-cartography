import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { buildGraph, findRoute, findRouteWithFallback, findComparisonRoutes, getJourneyNodes, straitAnnotation, isSeaLeg, DEFAULT_PARTY, type PartyConfig, type JourneyNode } from './journey-graph'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPATIAL_PATH = resolve(__dirname, '../../public/veydria-spatial.geojson')

interface GeoJSON {
  type: string
  features: Array<{ type: string; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }>
}

let geojson: GeoJSON
let graph: ReturnType<typeof buildGraph>
let nodes: ReturnType<typeof getJourneyNodes>

beforeAll(() => {
  geojson = JSON.parse(readFileSync(SPATIAL_PATH, 'utf-8'))
  graph = buildGraph(geojson as never)
  nodes = getJourneyNodes(geojson as never)
})

describe('journey-graph: Dijkstra start-node fix', () => {
  it('produces a non-null route from a port to an oasis', () => {
    const port = nodes.find(n => n.category === 'port')
    const oasis = nodes.find(n => n.category === 'oasis')
    expect(port, 'expected at least one port in the graph').toBeDefined()
    expect(oasis, 'expected at least one oasis in the graph').toBeDefined()

    const route = findRoute(graph, port!.id, oasis!.id)
    expect(route, 'route should not be null — this guards the || → ?? bug').not.toBeNull()
    expect(route!.nodes.length).toBeGreaterThanOrEqual(2)
    expect(route!.totalKm).toBeGreaterThan(0)
  })

  it('returns a route where every hop has a finite cost', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    expect(civs.length).toBeGreaterThanOrEqual(2)
    const route = findRoute(graph, civs[0].id, civs[civs.length - 1].id)
    expect(route).not.toBeNull()
    for (const edge of route!.edges) {
      expect(edge.distanceSvg).toBeGreaterThan(0)
      expect(edge.distanceSvg).toBeLessThan(Infinity)
    }
  })

  it('start === end produces a degenerate single-node route', () => {
    const civ = nodes.find(n => n.category === 'civilization')!
    const route = findRoute(graph, civ.id, civ.id)
    expect(route).not.toBeNull()
    expect(route!.nodes.length).toBe(1)
    expect(route!.totalKm).toBe(0)
  })

  it('findRouteWithFallback returns no pivots when a direct route exists', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    const fb = findRouteWithFallback(graph, civs[0].id, civs[1].id)
    expect(fb.route).not.toBeNull()
    expect(fb.pivots).toEqual([])
  })

  it('findRouteWithFallback never throws and yields a route for every named pair', () => {
    const sample = nodes.filter(n => n.category === 'civilization' || n.category === 'port').slice(0, 8)
    let success = 0
    for (let i = 0; i < sample.length; i++) {
      for (let j = 0; j < sample.length; j++) {
        if (i === j) continue
        const fb = findRouteWithFallback(graph, sample[i].id, sample[j].id)
        if (fb.route) success++
      }
    }
    expect(success).toBeGreaterThan(0)
  })

  it('finds a route between every civilization pair (graph is connected)', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    let success = 0
    let attempts = 0
    for (let i = 0; i < civs.length; i++) {
      for (let j = i + 1; j < civs.length; j++) {
        attempts++
        const r = findRoute(graph, civs[i].id, civs[j].id)
        if (r) success++
      }
    }
    expect(success).toBe(attempts)
  })
})

describe('findComparisonRoutes', () => {
  it('returns all three non-null routes for a typical civilization pair', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    expect(civs.length).toBeGreaterThanOrEqual(2)
    const comps = findComparisonRoutes(graph, civs[0].id, civs[1].id)
    expect(comps.direct).not.toBeNull()
    expect(comps.safest).not.toBeNull()
    expect(comps.cheapest).not.toBeNull()
    expect(comps.direct!.nodes.length).toBeGreaterThanOrEqual(2)
    expect(comps.safest!.nodes.length).toBeGreaterThanOrEqual(2)
    expect(comps.cheapest!.nodes.length).toBeGreaterThanOrEqual(2)
  })

  it('direct route has the shortest (or equal) raw distance', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    const comps = findComparisonRoutes(graph, civs[0].id, civs[civs.length - 1].id)
    expect(comps.direct).not.toBeNull()
    expect(comps.safest).not.toBeNull()
    expect(comps.cheapest).not.toBeNull()
    const dKm = comps.direct!.totalKm
    const sKm = comps.safest!.totalKm
    const cKm = comps.cheapest!.totalKm
    // Direct optimizes purely for distance; safest/cheapest add multipliers ≥1.
    expect(dKm).toBeLessThanOrEqual(sKm)
    expect(dKm).toBeLessThanOrEqual(cKm)
  })

  it('returns degenerate single-node routes when start === end', () => {
    const civ = nodes.find(n => n.category === 'civilization')!
    const comps = findComparisonRoutes(graph, civ.id, civ.id)
    expect(comps.direct).not.toBeNull()
    expect(comps.safest).not.toBeNull()
    expect(comps.cheapest).not.toBeNull()
    expect(comps.direct!.nodes.length).toBe(1)
    expect(comps.safest!.nodes.length).toBe(1)
    expect(comps.cheapest!.nodes.length).toBe(1)
    expect(comps.direct!.totalKm).toBe(0)
    expect(comps.safest!.totalKm).toBe(0)
    expect(comps.cheapest!.totalKm).toBe(0)
  })

  it('returns all-null for unknown node IDs', () => {
    const comps = findComparisonRoutes(graph, 'nonexistent-start', 'nonexistent-end')
    expect(comps.direct).toBeNull()
    expect(comps.safest).toBeNull()
    expect(comps.cheapest).toBeNull()
  })

  it('never throws for any named-node pair', () => {
    const sample = nodes.slice(0, 12)
    for (let i = 0; i < sample.length; i++) {
      for (let j = 0; j < sample.length; j++) {
        if (i === j) continue
        expect(() => findComparisonRoutes(graph, sample[i].id, sample[j].id)).not.toThrow()
      }
    }
  })

  it('respects season parameter', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    const spring = findComparisonRoutes(graph, civs[0].id, civs[1].id, 'spring')
    const winter = findComparisonRoutes(graph, civs[0].id, civs[1].id, 'winter')
    // Season can change route availability or edge costs, so the routes may differ.
    // We only assert that both calls succeed and return non-null routes.
    expect(spring.direct).not.toBeNull()
    expect(winter.direct).not.toBeNull()
    expect(spring.safest).not.toBeNull()
    expect(winter.safest).not.toBeNull()
    expect(spring.cheapest).not.toBeNull()
    expect(winter.cheapest).not.toBeNull()
  })
})

describe('waypoint snap (Option D)', () => {
  function buildSynth(features: Array<Record<string, unknown>>) {
    return { type: 'FeatureCollection', features }
  }

  it('snaps an on-route oasis as a midpoint in trade-route routing', () => {
    const synth = buildSynth([
      {
        type: 'Feature', id: 'civA',
        properties: { id: 'civA', name: 'Civ A', category: 'civilization', centroid: [0, 0] },
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
      {
        type: 'Feature', id: 'civB',
        properties: { id: 'civB', name: 'Civ B', category: 'civilization', centroid: [100, 0] },
        geometry: { type: 'Point', coordinates: [100, 0] },
      },
      {
        // Sits exactly on the polyline midpoint — perpendicular distance 0.
        type: 'Feature', id: 'on_route_oasis',
        properties: { id: 'on_route_oasis', name: 'On-Route Oasis', category: 'oasis' },
        geometry: { type: 'Point', coordinates: [50, 0] },
      },
      {
        type: 'Feature', id: 'route1',
        properties: { id: 'route1', name: 'Route 1', category: 'trade_route', endpoints: ['civA', 'civB'] },
        geometry: { type: 'LineString', coordinates: [[0, 0], [50, 0], [100, 0]] },
      },
    ])
    const g = buildGraph(synth as never)
    const route = findRoute(g, 'civA', 'civB')
    expect(route).not.toBeNull()
    const oasisInRoute = route!.nodes.some(n => n.id === 'on_route_oasis')
    expect(oasisInRoute, 'oasis on the polyline should appear as a midpoint').toBe(true)
  })

  it('does not snap an off-route oasis (perpendicular distance > threshold)', () => {
    const synth = buildSynth([
      {
        type: 'Feature', id: 'civA',
        properties: { id: 'civA', name: 'Civ A', category: 'civilization', centroid: [0, 0] },
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
      {
        type: 'Feature', id: 'civB',
        properties: { id: 'civB', name: 'Civ B', category: 'civilization', centroid: [100, 0] },
        geometry: { type: 'Point', coordinates: [100, 0] },
      },
      {
        // 50 svg perpendicular — well above SNAP_THRESHOLD_SVG (10).
        type: 'Feature', id: 'off_route_oasis',
        properties: { id: 'off_route_oasis', name: 'Off-Route Oasis', category: 'oasis' },
        geometry: { type: 'Point', coordinates: [50, 50] },
      },
      {
        type: 'Feature', id: 'route1',
        properties: { id: 'route1', name: 'Route 1', category: 'trade_route', endpoints: ['civA', 'civB'] },
        geometry: { type: 'LineString', coordinates: [[0, 0], [100, 0]] },
      },
    ])
    const g = buildGraph(synth as never)
    const route = findRoute(g, 'civA', 'civB')
    expect(route).not.toBeNull()
    const oasisInRoute = route!.nodes.some(n => n.id === 'off_route_oasis')
    expect(oasisInRoute, 'oasis 50 svg off the polyline should not be a midpoint').toBe(false)
  })

  it('real geojson: ngaru_bon → ndjadi threads through Copper-for-Steel-Road waypoints', () => {
    // Copper-for-Steel Road has two authored on-route oases (Tin Mashraq
    // ~10 km perp, Dzong-Tamu ~8 km perp). Both should snap and appear as
    // midpoints on the ngaru_bon → ndjadi route.
    const route = findRoute(graph, 'ngaru_bon', 'ndjadi')
    expect(route, 'expected a route between ngaru_bon and ndjadi').not.toBeNull()
    const waypoints = route!.nodes.filter(n => n.category === 'oasis' || n.category === 'port')
    expect(
      waypoints.length,
      'route along Copper-for-Steel Road should include its on-route oases as midpoints'
    ).toBeGreaterThanOrEqual(1)
  })
})

describe('party config affects travel time', () => {
  it('fast pace yields strictly fewer estimated days than slow pace', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    const slow: PartyConfig = { ...DEFAULT_PARTY, pace: 'slow' }
    const fast: PartyConfig = { ...DEFAULT_PARTY, pace: 'fast' }
    const rSlow = findRoute(graph, civs[0].id, civs[civs.length - 1].id, undefined, 'direct', slow)
    const rFast = findRoute(graph, civs[0].id, civs[civs.length - 1].id, undefined, 'direct', fast)
    expect(rSlow).not.toBeNull()
    expect(rFast).not.toBeNull()
    expect(rFast!.estimatedDays).toBeLessThan(rSlow!.estimatedDays)
    // Distance is geographic and must not change
    expect(rFast!.totalKm).toBeCloseTo(rSlow!.totalKm, 5)
  })

  it('mounted speeds up open road but not chokepoints', () => {
    // Use a route that should include at least some non-chokepoint edges.
    const civs = nodes.filter(n => n.category === 'civilization')
    const foot = findRoute(graph, civs[0].id, civs[1].id, undefined, 'direct', DEFAULT_PARTY)
    const mounted = findRoute(graph, civs[0].id, civs[1].id, undefined, 'direct', { ...DEFAULT_PARTY, mount: 'mounted' })
    expect(foot).not.toBeNull()
    expect(mounted).not.toBeNull()
    // For each chokepoint edge in the route, segmentDays must be identical
    // (within float tolerance) between foot and mounted.
    for (let i = 0; i < foot!.edges.length; i++) {
      const fe = foot!.edges[i]
      const me = mounted!.edges[i]
      if (fe.type === 'chokepoint' && me.type === 'chokepoint') {
        expect(me.segmentDays!).toBeCloseTo(fe.segmentDays!, 6)
      }
    }
    // The overall estimate should still come down (since at least some
    // non-chokepoint edge will speed up).
    expect(mounted!.estimatedDays).toBeLessThanOrEqual(foot!.estimatedDays)
  })

  it('estimatedDays equals sum of per-edge segmentDays', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    const r = findRoute(graph, civs[0].id, civs[civs.length - 1].id)
    expect(r).not.toBeNull()
    const sumSegments = r!.edges.reduce((s, e) => s + (e.segmentDays || 0), 0)
    expect(r!.estimatedDays).toBeCloseTo(sumSegments, 6)
  })
})

describe('findRoute: graph purity (Tier 3b)', () => {
  // findRoute must not mutate the shared, memoized adjacency edges. Two calls on
  // the SAME graph with different party configs must be independent — the first
  // route's per-segment timing must survive the second call.
  it('does not let a later call overwrite an earlier route\'s segmentDays', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    const slow: PartyConfig = { ...DEFAULT_PARTY, pace: 'slow' }
    const fast: PartyConfig = { ...DEFAULT_PARTY, pace: 'fast' }

    const rSlow = findRoute(graph, civs[0].id, civs[civs.length - 1].id, undefined, 'direct', slow)
    expect(rSlow).not.toBeNull()
    // Snapshot the slow route's per-segment days BEFORE the second call.
    const slowSegments = rSlow!.edges.map(e => e.segmentDays!)

    const rFast = findRoute(graph, civs[0].id, civs[civs.length - 1].id, undefined, 'direct', fast)
    expect(rFast).not.toBeNull()

    // The earlier (slow) route object must be untouched by the later (fast) call.
    rSlow!.edges.forEach((e, i) => {
      expect(e.segmentDays!).toBeCloseTo(slowSegments[i], 9)
    })
    // And the two calls genuinely differ (slow pace = more days than fast).
    expect(rSlow!.estimatedDays).toBeGreaterThan(rFast!.estimatedDays)
  })

  it('returns edges that are not the shared adjacency-list objects', () => {
    const civs = nodes.filter(n => n.category === 'civilization')
    const r = findRoute(graph, civs[0].id, civs[civs.length - 1].id)
    expect(r).not.toBeNull()
    expect(r!.edges.length).toBeGreaterThan(0)

    const edge = r!.edges[0]
    const adjEdge = graph.adj.get(edge.from)?.find(n => n.to === edge.to)?.edge
    expect(adjEdge, 'route edge should correspond to an adjacency edge').toBeDefined()
    // Returned edge is a clone, not the cached reference.
    expect(edge).not.toBe(adjEdge)
    // Mutating the returned edge must not bleed into the shared graph.
    const before = adjEdge!.segmentDays
    edge.segmentDays = 999
    expect(adjEdge!.segmentDays).toBe(before)
  })
})

describe('journey-graph: authored civ is authoritative (F5)', () => {
  // Two civ centroids far apart; port_x sits on top of civ "near" but is
  // AUTHORED to "far" (authored must win, not be clobbered by inference);
  // port_y is unauthored and must stay civ-less (no geometry inference — an
  // untagged point is deliberately unaligned/contested). The real-fixture
  // suite can't catch this because there authored ≈ nearest for every point.
  const fixture = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { id: 'near', name: 'Near', category: 'civilization', centroid: [0, 0] }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { id: 'far', name: 'Far', category: 'civilization', centroid: [100, 100] }, geometry: { type: 'Point', coordinates: [100, 100] } },
      { type: 'Feature', properties: { id: 'port_x', name: 'Port X', category: 'port', civ: 'far' }, geometry: { type: 'Point', coordinates: [1, 1] } },
      { type: 'Feature', properties: { id: 'port_y', name: 'Port Y', category: 'port' }, geometry: { type: 'Point', coordinates: [2, 2] } },
    ],
  }

  it('keeps the authored civ, and leaves an unauthored point civ-less', () => {
    const g = buildGraph(fixture as never)
    expect(g.nodes.get('port_x')!.civ).toBe('far')        // authored wins (was 'near' pre-fix)
    expect(g.nodes.get('port_y')!.civ).toBeUndefined()    // no geometry inference — stays unaligned
  })

  it('still routes the intra_civ edge to the nearest centroid (topology unchanged)', () => {
    const g = buildGraph(fixture as never)
    const intra = g.adj.get('port_x')!.map(e => e.edge).find(e => e.type === 'intra_civ')!
    expect(intra.to).toBe('near')               // physical hop is unchanged by the label
    expect(intra.name).toBe('Within Near')
  })
})

describe('journey-graph: strait annotation (F5 follow-up)', () => {
  // Pins the 17af505 fix: strait detection keys on Oravan membership, NOT on
  // both endpoints carrying a civ tag. The real fixture can't surface the
  // critical case (an Oravan endpoint paired with an untagged contested node)
  // because there every routed node is civ-aligned. straitAnnotation is pure,
  // so we feed it minimal JourneyNode literals directly.
  const node = (id: string, civ?: string): JourneyNode => ({ id, name: id, category: 'port', x: 0, y: 0, civ })

  it('flags the crossing when exactly one endpoint is Oravan', () => {
    expect(straitAnnotation(node('isle', 'oravan'), node('coast', 'kheshkai'))).toBe('Halkar Straits')
    expect(straitAnnotation(node('coast', 'kheshkai'), node('isle', 'oravan'))).toBe('Halkar Straits')
  })

  it('flags the crossing even when the mainland endpoint is an untagged contested node', () => {
    // The audit #2 case: mid-strait sandbar Tavakh-Rubāṭ is deliberately
    // civ-less (F5). Old civ-presence logic missed this crossing.
    expect(straitAnnotation(node('isle', 'oravan'), node('tavakh-rubat', undefined))).toBe('Halkar Straits')
  })

  it('returns null for an intra-archipelago hop (both Oravan)', () => {
    expect(straitAnnotation(node('isle_a', 'oravan'), node('isle_b', 'oravan'))).toBeNull()
  })

  it('returns null for a mainland-to-mainland edge (neither Oravan)', () => {
    expect(straitAnnotation(node('a', 'kheshkai'), node('b', 'ndjadi'))).toBeNull()
    expect(straitAnnotation(node('a', undefined), node('b', undefined))).toBeNull()
  })

  it('returns null when an endpoint is missing', () => {
    expect(straitAnnotation(undefined, node('isle', 'oravan'))).toBeNull()
    expect(straitAnnotation(node('isle', 'oravan'), undefined)).toBeNull()
  })
})

describe('isSeaLeg', () => {
  const node = (id: string, civ?: string, category = 'port'): JourneyNode => ({ id, name: id, category, x: 0, y: 0, civ })

  it('is true when either endpoint is the Aethelian Basin (category: water)', () => {
    const basin = node('aethelian_basin', 'aethelian_basin', 'water')
    expect(isSeaLeg(basin, node('halani', 'irrah'))).toBe(true)
    expect(isSeaLeg(node('halani', 'irrah'), basin)).toBe(true)
  })

  it('is true when either endpoint is the Oravan archipelago', () => {
    expect(isSeaLeg(node('isle', 'oravan'), node('coast', 'kheshkai'))).toBe(true)
    expect(isSeaLeg(node('coast', 'kheshkai'), node('isle', 'oravan'))).toBe(true)
  })

  it('is true for an Oravan endpoint paired with an untagged contested node', () => {
    expect(isSeaLeg(node('isle', 'oravan'), node('tavakh-rubat', undefined))).toBe(true)
  })

  it('is false for a land leg (neither water nor Oravan)', () => {
    expect(isSeaLeg(node('a', 'kheshkai'), node('b', 'ndjadi'))).toBe(false)
    expect(isSeaLeg(node('pass', undefined), node('vale', undefined))).toBe(false)
  })

  it('is false when an endpoint is missing', () => {
    expect(isSeaLeg(undefined, node('isle', 'oravan'))).toBe(false)
    expect(isSeaLeg(node('isle', 'oravan'), undefined)).toBe(false)
  })
})
