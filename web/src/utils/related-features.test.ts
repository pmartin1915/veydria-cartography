import { describe, it, expect } from 'vitest'
import { findRelatedFeatures, type RelatedFeature } from './related-features'
import type { GeoJSONFeature } from '../App'

function makeFeature(
  id: string,
  category: string,
  geomType: string,
  coords: number[] | number[][] | number[][][],
  extra: Record<string, unknown> = {}
): GeoJSONFeature {
  return {
    type: 'Feature',
    geometry: { type: geomType, coordinates: coords },
    properties: { id, category, ...extra },
  }
}

function makePoint(id: string, category: string, x: number, y: number, extra: Record<string, unknown> = {}): GeoJSONFeature {
  return makeFeature(id, category, 'Point', [x, y], extra)
}

function makePolygon(id: string, category: string, cx: number, cy: number, size: number, extra: Record<string, unknown> = {}): GeoJSONFeature {
  const ring: number[][] = [
    [cx - size, cy - size],
    [cx + size, cy - size],
    [cx + size, cy + size],
    [cx - size, cy + size],
    [cx - size, cy - size],
  ]
  return makeFeature(id, category, 'Polygon', [ring], extra)
}

function makeLine(id: string, category: string, pts: number[][], extra: Record<string, unknown> = {}): GeoJSONFeature {
  return makeFeature(id, category, 'LineString', pts, extra)
}

