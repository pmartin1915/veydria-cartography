import { describe, it, expect } from 'vitest'
import {
  buildFactionGraph,
  classifyEdge,
  type FactionEdge,
  type ParsedTopology,
} from './faction-graph'
import type { GeoJSONCollection, GeoJSONFeature } from '../App'

// ── Tiny fixture builders ───────────────────────────────────────────────────

function civ(id: string, name = id): GeoJSONFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { id, name, type: 'civilization' },
  }
}

function tradeRoute(
  id: string,
  endpoints: string[],
  name = id
): GeoJSONFeature {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [] },
    properties: { id, name, type: 'trade_route', endpoints },
  }
}

function chokepoint(
  id: string,
  borders: string[],
  name = id
): GeoJSONFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { id, name, type: 'chokepoint', borders },
  }
}

function fc(features: GeoJSONFeature[]): GeoJSONCollection {
  return { type: 'FeatureCollection', features }
}

const findEdge = (
  edges: FactionEdge[],
  type: FactionEdge['type'],
  a: string,
  b: string
): FactionEdge | undefined =>
  edges.find(
    (e) =>
      e.type === type &&
      ((e.source === a && e.target === b) ||
        (e.source === b && e.target === a))
  )

// ── Tests ───────────────────────────────────────────────────────────────────

describe('classifyEdge', () => {
  it('maps known relationship strings onto the union', () => {
    expect(classifyEdge('trade')).toBe('trade')
    expect(classifyEdge('trade_route')).toBe('trade')
    expect(classifyEdge('allied')).toBe('allied')
    expect(classifyEdge('alliance')).toBe('allied')
    expect(classifyEdge('vassal')).toBe('vassal')
    expect(classifyEdge('tributary')).toBe('vassal')
    expect(classifyEdge('shared_chokepoint')).toBe('shared_chokepoint')
    expect(classifyEdge('chokepoint')).toBe('shared_chokepoint')
  })

  it('falls back to hostile for unknown / hostile-flavoured strings', () => {
    expect(classifyEdge('hostile')).toBe('hostile')
    expect(classifyEdge('war')).toBe('hostile')
    expect(classifyEdge('rival')).toBe('hostile')
    expect(classifyEdge('')).toBe('hostile')
  })
})

describe('buildFactionGraph — nodes', () => {
  it('extracts a node per civilization feature with id+name', () => {
    const g = buildFactionGraph(fc([civ('alpha', 'Alpha'), civ('beta', 'Beta')]))
    expect(g.nodes).toHaveLength(2)
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['alpha', 'beta'])
    expect(g.nodes.find((n) => n.id === 'alpha')?.name).toBe('Alpha')
    expect(g.edges).toEqual([])
  })

  it('returns nodes-only with no edges when topology is undefined', () => {
    const g = buildFactionGraph(fc([civ('alpha'), civ('beta')]), undefined)
    expect(g.nodes).toHaveLength(2)
    expect(g.edges).toEqual([])
  })

  it('survives a malformed topology shape (degrades to nodes-only)', () => {
    // relationships set to a junk value — must not throw and must not yield edges.
    const topology = { relationships: 42 } as unknown as ParsedTopology
    const g = buildFactionGraph(fc([civ('alpha'), civ('beta')]), topology)
    expect(g.nodes).toHaveLength(2)
    expect(g.edges).toEqual([])
  })

  it('layers in topology metadata (cardinal, biome, elevation) when present', () => {
    const topology: ParsedTopology = {
      civilization_positions: {
        alpha: {
          cardinal: 'North',
          terrain: 'highland steppe',
          elevation: '1500-2500m',
        },
      },
    }
    const g = buildFactionGraph(fc([civ('alpha')]), topology)
    expect(g.nodes[0]).toMatchObject({
      id: 'alpha',
      cardinal: 'North',
      biome: 'highland steppe',
      elevation: '1500-2500m',
    })
  })
})

describe('buildFactionGraph — trade edges from geojson', () => {
  it('emits exactly one trade edge for a trade_route linking two civs', () => {
    const g = buildFactionGraph(
      fc([civ('alpha'), civ('beta'), tradeRoute('road1', ['alpha', 'beta'], 'Spice Road')])
    )
    const trades = g.edges.filter((e) => e.type === 'trade')
    expect(trades).toHaveLength(1)
    const edge = trades[0]
    expect([edge.source, edge.target].sort()).toEqual(['alpha', 'beta'])
    expect(edge.label).toBe('Spice Road')
  })

  it('ignores trade_route endpoints that aren\'t known civs', () => {
    const g = buildFactionGraph(
      fc([civ('alpha'), tradeRoute('road1', ['alpha', 'unknown_port'])])
    )
    expect(g.edges.filter((e) => e.type === 'trade')).toHaveLength(0)
  })

  it('dedupes two trade_routes between the same civ pair into one edge', () => {
    const g = buildFactionGraph(
      fc([
        civ('alpha'),
        civ('beta'),
        tradeRoute('road1', ['alpha', 'beta']),
        tradeRoute('road2', ['beta', 'alpha']),
      ])
    )
    expect(g.edges.filter((e) => e.type === 'trade')).toHaveLength(1)
  })
})

