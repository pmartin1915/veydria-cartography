import { describe, it, expect, beforeEach } from 'vitest'
import {
  createAnnotation,
  createHexAnnotation,
  createExploredAnnotation,
  getAnnotationsForHex,
  getExploredHexLabels,
  markRouteExplored,
  exportAnnotationsMarkdown,
  findNearestFeature,
  loadAnnotations,
  saveAnnotations,
  type MapAnnotation,
} from './annotations'

interface FeatureLike {
  type: 'Feature'
  geometry: { type: string; coordinates: number[] | number[][] | number[][][] }
  properties: Record<string, unknown>
}

// Minimal in-memory localStorage for the node test environment.
function installLocalStorageStub() {
  const store = new Map<string, string>()
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  }
  ;(globalThis as unknown as { localStorage: typeof stub }).localStorage = stub
  return stub
}

beforeEach(() => {
  installLocalStorageStub()
})

function makePoint(id: string, name: string, x: number, y: number, category = 'port'): FeatureLike {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [x, y] },
    properties: { id, name, category },
  }
}

function makePolygon(id: string, name: string, cx: number, cy: number, category = 'civilization'): FeatureLike {
  const r = 30
  const ring: number[][] = [
    [cx - r, cy - r],
    [cx + r, cy - r],
    [cx + r, cy + r],
    [cx - r, cy + r],
    [cx - r, cy - r],
  ]
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { id, name, category },
  }
}

describe('findNearestFeature', () => {
  it('returns the closest feature within range', () => {
    const features: FeatureLike[] = [
      makePoint('port-a', 'Far Port', 100, 100),
      makePoint('port-b', 'Near Port', 305, 405),
      makePoint('port-c', 'Other Port', 600, 600),
    ]
    const got = findNearestFeature(300, 400, features, 40)
    expect(got).not.toBeNull()
    expect(got?.id).toBe('port-b')
    expect(got?.name).toBe('Near Port')
  })

  it('returns null when no feature is within range', () => {
    const features: FeatureLike[] = [
      makePoint('p1', 'Distant', 0, 0),
      makePoint('p2', 'Also Distant', 1000, 800),
    ]
    expect(findNearestFeature(500, 400, features, 40)).toBeNull()
  })

  it('uses centroid for polygons', () => {
    const features: FeatureLike[] = [
      makePolygon('civ-1', 'Empire', 500, 400, 'civilization'),
    ]
    const got = findNearestFeature(510, 410, features, 40)
    expect(got?.id).toBe('civ-1')
  })

  it('skips terrain_cell and water categories', () => {
    const features: FeatureLike[] = [
      makePoint('cell-1', 'Some Cell', 300, 400, 'terrain_cell'),
      makePoint('basin', 'Inner Sea', 305, 400, 'water'),
      makePoint('port-1', 'Real Port', 320, 400, 'port'),
    ]
    const got = findNearestFeature(300, 400, features, 40)
    expect(got?.id).toBe('port-1')
  })

  it('skips features without a name', () => {
    const features: FeatureLike[] = [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [301, 401] },
        properties: { id: 'unnamed', category: 'port' },
      },
      makePoint('named', 'Has Name', 320, 400, 'port'),
    ]
    const got = findNearestFeature(300, 400, features, 40)
    expect(got?.id).toBe('named')
  })

  it('respects a custom maxDistance', () => {
    const features: FeatureLike[] = [
      makePoint('p1', 'Sixty Away', 360, 400, 'port'),
    ]
    expect(findNearestFeature(300, 400, features, 40)).toBeNull()
    expect(findNearestFeature(300, 400, features, 80)?.id).toBe('p1')
  })
})

describe('createAnnotation', () => {
  it('creates an annotation with no featureId by default', () => {
    const ann = createAnnotation(100, 200)
    expect(ann.featureId).toBeUndefined()
    expect(ann.featureName).toBeUndefined()
    expect(ann.hexLabel).toBeUndefined()
    expect(ann.x).toBe(100)
    expect(ann.y).toBe(200)
    expect(typeof ann.id).toBe('string')
    expect(ann.id.length).toBeGreaterThan(0)
  })

  it('preserves an explicitly assigned featureId', () => {
    const ann: MapAnnotation = { ...createAnnotation(50, 50), featureId: 'port-a', featureName: 'Port A' }
    expect(ann.featureId).toBe('port-a')
    expect(ann.featureName).toBe('Port A')
  })
})

