/**
 * journey-graph.integrity.test.ts — Phase 1 (A6.3) graph contract checks.
 *
 * Runs against the REGENERATED web/public/veydria-spatial.geojson and asserts:
 *  1. every port, oasis and waystation touches at least one trade-route edge;
 *  2. every pair of the six civilization nodes is routable in all four modes;
 *  3. named traversals exist along trade-route edges, visiting their nodes in
 *     order, with geometric length within 2% of the summed part geometry;
 *  4. no trade-route edge joins two civilization centroids directly, and no
 *     part has an edge to a node outside its own endpoints + snapped nodes;
 *  5. western_route stays display-only (no edges).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { buildGraph, findRoute, findRouteWithFallback, type Graph } from './journey-graph'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPATIAL_PATH = resolve(__dirname, '../../public/veydria-spatial.geojson')

interface Feature {
  type: string
  geometry: { type: string; coordinates: unknown }
  properties: Record<string, unknown> & { id?: string }
}
interface Collection { type: string; features: Feature[] }

let geojson: Collection
let graph: Graph

beforeAll(() => {
  geojson = JSON.parse(readFileSync(SPATIAL_PATH, 'utf-8'))
  graph = buildGraph(geojson as never)
})

// ── Helpers ────────────────────────────────────────────────────────────────

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Arc-length position of a point projected onto a polyline (0 at first vertex). */
function projectArc(p: { x: number; y: number }, coords: number[][]): { tArc: number; perpDist: number } {
  let bestTArc = 0
  let bestPerp = Infinity
  let cum = 0
  for (let i = 1; i < coords.length; i++) {
    const [ax, ay] = coords[i - 1]
    const [bx, by] = coords[i]
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2))
    const perp = Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy))
    if (perp < bestPerp) {
      bestPerp = perp
      bestTArc = cum + t * Math.sqrt(l2)
    }
    cum += Math.sqrt(l2)
  }
  return { tArc: bestTArc, perpDist: bestPerp }
}

function polylineLength(coords: number[][]): number {
  let len = 0
  for (let i = 1; i < coords.length; i++) len += dist({ x: coords[i - 1][0], y: coords[i - 1][1] }, { x: coords[i][0], y: coords[i][1] })
  return len
}

function featureById(id: string): Feature {
  const f = geojson.features.find(f => f.properties.id === id || (f as unknown as { id?: string }).id === id)
  expect(f, `feature ${id} exists in geojson`).toBeDefined()
  return f!
}

function coordsOf(id: string): number[][] {
  const f = featureById(id)
  expect(f.geometry.type).toBe('LineString')
  return f.geometry.coordinates as number[][]
}

/** Arc of `partId`'s polyline between the projections of two nodes. */
function partArc(partId: string, aId: string, bId: string): number {
  const coords = coordsOf(partId)
  const a = graph.nodes.get(aId)!
  const b = graph.nodes.get(bId)!
  return Math.abs(projectArc(a, coords).tArc - projectArc(b, coords).tArc)
}

function fullPartLength(partId: string): number {
  return polylineLength(coordsOf(partId))
}

/**
 * The graph edges attributed to a part (via `routePart`) must connect its
 * two endpoint nodes through its snapped nodes, and their summed length
 * must match the part's drawn geometry. Returns path length + node ids.
 */
