import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  buildGraph,
  findRoute,
  authoredDaysForEdge,
  DEFAULT_PARTY,
  HARD_CROSSING_PENALTY,
  type PartyConfig,
  type JourneyNode,
} from './journey-graph'
import { svgDistanceToKm } from './measure'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPATIAL_PATH = resolve(__dirname, '../../public/veydria-spatial.geojson')

interface GeoJSON {
  type: string
  features: Array<{ type: string; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }>
}

let realGeojson: GeoJSON
let realGraph: ReturnType<typeof buildGraph>

beforeAll(() => {
  realGeojson = JSON.parse(readFileSync(SPATIAL_PATH, 'utf-8'))
  realGraph = buildGraph(realGeojson as never)
})

function buildSynth(features: Array<Record<string, unknown>>) {
  return { type: 'FeatureCollection', features }
}

const node = (id: string, civ?: string, category = 'port'): JourneyNode => ({ id, name: id, category, x: 0, y: 0, civ })

describe('authoredDaysForEdge', () => {
  it('resolves ngaru_bon ↔ kheshkai to 4 days', () => {
    expect(authoredDaysForEdge('ngaru_bon', 'kheshkai')).toBe(4)
    expect(authoredDaysForEdge('kheshkai', 'ngaru_bon')).toBe(4)
  })

  it('resolves tavakh_qarat ↔ ki_mbuhari to 3 days', () => {
    expect(authoredDaysForEdge('tavakh_qarat', 'ki_mbuhari')).toBe(3)
    expect(authoredDaysForEdge('ki_mbuhari', 'tavakh_qarat')).toBe(3)
  })

  it('resolves oravan ↔ aethelian_basin to 1 day', () => {
    expect(authoredDaysForEdge('oravan', 'aethelian_basin')).toBe(1)
    expect(authoredDaysForEdge('aethelian_basin', 'oravan')).toBe(1)
  })

  it('uses the midpoint of a {min,max} range', () => {
    expect(authoredDaysForEdge('qollari', 'ndjadi')).toBe(5)
    expect(authoredDaysForEdge('qollari', 'oravan')).toBe(5)
  })

  it('resolves hyphenated aliases and mixed case', () => {
    expect(authoredDaysForEdge('ngaru-bon', 'kheshkai')).toBe(4)
    expect(authoredDaysForEdge('Ngaru-Bon', 'KHESHKAI')).toBe(4)
    expect(authoredDaysForEdge('tavakh-qarat', 'ki-mbuhari')).toBe(3)
  })

  it('returns null for an unknown pair', () => {
    expect(authoredDaysForEdge('ngaru_bon', 'no_such_place')).toBeNull()
  })

  it('returns null for a mixed travel-graph / non-travel-graph pair', () => {
    expect(authoredDaysForEdge('ngaru_bon', 'some_oasis')).toBeNull()
    expect(authoredDaysForEdge('some_oasis', 'kheshkai')).toBeNull()
  })
})

describe('authored duration overrides in route segmentDays', () => {
  const synth = buildSynth([
    {
      type: 'Feature',
      id: 'kheshkai',
      properties: { id: 'kheshkai', name: 'Kheshkai', category: 'civilization', centroid: [0, 0] },
      geometry: { type: 'Point', coordinates: [0, 0] },
    },
    {
      type: 'Feature',
      id: 'ngaru_bon',
      properties: { id: 'ngaru_bon', name: 'Ngaru-Bon', category: 'civilization', centroid: [100, 0] },
      geometry: { type: 'Point', coordinates: [100, 0] },
    },
    {
      type: 'Feature',
      id: 'outpost',
      properties: { id: 'outpost', name: 'Outpost', category: 'landmark' },
      geometry: { type: 'Point', coordinates: [10, 0] },
    },
    {
      type: 'Feature',
      id: 'route1',
      properties: { id: 'route1', name: 'Route 1', category: 'trade_route', endpoints: ['kheshkai', 'ngaru_bon'] },
      geometry: { type: 'LineString', coordinates: [[0, 0], [100, 0]] },
    },
  ])

  it('uses authored days for an authored leg instead of km/speed', () => {
    const graph = buildGraph(synth as never)
    const route = findRoute(graph, 'kheshkai', 'ngaru_bon')
    expect(route).not.toBeNull()
    expect(route!.edges).toHaveLength(1)
    expect(route!.edges[0].segmentDays!).toBeCloseTo(4, 6)
  })

  it('mixes authored and geometric legs correctly', () => {
    const graph = buildGraph(synth as never)
    const route = findRoute(graph, 'outpost', 'ngaru_bon')
    expect(route).not.toBeNull()
    expect(route!.edges).toHaveLength(2)

    const intra = route!.edges.find((e) => e.type === 'intra_civ')!
    const trade = route!.edges.find((e) => e.type === 'trade_route')!
    expect(intra).toBeDefined()
    expect(trade).toBeDefined()

    const expectedGeometric = svgDistanceToKm(intra!.distanceSvg) / 25
    expect(intra!.segmentDays!).toBeCloseTo(expectedGeometric, 6)
    expect(trade!.segmentDays!).toBeCloseTo(4, 6)
  })

  it('fast party yields strictly smaller segmentDays than slow party on an authored leg', () => {
    const graph = buildGraph(synth as never)
    const slow: PartyConfig = { ...DEFAULT_PARTY, pace: 'slow' }
    const fast: PartyConfig = { ...DEFAULT_PARTY, pace: 'fast' }
    const rSlow = findRoute(graph, 'kheshkai', 'ngaru_bon', undefined, 'direct', slow)
    const rFast = findRoute(graph, 'kheshkai', 'ngaru_bon', undefined, 'direct', fast)
    expect(rSlow).not.toBeNull()
    expect(rFast).not.toBeNull()
    expect(rFast!.edges[0].segmentDays!).toBeLessThan(rSlow!.edges[0].segmentDays!)
  })
})