describe('createHexAnnotation', () => {
  it('creates an annotation with hexLabel set', () => {
    const ann = createHexAnnotation('G7', 300, 400, 'Bandit camp', 'Dangerous area')
    expect(ann.hexLabel).toBe('G7')
    expect(ann.x).toBe(300)
    expect(ann.y).toBe(400)
    expect(ann.label).toBe('Bandit camp')
    expect(ann.body).toBe('Dangerous area')
  })

  it('uses default label and body when omitted', () => {
    const ann = createHexAnnotation('A1', 100, 100)
    expect(ann.hexLabel).toBe('A1')
    expect(ann.label).toBe('Hex Note')
    expect(ann.body).toBe('')
  })
})

describe('getAnnotationsForHex', () => {
  it('returns only annotations matching the hex label', () => {
    const annotations: MapAnnotation[] = [
      { id: '1', x: 0, y: 0, label: 'A', body: '', color: '#c4a86b', createdAt: 1, hexLabel: 'G7' },
      { id: '2', x: 0, y: 0, label: 'B', body: '', color: '#c4a86b', createdAt: 2, hexLabel: 'H8' },
      { id: '3', x: 0, y: 0, label: 'C', body: '', color: '#c4a86b', createdAt: 3 },
    ]
    const got = getAnnotationsForHex(annotations, 'G7')
    expect(got).toHaveLength(1)
    expect(got[0].id).toBe('1')
  })

  it('returns empty array when no annotations match', () => {
    const annotations: MapAnnotation[] = [
      { id: '1', x: 0, y: 0, label: 'A', body: '', color: '#c4a86b', createdAt: 1, hexLabel: 'H8' },
    ]
    expect(getAnnotationsForHex(annotations, 'G7')).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(getAnnotationsForHex([], 'G7')).toEqual([])
  })
})

describe('storage migration v1 → v2', () => {
  it('migrates legacy v1 annotations into the v2 key on first load', () => {
    const legacy: MapAnnotation[] = [
      {
        id: 'legacy-1',
        x: 10,
        y: 20,
        label: 'Old Pin',
        body: 'from v1',
        color: '#c4a86b',
        createdAt: 1700000000000,
      },
    ]
    localStorage.setItem('veydria-annotations-v1', JSON.stringify(legacy))

    const loaded = loadAnnotations()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe('legacy-1')
    expect(loaded[0].featureId).toBeUndefined()
    expect(localStorage.getItem('veydria-annotations-v1')).toBeNull()
    expect(localStorage.getItem('veydria-annotations-v2')).not.toBeNull()
  })

  it('does not overwrite an existing v2 payload', () => {
    const v1 = [{ id: 'old', x: 1, y: 2, label: 'a', body: '', color: '#c4a86b', createdAt: 1 }]
    const v2 = [{ id: 'new', x: 3, y: 4, label: 'b', body: '', color: '#c4a86b', createdAt: 2 }]
    localStorage.setItem('veydria-annotations-v1', JSON.stringify(v1))
    localStorage.setItem('veydria-annotations-v2', JSON.stringify(v2))

    const loaded = loadAnnotations()

    expect(loaded.map(a => a.id)).toEqual(['new'])
  })

  it('returns empty when no storage payload exists', () => {
    expect(loadAnnotations()).toEqual([])
  })

  it('round-trips v2 annotations with featureId through save/load', () => {
    const ann: MapAnnotation = {
      id: 'a1',
      x: 100,
      y: 200,
      label: 'Linked',
      body: '',
      color: '#c4a86b',
      createdAt: 1,
      featureId: 'port-a',
      featureName: 'Port A',
    }
    saveAnnotations([ann])
    const loaded = loadAnnotations()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].featureId).toBe('port-a')
    expect(loaded[0].featureName).toBe('Port A')
  })
})