describe('findRelatedFeatures', () => {
  it('returns empty array when no other features exist', () => {
    const f = makePoint('a', 'port', 100, 100)
    expect(findRelatedFeatures(f, [])).toEqual([])
  })

  it('never includes the query feature itself', () => {
    const f = makePoint('a', 'port', 100, 100)
    const all = [f]
    const related = findRelatedFeatures(f, all)
    expect(related).toHaveLength(0)
  })

  // ─── Trade route endpoints ───
  it('links trade_route endpoints to civilization features', () => {
    const route = makeFeature('route1', 'trade_route', 'LineString', [[0, 0], [100, 100]], {
      endpoints: ['civ_a', 'civ_b'],
    })
    const civA = makePoint('civ_a', 'civilization', 0, 0, { name: 'Civ A' })
    const civB = makePoint('civ_b', 'civilization', 100, 100, { name: 'Civ B' })
    const unrelated = makePoint('civ_c', 'civilization', 500, 500, { name: 'Civ C' })

    const related = findRelatedFeatures(route, [civA, civB, unrelated])
    const ids = related.map((r) => getFeatureId(r.feature))
    expect(ids).toContain('civ_a')
    expect(ids).toContain('civ_b')
    expect(ids).not.toContain('civ_c')
    expect(related.every((r) => r.relationType === 'trade')).toBe(true)
  })

  // ─── Civilization trade routes ───
  it('links civilization to its trade routes', () => {
    const civ = makePoint('civ_x', 'civilization', 0, 0, { name: 'Civ X' })
    const route = makeFeature('route1', 'trade_route', 'LineString', [[0, 0], [100, 100]], {
      endpoints: ['civ_x', 'civ_y'],
    })

    const related = findRelatedFeatures(civ, [route])
    expect(related).toHaveLength(1)
    expect(related[0].relation).toContain('Trade route')
    expect(related[0].relation).toContain('civ_y')
    expect(related[0].relationType).toBe('trade')
  })

  // ─── Civilization chokepoints ───
  it('links civilization to bordering chokepoints', () => {
    const civ = makePoint('civ_x', 'civilization', 0, 0, { name: 'Civ X' })
    const choke = makePoint('choke1', 'chokepoint', 50, 50, {
      connects: ['civ_x', 'civ_z'],
    })

    const related = findRelatedFeatures(civ, [choke])
    expect(related).toHaveLength(1)
    expect(related[0].relation).toContain('Border chokepoint')
    expect(related[0].relationType).toBe('geography')
  })

  // ─── Civilization ports ───
  it('links civilization to ports within its territory by location', () => {
    const civ = makePoint('civ_irrah', 'civilization', 0, 0, { name: 'Irrah' })
    const port = makePoint('port1', 'port', 10, 10, {
      location: 'Port of Irrah',
    })
    const farPort = makePoint('port2', 'port', 500, 500, {
      location: 'Port of Kael',
    })

    const related = findRelatedFeatures(civ, [port, farPort])
    expect(related.map((r) => getFeatureId(r.feature))).toContain('port1')
    expect(related.map((r) => getFeatureId(r.feature))).not.toContain('port2')
    expect(related.find((r) => getFeatureId(r.feature) === 'port1')?.relationType).toBe('geography')
  })

  it('matches port location by id with underscores replaced by spaces', () => {
    const civ = makePoint('the_empire', 'civilization', 0, 0, { name: 'The Empire' })
    const port = makePoint('port1', 'port', 10, 10, {
      location: 'the empire coast',
    })

    const related = findRelatedFeatures(civ, [port])
    expect(related.map((r) => getFeatureId(r.feature))).toContain('port1')
  })

  // ─── Port / chokepoint / oasis / landmark / contested_site → trade routes ───
  it('links ports to trade routes by path description', () => {
    const port = makePoint('port1', 'port', 100, 100, { name: 'Alexandria' })
    const route = makeFeature('route1', 'trade_route', 'LineString', [[0, 0], [200, 200]], {
      path_description: 'Route from Alexandria to Rome',
    })

    const related = findRelatedFeatures(port, [route])
    expect(related).toHaveLength(1)
    expect(related[0].relation).toBe('On trade route')
    expect(related[0].relationType).toBe('trade')
  })

  it('matches trade route path by first word of feature name', () => {
    const landmark = makePoint('lm1', 'landmark', 100, 100, { name: 'Red Mountain' })
    const route = makeFeature('route1', 'trade_route', 'LineString', [[0, 0], [200, 200]], {
      path_description: 'Passing near Red Mountain peak',
    })

    const related = findRelatedFeatures(landmark, [route])
    expect(related.map((r) => getFeatureId(r.feature))).toContain('route1')
  })

  it('does not match when first word differs', () => {
    const landmark = makePoint('lm1', 'landmark', 100, 100, { name: 'Blue Mountain' })
    // Place route far away so proximity does not pick it up
    const route = makeFeature('route1', 'trade_route', 'LineString', [[5000, 5000], [5100, 5100]], {
      path_description: 'Passing near Red Mountain peak',
    })

    const related = findRelatedFeatures(landmark, [route])
    expect(related.map((r) => getFeatureId(r.feature))).not.toContain('route1')
  })

  // ─── Proximity ───
  it('includes nearby features by proximity', () => {
    const center = makePoint('center', 'port', 100, 100)
    const near = makePoint('near', 'landmark', 110, 110)
    const far = makePoint('far', 'landmark', 1000, 1000)

    const related = findRelatedFeatures(center, [near, far])
    const ids = related.map((r) => getFeatureId(r.feature))
    expect(ids).toContain('near')
    expect(ids).not.toContain('far')
    expect(related.find((r) => getFeatureId(r.feature) === 'near')?.relationType).toBe('proximity')
  })

  it('excludes water and terrain_cell from proximity', () => {
    const center = makePoint('center', 'port', 100, 100)
    const water = makePoint('w1', 'water', 105, 105)
    const terrain = makePoint('t1', 'terrain_cell', 106, 106)
    const landmark = makePoint('l1', 'landmark', 107, 107)

    const related = findRelatedFeatures(center, [water, terrain, landmark])
    const ids = related.map((r) => getFeatureId(r.feature))
    expect(ids).not.toContain('w1')
    expect(ids).not.toContain('t1')
    expect(ids).toContain('l1')
  })

  it('deduplicates features already found by other relations', () => {
    const civ = makePoint('civ_x', 'civilization', 0, 0, { name: 'Civ X' })
    const route = makeFeature('route1', 'trade_route', 'LineString', [[0, 0], [10, 10]], {
      endpoints: ['civ_x', 'civ_y'],
    })
    // route is also very close to civ, but should only appear once
    const related = findRelatedFeatures(civ, [route])
    const routeEntries = related.filter((r) => getFeatureId(r.feature) === 'route1')
    expect(routeEntries).toHaveLength(1)
  })

  it('caps total results at 10', () => {
    const center = makePoint('center', 'port', 100, 100)
    const features: GeoJSONFeature[] = []
    for (let i = 0; i < 20; i++) {
      features.push(makePoint(`near${i}`, 'landmark', 100 + i * 2, 100 + i * 2))
    }
    const related = findRelatedFeatures(center, features)
    expect(related.length).toBeLessThanOrEqual(10)
  })

  it('proximity results include distance in km', () => {
    const center = makePoint('center', 'port', 100, 100)
    const near = makePoint('near', 'landmark', 120, 100) // 20 SVG units ≈ 50 km
    const related = findRelatedFeatures(center, [near])
    const prox = related.find((r) => r.relationType === 'proximity')
    expect(prox).toBeDefined()
    expect(prox!.relation).toMatch(/^\d+ km away$/)
  })

  it('sorts proximity results by distance (closest first)', () => {
    const center = makePoint('center', 'port', 100, 100)
    const f1 = makePoint('f1', 'landmark', 102, 100)
    const f2 = makePoint('f2', 'landmark', 110, 100)
    const f3 = makePoint('f3', 'landmark', 104, 100)

    const related = findRelatedFeatures(center, [f1, f2, f3])
    const prox = related.filter((r) => r.relationType === 'proximity')
    const ids = prox.map((r) => getFeatureId(r.feature))
    expect(ids[0]).toBe('f1')
    expect(ids[1]).toBe('f3')
    expect(ids[2]).toBe('f2')
  })

  // ─── Centroid computation ───
  it('uses explicit centroid property when available', () => {
    const f = makeFeature('poly1', 'civilization', 'Polygon', [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]], {
      centroid: [200, 200],
    })
    const near = makePoint('near', 'landmark', 202, 200)
    const far = makePoint('far', 'landmark', 10, 10)

    const related = findRelatedFeatures(f, [near, far])
    const ids = related.map((r) => getFeatureId(r.feature))
    expect(ids).toContain('near')
    expect(ids).not.toContain('far')
  })

  it('computes polygon centroid from ring when no centroid prop', () => {
    const poly = makePolygon('poly1', 'civilization', 100, 100, 10)
    const near = makePoint('near', 'landmark', 101, 101)
    const related = findRelatedFeatures(poly, [near])
    expect(related.map((r) => getFeatureId(r.feature))).toContain('near')
  })

  it('uses linestring midpoint as centroid', () => {
    const line = makeLine('line1', 'trade_route', [[0, 0], [100, 100], [200, 200]])
    const near = makePoint('near', 'landmark', 101, 101)
    const related = findRelatedFeatures(line, [near])
    expect(related.map((r) => getFeatureId(r.feature))).toContain('near')
  })

  it('skips proximity when centroid cannot be computed', () => {
    const multi = makeFeature('multi', 'landmark', 'MultiPoint', [[0, 0], [10, 10]])
    const near = makePoint('near', 'landmark', 1, 1)
    const related = findRelatedFeatures(multi, [near])
    expect(related).toHaveLength(0)
  })

  // ─── Proximity only fills remaining slots ───
  it('does not add proximity when trade routes already fill the cap', () => {
    const civ = makePoint('civ_x', 'civilization', 0, 0, { name: 'Civ X' })
    const routes: GeoJSONFeature[] = []
    for (let i = 0; i < 12; i++) {
      // Spread routes far apart so they don't trigger proximity for each other
      routes.push(makeFeature(`route${i}`, 'trade_route', 'LineString', [[i * 1000, i * 1000], [(i * 1000) + 10, (i * 1000) + 10]], {
        endpoints: ['civ_x', `civ_${i}`],
      }))
    }
    // 12 trade routes exceed the 10-result cap, so no proximity should be added
    const related = findRelatedFeatures(civ, routes)
    expect(related.length).toBe(12)
    expect(related.every((r) => r.relationType === 'trade')).toBe(true)
  })
})

function getFeatureId(f: GeoJSONFeature): string {
  return ((f as unknown as Record<string, unknown>).id as string) || (f.properties.id as string) || ''
}
