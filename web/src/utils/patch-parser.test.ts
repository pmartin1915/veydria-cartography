import { describe, it, expect } from 'vitest'
import {
  parsePatchYaml,
  applyPatches,
  type CoordinatePatch,
  type PatchableFeature,
} from './patch-parser'

function makeFeature(
  id: string,
  geomType: string,
  coords: number[] | number[][] | number[][][],
  extraProps: Record<string, unknown> = {}
): PatchableFeature {
  return {
    type: 'Feature',
    geometry: { type: geomType, coordinates: coords },
    properties: { id, ...extraProps },
  }
}

describe('parsePatchYaml', () => {
  it('returns empty array for empty string', () => {
    expect(parsePatchYaml('')).toEqual([])
  })

  it('returns empty array when no patches section', () => {
    const yaml = `metadata:
  version: 1`
    expect(parsePatchYaml(yaml)).toEqual([])
  })

  it('parses a single patch', () => {
    const yaml = `patches:
  - id: port_alexandria
    category: port
    coords: [120.5, 340.0]`
    const out = parsePatchYaml(yaml)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      id: 'port_alexandria',
      category: 'port',
      coords: [120.5, 340.0],
    })
  })

  it('parses multiple patches', () => {
    const yaml = `patches:
  - id: a
    category: civ
    coords: [1, 2]
  - id: b
    category: port
    coords: [3, 4]`
    const out = parsePatchYaml(yaml)
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe('a')
    expect(out[1].id).toBe('b')
  })

  it('ignores metadata section after patches', () => {
    const yaml = `patches:
  - id: x
    category: landmark
    coords: [10, 20]
metadata:
  author: test`
    const out = parsePatchYaml(yaml)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('x')
  })

  it('skips patches missing coords', () => {
    const yaml = `patches:
  - id: only_id
    category: civ`
    expect(parsePatchYaml(yaml)).toEqual([])
  })

  it('skips patches missing id', () => {
    const yaml = `patches:
  - category: civ
    coords: [1, 2]`
    expect(parsePatchYaml(yaml)).toEqual([])
  })

  it('handles extra whitespace and indentation', () => {
    const yaml = `patches:
    - id: spaced
      category:   port  
      coords: [  100.5  ,  200.5  ]`
    const out = parsePatchYaml(yaml)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('spaced')
    expect(out[0].category).toBe('port')
    expect(out[0].coords).toEqual([100.5, 200.5])
  })

  it('handles negative and decimal coords', () => {
    const yaml = `patches:
  - id: neg
    coords: [-12.34, 56.78]`
    const out = parsePatchYaml(yaml)
    expect(out[0].coords).toEqual([-12.34, 56.78])
  })

  it('handles mixed valid and invalid patches', () => {
    const yaml = `patches:
  - id: good
    coords: [1, 2]
  - id: bad_no_coords
    category: civ
  - id: also_good
    coords: [3, 4]`
    const out = parsePatchYaml(yaml)
    expect(out).toHaveLength(2)
    expect(out.map((p) => p.id)).toEqual(['good', 'also_good'])
  })

  it('does not parse coords without proper brackets', () => {
    const yaml = `patches:
  - id: malformed
    coords: 1, 2`
    expect(parsePatchYaml(yaml)).toEqual([])
  })
})