function partChainLength(partId: string): number {
  const f = featureById(partId)
  const endpoints = ((f.properties.endpoints as string[]) ?? []).map(e => (e === 'basin' ? 'aethelian_basin' : e))
  expect(endpoints.length).toBe(2)
  const [start, goal] = endpoints

  const adj = new Map<string, Array<{ to: string; len: number }>>()
  for (const [id, list] of graph.adj) {
    for (const { to, edge } of list) {
      // Civ-attachment beelines are attributed to the part but do not
      // follow its geometry — the chain must be built from arc edges only.
      if (edge.type !== 'trade_route' || edge.routePart !== partId || edge.civAttach) continue
      const arr = adj.get(id) ?? []
      arr.push({ to, len: edge.distanceSvg })
      adj.set(id, arr)
    }
  }
  // Dijkstra (shortest path over the part's own edges)
  const distMap = new Map<string, number>([[start, 0]])
  const prev = new Map<string, string>()
  const pq: Array<[string, number]> = [[start, 0]]
  while (pq.length) {
    pq.sort((a, b) => a[1] - b[1])
    const [u, d] = pq.shift()!
    if (d > (distMap.get(u) ?? Infinity)) continue
    if (u === goal) {
      const path = [goal]
      while (path[0] !== start) path.unshift(prev.get(path[0])!)
      return { length: d, path }
    }
    for (const { to, len } of adj.get(u) ?? []) {
      const nd = d + len
      if (nd < (distMap.get(to) ?? Infinity)) {
        distMap.set(to, nd)
        prev.set(to, u)
        pq.push([to, nd])
      }
    }
  }
  throw new Error(`no trade-route path across ${partId} between its endpoints`)
}

/**
 * Route between two nodes in `direct` mode and assert every hop is a
 * trade-route edge. Returns summed geometric (svg-unit) length.
 */
function tradeLeg(fromId: string, toId: string): number {
  const route = findRoute(graph, fromId, toId, undefined, 'direct')
  expect(route, `trade leg ${fromId} → ${toId} exists`).not.toBeNull()
  for (const e of route!.edges) {
    expect(e.type, `leg ${fromId} → ${toId} hop ${e.from}→${e.to} is a trade-route edge`).toBe('trade_route')
  }
  return route!.totalDistanceSvg
}

function expectCloseTo(actual: number, expected: number, label: string) {
  const tol = Math.max(0.02 * expected, 0.5) // 2% or half a svg unit
  expect(Math.abs(actual - expected), `${label}: ${actual.toFixed(2)} vs ${expected.toFixed(2)}`).toBeLessThanOrEqual(tol)
}

// ── 1. Connectivity of point features ─────────────────────────────────────

describe('graph integrity: point features connect to trade routes', () => {
  it('every port, oasis and waystation has at least one trade-route edge', () => {
    const unconnected: string[] = []
    for (const node of graph.nodes.values()) {
      if (!['port', 'oasis', 'caravanserai'].includes(node.category)) continue
      const edges = (graph.adj.get(node.id) ?? []).map(e => e.edge)
      if (!edges.some(e => e.type === 'trade_route')) unconnected.push(node.id)
    }
    // Sanctioned exception — kelata_tamu: an islet across a tidal channel off
    // the outer (west) shore of Kelata's island, placed with `review: true`
    // (worldbuilder geography/locations/kelata-tamu.yaml). Canon deliberately
    // keeps it off every drawn trade route (nearest is western_route, 68.8
    // svg units away — display-only by ADR-0045, and no route may be bent to
    // reach it). This contradicts the spec rule as written for this one
    // feature; see the phase report. Any OTHER unconnected feature fails.
    expect(unconnected).toEqual(['kelata_tamu'])
  })
})

// ── 2. Civilization pair connectivity ─────────────────────────────────────

describe('graph integrity: civilization pairs routable in all four modes', () => {
  const civs = ['ngaru_bon', 'irrah', 'kheshkai', 'ndjadi', 'qollari', 'oravan']
  for (let i = 0; i < civs.length; i++) {
    for (let j = i + 1; j < civs.length; j++) {
      for (const mode of ['direct', 'fastest', 'safest', 'cheapest'] as const) {
        it(`${civs[i]} → ${civs[j]} (${mode})`, () => {
          const { route } = findRouteWithFallback(graph, civs[i], civs[j], undefined, mode)
          expect(route, `${civs[i]} → ${civs[j]} routable in ${mode} mode`).not.toBeNull()
        })
      }
    }
  }
})

// ── 3. Named traversals ───────────────────────────────────────────────────

