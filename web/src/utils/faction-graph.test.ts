import { describe, it, expect } from 'vitest'
import {
  buildFactionGraph,
  normalizeCivId,
  type CanonCrossCivEntity,
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

function fc(features: GeoJSONFeature[]): GeoJSONCollection {
  return { type: 'FeatureCollection', features }
}

function crossCiv(
  a: string,
  b: string,
  density: number,
  extra: Partial<CanonCrossCivEntity> = {}
): CanonCrossCivEntity {
  return {
    id: `factions.cross_civ.${a}_${b}`,
    entity_type: 'cross_civ_relationship_matrix',
    civ_pair: [a, b],
    density,
    name: `${a} ↔ ${b}`,
    lede: `The ${a}–${b} relationship.`,
    ...extra,
  }
}

const findEdge = (
  edges: ReturnType<typeof buildFactionGraph>['edges'],
  a: string,
  b: string
) => edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a))

// ── Tests ───────────────────────────────────────────────────────────────────

describe('normalizeCivId', () => {
  it('maps canon hyphen slugs to geojson underscore ids', () => {
    expect(normalizeCivId('ngaru-bon')).toBe('ngaru_bon')
    expect(normalizeCivId('Irrah')).toBe('irrah')
    expect(normalizeCivId('  basin ')).toBe('basin')
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

  it('returns nodes-only with no edges when entities are undefined', () => {
    const g = buildFactionGraph(fc([civ('alpha'), civ('beta')]), undefined)
    expect(g.nodes).toHaveLength(2)
    expect(g.edges).toEqual([])
  })

  it('survives a malformed entities value (degrades to nodes-only)', () => {
    const junk = 42 as unknown as CanonCrossCivEntity[]
    const g = buildFactionGraph(fc([civ('alpha'), civ('beta')]), junk)
    expect(g.nodes).toHaveLength(2)
    expect(g.edges).toEqual([])
  })

  it('layers in node metadata (cardinal, biome, elevation) from geojson props', () => {
    const feature: GeoJSONFeature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {
        id: 'alpha',
        name: 'Alpha',
        type: 'civilization',
        cardinal: 'North',
        terrain: 'highland steppe',
        elevation: '1500-2500m',
      },
    }
    const g = buildFactionGraph(fc([feature]))
    expect(g.nodes[0]).toMatchObject({
      id: 'alpha',
      cardinal: 'North',
      biome: 'highland steppe',
      elevation: '1500-2500m',
    })
  })
})

describe('buildFactionGraph — canon cross-civ edges', () => {
  it('emits one typeless weighted edge per pair carrying name/lede/canonId', () => {
    const g = buildFactionGraph(
      fc([civ('alpha'), civ('beta')]),
      [crossCiv('alpha', 'beta', 7)]
    )
    expect(g.edges).toHaveLength(1)
    const e = g.edges[0]
    expect([e.source, e.target].sort()).toEqual(['alpha', 'beta'])
    expect(e.weight).toBe(7)
    expect(e.name).toBe('alpha ↔ beta')
    expect(e.lede).toBe('The alpha–beta relationship.')
    expect(e.canonId).toBe('factions.cross_civ.alpha_beta')
  })

  it('defaults weight to 1 when density is missing', () => {
    const ent = crossCiv('alpha', 'beta', 0)
    delete (ent as { density?: number }).density
    const g = buildFactionGraph(fc([civ('alpha'), civ('beta')]), [ent])
    expect(g.edges[0].weight).toBe(1)
  })

  it('normalizes hyphenated canon slugs onto geojson underscore ids', () => {
    const g = buildFactionGraph(
      fc([civ('ngaru_bon')]),
      [crossCiv('basin', 'ngaru-bon', 7)]
    )
    const e = findEdge(g.edges, 'basin', 'ngaru_bon')
    expect(e).toBeTruthy()
    expect([e!.source, e!.target].sort()).toEqual(['basin', 'ngaru_bon'])
  })

  it('synthesises a place node (basin) referenced by an edge despite no geojson civ feature', () => {
    const g = buildFactionGraph(
      fc([civ('ngaru_bon')]),
      [crossCiv('basin', 'ngaru-bon', 7)]
    )
    const basin = g.nodes.find((n) => n.id === 'basin')
    expect(basin).toBeTruthy()
    expect(basin?.isPlace).toBe(true)
    expect(g.edges).toHaveLength(1)
  })

  it('dedupes a reversed pair into a single undirected edge', () => {
    const g = buildFactionGraph(
      fc([civ('alpha'), civ('beta')]),
      [crossCiv('alpha', 'beta', 6), crossCiv('beta', 'alpha', 6)]
    )
    expect(g.edges).toHaveLength(1)
  })

  it('skips edges whose endpoint is an unknown, non-place civ', () => {
    const g = buildFactionGraph(
      fc([civ('alpha')]),
      [crossCiv('alpha', 'nowhere', 5)]
    )
    expect(g.edges).toHaveLength(0)
  })

  it('ignores entities whose entity_type is not a cross_civ matrix', () => {
    const wrong = crossCiv('alpha', 'beta', 5, { entity_type: 'civilization' })
    const g = buildFactionGraph(fc([civ('alpha'), civ('beta')]), [wrong])
    expect(g.edges).toHaveLength(0)
  })
})