describe('explored annotations (fog of war)', () => {
  it('createExploredAnnotation produces a well-formed hex-keyed annotation', () => {
    const ann = createExploredAnnotation('G7')
    expect(ann.hexLabel).toBe('G7')
    expect(ann.kind).toBe('explored')
    expect(ann.label).toBe('Explored')
    expect(typeof ann.id).toBe('string')
    expect(ann.id.length).toBeGreaterThan(0)
  })

  it('round-trips kind through save/load', () => {
    const ann = createExploredAnnotation('H8')
    saveAnnotations([ann])
    const loaded = loadAnnotations()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].kind).toBe('explored')
    expect(loaded[0].hexLabel).toBe('H8')
  })

  it('legacy annotations without kind survive the validator', () => {
    const legacy: MapAnnotation = {
      id: 'legacy', x: 1, y: 2, label: 'old', body: '', color: '#c4a86b', createdAt: 1,
    }
    saveAnnotations([legacy])
    const loaded = loadAnnotations()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].kind).toBeUndefined()
  })

  it('rejects unknown kind values', () => {
    const bad = { id: 'x', x: 0, y: 0, label: '', body: '', color: '#c4a86b', createdAt: 1, kind: 'bogus' }
    localStorage.setItem('veydria-annotations-v2', JSON.stringify([bad]))
    expect(loadAnnotations()).toEqual([])
  })

  it('getExploredHexLabels returns only explored hex labels', () => {
    const annotations: MapAnnotation[] = [
      { id: '1', x: 0, y: 0, label: 'p', body: '', color: '#c4a86b', createdAt: 1, hexLabel: 'A1', kind: 'pin' },
      { id: '2', x: 0, y: 0, label: 'n', body: '', color: '#c4a86b', createdAt: 2, hexLabel: 'B2', kind: 'hex-note' },
      { id: '3', x: 0, y: 0, label: 'e', body: '', color: '#c4a86b', createdAt: 3, hexLabel: 'C3', kind: 'explored' },
      { id: '4', x: 0, y: 0, label: 'e', body: '', color: '#c4a86b', createdAt: 4, hexLabel: 'D4', kind: 'explored' },
    ]
    const got = getExploredHexLabels(annotations)
    expect(got.size).toBe(2)
    expect(got.has('C3')).toBe(true)
    expect(got.has('D4')).toBe(true)
    expect(got.has('A1')).toBe(false)
  })

  it('markRouteExplored adds new explored entries and dedupes against existing', () => {
    const initial: MapAnnotation[] = [
      { id: '1', x: 0, y: 0, label: 'e', body: '', color: '#c4a86b', createdAt: 1, hexLabel: 'A1', kind: 'explored' },
    ]
    const next = markRouteExplored(initial, ['A1', 'B2', 'B2', 'C3'])
    const explored = getExploredHexLabels(next)
    expect(explored.size).toBe(3)
    expect(explored.has('A1')).toBe(true)
    expect(explored.has('B2')).toBe(true)
    expect(explored.has('C3')).toBe(true)
    // No duplicate B2 annotation
    expect(next.filter((a) => a.hexLabel === 'B2')).toHaveLength(1)
  })

  it('markRouteExplored returns identity when no new hexes', () => {
    const initial: MapAnnotation[] = [
      { id: '1', x: 0, y: 0, label: 'e', body: '', color: '#c4a86b', createdAt: 1, hexLabel: 'A1', kind: 'explored' },
    ]
    const next = markRouteExplored(initial, ['A1'])
    expect(next).toBe(initial)
  })

  it('exportAnnotationsMarkdown skips explored entries', () => {
    const annotations: MapAnnotation[] = [
      { id: '1', x: 10, y: 20, label: 'Real pin', body: 'note', color: '#c4a86b', createdAt: 1 },
      { id: '2', x: 0, y: 0, label: 'Explored', body: '', color: '#c4a86b', createdAt: 2, hexLabel: 'G7', kind: 'explored' },
    ]
    const md = exportAnnotationsMarkdown(annotations)
    expect(md).toContain('Real pin')
    expect(md).not.toContain('Explored')
    expect(md).not.toContain('G7')
  })
})