describe('buildFactionGraph — topology relationships', () => {
  it('emits a hostile edge from a topology declaration', () => {
    const topology: ParsedTopology = {
      relationships: [{ from: 'alpha', to: 'beta', type: 'hostile' }],
    }
    const g = buildFactionGraph(fc([civ('alpha'), civ('beta')]), topology)
    expect(findEdge(g.edges, 'hostile', 'alpha', 'beta')).toBeTruthy()
  })

  it('collapses reciprocal hostile declarations into one undirected edge', () => {
    const topology: ParsedTopology = {
      relationships: [
        { from: 'alpha', to: 'beta', type: 'hostile' },
        { from: 'beta', to: 'alpha', type: 'hostile' },
      ],
    }
    const g = buildFactionGraph(fc([civ('alpha'), civ('beta')]), topology)
    expect(g.edges.filter((e) => e.type === 'hostile')).toHaveLength(1)
  })

  it('keeps both edges when a pair has BOTH a trade and a hostile edge', () => {
    const topology: ParsedTopology = {
      relationships: [{ from: 'alpha', to: 'beta', type: 'hostile' }],
    }
    const g = buildFactionGraph(
      fc([
        civ('alpha'),
        civ('beta'),
        tradeRoute('road1', ['alpha', 'beta']),
      ]),
      topology
    )
    expect(findEdge(g.edges, 'trade', 'alpha', 'beta')).toBeTruthy()
    expect(findEdge(g.edges, 'hostile', 'alpha', 'beta')).toBeTruthy()
  })

  it('preserves vassal directionality (does NOT collapse reversed pairs)', () => {
    const topology: ParsedTopology = {
      relationships: [
        { from: 'alpha', to: 'beta', type: 'vassal' },
        { from: 'beta', to: 'alpha', type: 'vassal' },
      ],
    }
    const g = buildFactionGraph(fc([civ('alpha'), civ('beta')]), topology)
    const vassals = g.edges.filter((e) => e.type === 'vassal')
    expect(vassals).toHaveLength(2)
  })

  it('reads the keyed-by-civ relationship shape', () => {
    const topology: ParsedTopology = {
      relationships: {
        alpha: { hostile: ['beta'], allied: ['gamma'] },
      },
    }
    const g = buildFactionGraph(
      fc([civ('alpha'), civ('beta'), civ('gamma')]),
      topology
    )
    expect(findEdge(g.edges, 'hostile', 'alpha', 'beta')).toBeTruthy()
    expect(findEdge(g.edges, 'allied', 'alpha', 'gamma')).toBeTruthy()
  })
})

describe('buildFactionGraph — chokepoint edges', () => {
  it('emits one shared_chokepoint edge per pair of civs bordering the chokepoint', () => {
    const g = buildFactionGraph(
      fc([
        civ('alpha'),
        civ('beta'),
        chokepoint('pass1', ['alpha', 'beta'], 'Cloud Pass'),
      ])
    )
    const ck = g.edges.filter((e) => e.type === 'shared_chokepoint')
    expect(ck).toHaveLength(1)
    expect([ck[0].source, ck[0].target].sort()).toEqual(['alpha', 'beta'])
    expect(ck[0].label).toBe('Cloud Pass')
  })

  it('expands a 3-civ chokepoint to all unique pairs', () => {
    const g = buildFactionGraph(
      fc([
        civ('alpha'),
        civ('beta'),
        civ('gamma'),
        chokepoint('hub', ['alpha', 'beta', 'gamma']),
      ])
    )
    expect(g.edges.filter((e) => e.type === 'shared_chokepoint')).toHaveLength(3)
  })

  it('does not emit shared_chokepoint edges to non-civilization borders', () => {
    const g = buildFactionGraph(
      fc([
        civ('alpha'),
        civ('beta'),
        chokepoint('strait', ['alpha', 'open_ocean']),
        chokepoint('pass', ['alpha', 'beta']),
      ])
    )
    // Only the alpha/beta one survives — open_ocean is not a known civ.
    expect(g.edges.filter((e) => e.type === 'shared_chokepoint')).toHaveLength(1)
  })
})