describe('applyPatches', () => {
  it('returns identical features when patches is empty', () => {
    const features = [makeFeature('a', 'Point', [0, 0])]
    const result = applyPatches({ features }, [])
    expect(result.applied).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.newFeatures).toEqual(features)
    expect(result.mutatedFeatures.size).toBe(0)
  })

  it('applies a patch to a Point feature', () => {
    const features = [makeFeature('port_a', 'Point', [10, 20])]
    const patches: CoordinatePatch[] = [{ id: 'port_a', category: 'port', coords: [100, 200] }]
    const result = applyPatches({ features }, patches)
    expect(result.applied).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.newFeatures[0].geometry.coordinates).toEqual([100, 200])
    expect(result.mutatedFeatures.has(0)).toBe(true)
  })

  it('skips when feature id is not found', () => {
    const features = [makeFeature('a', 'Point', [0, 0])]
    const patches: CoordinatePatch[] = [{ id: 'missing', category: 'civ', coords: [1, 2] }]
    const result = applyPatches({ features }, patches)
    expect(result.applied).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.details[0]).toContain('missing')
    expect(result.details[0]).toContain('not found')
  })

  it('skips non-Point geometry', () => {
    const features = [makeFeature('poly', 'Polygon', [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]])]
    const patches: CoordinatePatch[] = [{ id: 'poly', category: 'civ', coords: [5, 5] }]
    const result = applyPatches({ features }, patches)
    expect(result.applied).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.details[0]).toContain('not a Point')
  })

  it('matches by top-level id when properties.id is absent', () => {
    const feature: PatchableFeature = {
      type: 'Feature',
      id: 'top_level_id',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {},
    }
    const patches: CoordinatePatch[] = [{ id: 'top_level_id', category: 'civ', coords: [99, 99] }]
    const result = applyPatches({ features: [feature] }, patches)
    expect(result.applied).toBe(1)
    expect(result.newFeatures[0].geometry.coordinates).toEqual([99, 99])
  })

  it('matches by properties.id when top-level id is absent', () => {
    const features = [makeFeature('prop_id', 'Point', [0, 0])]
    const patches: CoordinatePatch[] = [{ id: 'prop_id', category: 'civ', coords: [77, 88] }]
    const result = applyPatches({ features }, patches)
    expect(result.applied).toBe(1)
    expect(result.newFeatures[0].geometry.coordinates).toEqual([77, 88])
  })

  it('does not mutate the original feature object', () => {
    const features = [makeFeature('a', 'Point', [0, 0])]
    const patches: CoordinatePatch[] = [{ id: 'a', category: 'civ', coords: [1, 2] }]
    const result = applyPatches({ features }, patches)
    expect(features[0].geometry.coordinates).toEqual([0, 0])
    expect(result.newFeatures[0].geometry.coordinates).toEqual([1, 2])
  })

  it('handles a mix of applied and skipped patches', () => {
    const features = [
      makeFeature('a', 'Point', [0, 0]),
      makeFeature('b', 'Polygon', [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]),
    ]
    const patches: CoordinatePatch[] = [
      { id: 'a', category: 'civ', coords: [10, 20] },
      { id: 'b', category: 'civ', coords: [30, 40] },
      { id: 'missing', category: 'civ', coords: [50, 60] },
    ]
    const result = applyPatches({ features }, patches)
    expect(result.applied).toBe(1)
    expect(result.skipped).toBe(2)
    expect(result.newFeatures[0].geometry.coordinates).toEqual([10, 20])
    expect(result.details).toHaveLength(3)
  })

  it('applies multiple patches to different features', () => {
    const features = [
      makeFeature('a', 'Point', [0, 0]),
      makeFeature('b', 'Point', [100, 100]),
    ]
    const patches: CoordinatePatch[] = [
      { id: 'a', category: 'civ', coords: [1, 2] },
      { id: 'b', category: 'port', coords: [3, 4] },
    ]
    const result = applyPatches({ features }, patches)
    expect(result.applied).toBe(2)
    expect(result.mutatedFeatures.size).toBe(2)
    expect(result.newFeatures[0].geometry.coordinates).toEqual([1, 2])
    expect(result.newFeatures[1].geometry.coordinates).toEqual([3, 4])
  })

  it('details include formatted coords for applied patches', () => {
    const features = [makeFeature('a', 'Point', [0, 0])]
    const patches: CoordinatePatch[] = [{ id: 'a', category: 'civ', coords: [123.456, 78.9] }]
    const result = applyPatches({ features }, patches)
    expect(result.details[0]).toContain('123.5')
    expect(result.details[0]).toContain('78.9')
  })
})