describe('graph integrity: named traversals along part geometry', () => {
  it('Halani-Tamu → Qarat al-Fidda → Ghadam-Thalla on the Caravan Thread', () => {
    const leg1 = tradeLeg('halani_tamu', 'qarat_al_fidda')
    expectCloseTo(leg1, fullPartLength('caravan_thread__p4'), 'halani_tamu→qarat_al_fidda = p4')
    const leg2 = tradeLeg('qarat_al_fidda', 'ghadam_thalla')
    expectCloseTo(leg2, fullPartLength('caravan_thread__p3'), 'qarat_al_fidda→ghadam_thalla = p3')
  })

  it('Qarat al-Fidda → Zin-Iferis → Smith-Spring on the Caravan Thread', () => {
    const leg1 = tradeLeg('qarat_al_fidda', 'zin_iferis')
    expectCloseTo(leg1, fullPartLength('caravan_thread__p2'), 'qarat_al_fidda→zin_iferis = p2')
    const leg2 = tradeLeg('zin_iferis', 'smith_spring')
    expectCloseTo(leg2, partArc('caravan_thread', 'zin_iferis', 'smith_spring'), 'zin_iferis→smith_spring on p1')
  })

  it('Tin Mashraq → Qarat al-Fidda → Halani-Tamu on the Caravan Thread', () => {
    const leg1 = tradeLeg('tin_mashraq', 'qarat_al_fidda')
    expectCloseTo(leg1, fullPartLength('caravan_thread__p5'), 'tin_mashraq→qarat_al_fidda = p5')
    const leg2 = tradeLeg('qarat_al_fidda', 'halani_tamu')
    expectCloseTo(leg2, fullPartLength('caravan_thread__p4'), 'qarat_al_fidda→halani_tamu = p4')
  })

  it('Khulut → Rubat al-Darb → Tin-Aghiz along the frankincense crossing', () => {
    // The whole p6 chain (khulut → snapped waystations → tin_aghiz) is the
    // crossing; its summed edge lengths must equal the drawn part geometry,
    // and the named waystation must sit on that chain between them.
    const chain = partChainLength('caravan_thread__p6')
    expectCloseTo(chain.length, fullPartLength('caravan_thread__p6'), 'p6 chain')
    expect(chain.path, 'p6 chain visits the frankincense waystation').toContain('rubat_al_darb')
    expect(chain.path.indexOf('rubat_al_darb')).toBeGreaterThan(chain.path.indexOf('khulut'))
    expect(chain.path.indexOf('rubat_al_darb')).toBeLessThan(chain.path.indexOf('tin_aghiz'))
  })

  it('Tavakh-Qarat → Halani-Tamu → Dzong-Tamu → Ki-Mbuhari around the Basin ring', () => {
    const legs: Array<[string, string]> = [
      ['tavakh_qarat', 'halani_tamu'],
      ['halani_tamu', 'dzong_tamu'],
      ['dzong_tamu', 'ki_mbuhari'],
    ]
    for (const [a, b] of legs) {
      const leg = tradeLeg(a, b)
      expectCloseTo(leg, partArc('aethelian_basin_hub', a, b), `${a}→${b} on the ring`)
    }
  })

  it('Ki-Mbuhari → the-neck spur exists', () => {
    expect(graph.nodes.has('the_neck'), 'the_neck is a graph node').toBe(true)
    const leg = tradeLeg('ki_mbuhari', 'the_neck')
    expectCloseTo(leg, fullPartLength('aethelian_basin_hub__p2'), 'ki_mbuhari→the_neck = spur')
  })

  it('Highland Relay main leg through Wasi-Pukya, and branch toward Veyd-Kirrha', () => {
    const main = partChainLength('highland_relay')
    expectCloseTo(main.length, fullPartLength('highland_relay'), 'relay main chain (qollari → ki_mbuhari)')
    const branch = partChainLength('highland_relay__p2')
    expectCloseTo(branch.length, fullPartLength('highland_relay__p2'), 'relay branch chain (ki_mbuhari → veyd_kirrha)')
    // The main leg threads through Wasi-Pukya.
    const relayOn = ['qollari', 'wasi_pukya', 'ki_mbuhari']
    for (const id of relayOn) {
      expect(graph.nodes.has(id), `${id} on the relay`).toBe(true)
    }
  })

  it('Kalli-Xal → Tepet-Apu on the corridor passes Breath-of-Cloud', () => {
    const leg = tradeLeg('kalli_xal', 'tepet_apu')
    expectCloseTo(leg, partArc('highland_steppe_corridor', 'kalli_xal', 'tepet_apu'), 'kalli_xal→tepet_apu on the corridor')
    // Breath-of-Cloud (the pass) lies on the corridor between them: its
    // projection falls inside the arc and sits on the drawn road.
    const corridor = coordsOf('highland_steppe_corridor')
    const boc = graph.nodes.get('breath_of_cloud')!
    const tBoc = projectArc(boc, corridor)
    const tA = projectArc(graph.nodes.get('kalli_xal')!, corridor).tArc
    const tB = projectArc(graph.nodes.get('tepet_apu')!, corridor).tArc
    expect(tBoc.perpDist, 'Breath-of-Cloud lies on the drawn corridor').toBeLessThanOrEqual(10)
    const lo = Math.min(tA, tB), hi = Math.max(tA, tB)
    expect(tBoc.tArc, 'Breath-of-Cloud sits between Kalli-Xal and Tepet-Apu on the corridor').toBeGreaterThan(lo)
    expect(tBoc.tArc).toBeLessThan(hi)
  })
})