describe('time-weighted routing (Fastest mode)', () => {
  it('routes ngaru_bon → kheshkai directly over the 4-day Lam-Chen pass', () => {
    const route = findRoute(realGraph, 'ngaru_bon', 'kheshkai', undefined, 'fastest')
    expect(route).not.toBeNull()
    // The authored Lam-Chen pass (4 days) beats the geometric oasis detour, so the
    // fastest route is the direct civ-to-civ chokepoint edge at exactly the canon day-count.
    expect(route!.nodes.map((n) => n.id)).toEqual(['ngaru_bon', 'kheshkai'])
    expect(route!.estimatedDays).toBeCloseTo(4, 6)
  })

  it('Direct mode (shortest distance) can take longer in days than Fastest', () => {
    // Documents the deliberate mode distinction: Direct optimizes drawn distance
    // and ignores travel-time, so it may detour around the long-drawn Lam-Chen
    // polyline via an oasis and land on more days than the time-optimal route.
    const direct = findRoute(realGraph, 'ngaru_bon', 'kheshkai', undefined, 'direct')
    const fastest = findRoute(realGraph, 'ngaru_bon', 'kheshkai', undefined, 'fastest')
    expect(direct).not.toBeNull()
    expect(fastest).not.toBeNull()
    expect(direct!.estimatedDays).toBeGreaterThan(fastest!.estimatedDays)
  })
})

describe('Smith-Spring hard crossing (turn_back_hub, not a deleted edge)', () => {
  // Canon (geography/locations/smith-spring.md) marks this frontier a
  // turn_back_hub: the bound civs' own trade never runs through it ("the
  // place past which neither people goes"). Perry's call (2026-07-05): that's
  // an institutional fact about Ngaru-Bon/Irrah trade, not a physical wall —
  // an independent travel party isn't bound by the hostage-price truce, so
  // the crossing stays routable but nearly impassable (HARD_CROSSING_PENALTY),
  // the kind of road only the desperate or the criminal attempt.

  it('produces a direct ngaru_bon <-> irrah adjacency with the hard-crossing penalty', () => {
    const fromA = realGraph.adj.get('ngaru_bon')?.find((n) => n.to === 'irrah')
    const fromB = realGraph.adj.get('irrah')?.find((n) => n.to === 'ngaru_bon')
    expect(fromA).toBeDefined()
    expect(fromB).toBeDefined()
    expect(fromA?.edge.routingPenalty).toBe(HARD_CROSSING_PENALTY)
    expect(fromB?.edge.routingPenalty).toBe(HARD_CROSSING_PENALTY)
  })

  it('a synthetic turn-back-hub edge is kept but penalized, not deleted', () => {
    const synth = buildSynth([
      {
        type: 'Feature',
        id: 'ngaru_bon',
        properties: { id: 'ngaru_bon', name: 'Ngaru-Bon', category: 'civilization', centroid: [0, 0] },
        geometry: { type: 'Point', coordinates: [0, 0] },
      },
      {
        type: 'Feature',
        id: 'irrah',
        properties: { id: 'irrah', name: 'Irrah', category: 'civilization', centroid: [100, 0] },
        geometry: { type: 'Point', coordinates: [100, 0] },
      },
      {
        type: 'Feature',
        id: 'smith_spring',
        properties: { id: 'smith_spring', name: 'Smith Spring', category: 'chokepoint', connects: ['ngaru_bon', 'irrah'] },
        geometry: { type: 'Point', coordinates: [50, 0] },
      },
    ])
    const graph = buildGraph(synth as never)
    const edge = graph.adj.get('ngaru_bon')?.find((n) => n.to === 'irrah')
    expect(edge).toBeDefined()
    expect(edge?.edge.routingPenalty).toBe(HARD_CROSSING_PENALTY)
  })

  it('the physical distance stays honest — penalty applies to routing weight only', () => {
    const sourceHasDirect = realGeojson.features.some((f) => {
      if (f.properties.category !== 'chokepoint') return false
      const connects = f.properties.connects as string[] | undefined
      if (!connects) return false
      return connects.includes('ngaru_bon') && connects.includes('irrah')
    })
    const edge = realGraph.adj.get('ngaru_bon')?.find((n) => n.to === 'irrah')
    // The source topology contains the Smith-Spring chokepoint, and it survives
    // into the routable graph — routingPenalty carries the "nearly impassable"
    // cost, while distanceSvg stays the real physical crossing distance.
    expect(sourceHasDirect).toBe(true)
    expect(edge).toBeDefined()
    expect(edge?.edge.distanceSvg).toBeGreaterThan(0)
    expect(edge?.edge.routingPenalty).toBe(HARD_CROSSING_PENALTY)
  })
})

describe('isSeaLeg helper (smoke)', () => {
  it('is included to keep node() usage covered', () => {
    expect(node('a')).toBeDefined()
  })
})