// ── 4. Edge hygiene ───────────────────────────────────────────────────────

describe('graph integrity: edge hygiene', () => {
  it('no trade-route edge joins two civilization centroids directly', () => {
    for (const [id, list] of graph.adj) {
      for (const { to, edge } of list) {
        if (edge.type !== 'trade_route' || edge.from !== id) continue // check each undirected edge once
        const a = graph.nodes.get(id)!
        const b = graph.nodes.get(to)!
        expect(
          a.category === 'civilization' && b.category === 'civilization',
          `civ-civ trade edge ${id} → ${to} (${edge.name})`,
        ).toBe(false)
      }
    }
  })

  it('no part has an edge to a node outside its endpoints and snapped nodes', () => {
    const SNAP = 10 // SNAP_THRESHOLD_SVG in journey-graph.ts
    const parts = geojson.features.filter(f => f.properties.category === 'trade_route' && typeof f.properties.route_id === 'string')
    expect(parts.length).toBeGreaterThan(0)

    for (const f of parts) {
      const coords = f.geometry.coordinates as number[][]
      const partId = f.properties.id as string
      const set = new Set<string>(((f.properties.endpoints as string[]) ?? []).map(e => (e === 'basin' ? 'aethelian_basin' : e)))
      for (const n of graph.nodes.values()) {
        if (set.has(n.id)) continue
        if (projectArc(n, coords).perpDist <= SNAP) set.add(n.id)
      }
      // Every trade-route edge the builder attributes to this part (via
      // `routePart`) must touch only nodes that are the part's endpoints or
      // snapped onto it. Sanctioned exception: the civ-attachment beelines
      // (parent `route_endpoints` civ → the part endpoint feature belonging
      // to that civ) legitimately leave the set at the civ end.
      for (const [id, list] of graph.adj) {
        for (const { to, edge } of list) {
          if (edge.type !== 'trade_route' || edge.routePart !== partId || edge.from !== id) continue
          if (graph.nodes.get(id)?.category === 'civilization' || graph.nodes.get(to)?.category === 'civilization') continue
          expect(set.has(id), `part ${partId}: edge ${id}→${to} touches a node not on the part`).toBe(true)
          expect(set.has(to), `part ${partId}: edge ${id}→${to} touches a node not on the part`).toBe(true)
        }
      }
    }
  })
})

// ── 5. Western Route stays display-only ───────────────────────────────────

describe('graph integrity: western_route display-only', () => {
  it('produces no edges', () => {
    for (const [, list] of graph.adj) {
      for (const { edge } of list) {
        expect(edge.name).not.toBe('Western Route')
      }
    }
  })
})
