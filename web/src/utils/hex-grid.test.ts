import { describe, it, expect } from 'vitest'
import {
  axialToPixel,
  pixelToAxial,
  roundAxial,
  axialToOffset,
  offsetToAxial,
  hexNeighbors,
  labelHex,
  parseHexLabel,
  generateHexGrid,
  sampleHexFeatures,
  axialDistance,
  hexLineBetween,
  getRouteHexLabels,
  getHexBiomeColor,
  getBiomeAtPoint,
  BIOME_COLORS,
  HEX_EDGE_NEIGHBORS,
  axialKey,
  getNeighborBiomes,
  type AxialCoord,
  type HexCell,
} from './hex-grid'
import type { GeoJSONFeature } from '../App'

const HEX_SIZE = 40
const ORIGIN: [number, number] = [0, 0]
const EPSILON = 1e-6

describe('axialToPixel / pixelToAxial', () => {
  it('round-trips integer axial coords exactly', () => {
    for (let q = -10; q <= 10; q++) {
      for (let r = -10; r <= 10; r++) {
        const [x, y] = axialToPixel(q, r, HEX_SIZE, ORIGIN)
        const back = pixelToAxial(x, y, HEX_SIZE, ORIGIN)
        expect(Math.abs(back.q - q)).toBeLessThan(EPSILON)
        expect(Math.abs(back.r - r)).toBeLessThan(EPSILON)
      }
    }
  })

  it('round-trips at least 20 random fractional coords within epsilon', () => {
    let seed = 0xc0ffee
    const rand = () => {
      // Mulberry32 — deterministic so the test is reproducible.
      seed = (seed + 0x6d2b79f5) | 0
      let t = seed
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    for (let i = 0; i < 25; i++) {
      const q = (rand() - 0.5) * 30
      const r = (rand() - 0.5) * 30
      const [x, y] = axialToPixel(q, r, HEX_SIZE, ORIGIN)
      const back = pixelToAxial(x, y, HEX_SIZE, ORIGIN)
      expect(Math.abs(back.q - q)).toBeLessThan(EPSILON)
      expect(Math.abs(back.r - r)).toBeLessThan(EPSILON)
    }
  })

  it('respects the origin offset', () => {
    const origin: [number, number] = [123.4, 56.7]
    const [x, y] = axialToPixel(3, -2, HEX_SIZE, origin)
    const back = pixelToAxial(x, y, HEX_SIZE, origin)
    expect(Math.abs(back.q - 3)).toBeLessThan(EPSILON)
    expect(Math.abs(back.r - -2)).toBeLessThan(EPSILON)
  })

  it('roundAxial snaps fractional coords to the nearest hex', () => {
    const r = roundAxial({ q: 0.1, r: -0.1 })
    // Use +0 comparison via numeric equality (avoids the +0/-0 deep-equal trap).
    expect(r.q + 0).toBe(0)
    expect(r.r + 0).toBe(0)
    const r2 = roundAxial({ q: 2.9, r: -1.1 })
    expect(r2.q).toBe(3)
    expect(r2.r).toBe(-1)
  })
})

describe('axialToOffset / offsetToAxial', () => {
  it('round-trips for both even and odd rows', () => {
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 12; col++) {
        const axial = offsetToAxial({ col, row })
        const offset = axialToOffset(axial)
        expect(offset.col).toBe(col)
        expect(offset.row).toBe(row)
      }
    }
  })
})

describe('hexNeighbors', () => {
  it('returns exactly 6 distinct coords for the origin', () => {
    const ns = hexNeighbors({ q: 0, r: 0 })
    expect(ns).toHaveLength(6)
    const seen = new Set(ns.map((n) => `${n.q},${n.r}`))
    expect(seen.size).toBe(6)
    // Origin must not be one of its own neighbours.
    expect(seen.has('0,0')).toBe(false)
  })

  it('returns 6 distinct coords for any random input', () => {
    for (const [q, r] of [
      [5, -3],
      [-7, 2],
      [10, 10],
      [-12, -8],
      [0, 9],
    ] as [number, number][]) {
      const ns = hexNeighbors({ q, r })
      expect(ns).toHaveLength(6)
      const seen = new Set(ns.map((n) => `${n.q},${n.r}`))
      expect(seen.size).toBe(6)
      expect(seen.has(`${q},${r}`)).toBe(false)
    }
  })

  it('every neighbour is one step away under axial distance', () => {
    const center: [number, number] = [0, 0]
    const ns = hexNeighbors({ q: 0, r: 0 })
    const dist = (a: { q: number; r: number }) =>
      (Math.abs(a.q) + Math.abs(a.q + a.r) + Math.abs(a.r)) / 2
    for (const n of ns) expect(dist(n)).toBe(1)
    expect(center).toEqual([0, 0])
  })
})

describe('labelHex', () => {
  it('labels A1 at origin and uses 1-indexed columns', () => {
    expect(labelHex({ q: 0, r: 0 })).toBe('A1')
  })

  it('row letters advance with offset row', () => {
    // Row 1 col 0 (after odd-r conversion): axial q for row 1 col 0 is q=0, r=1 ? actually
    // for { col: 0, row: 1 } odd-r → q = 0 - ((1 - 1)/2) = 0, r = 1.
    expect(labelHex(offsetToAxial({ col: 0, row: 1 }))).toBe('B1')
    expect(labelHex(offsetToAxial({ col: 6, row: 6 }))).toBe('G7')
    expect(labelHex(offsetToAxial({ col: 11, row: 1 }))).toBe('B12')
    expect(labelHex(offsetToAxial({ col: 98, row: 25 }))).toBe('Z99')
  })

  it('rolls into AA/AB beyond Z', () => {
    expect(labelHex(offsetToAxial({ col: 0, row: 26 }))).toBe('AA1')
    expect(labelHex(offsetToAxial({ col: 0, row: 27 }))).toBe('AB1')
  })
})

describe('parseHexLabel', () => {
  it('round-trips with labelHex across the in-grid range', () => {
    for (let row = 0; row < 30; row++) {
      for (let col = 0; col < 40; col++) {
        const coord = offsetToAxial({ col, row })
        const label = labelHex(coord)
        const parsed = parseHexLabel(label)
        expect(parsed).not.toBeNull()
        expect(parsed!.q).toBe(coord.q)
        expect(parsed!.r).toBe(coord.r)
      }
    }
  })

  it('parses A1 as the origin', () => {
    expect(parseHexLabel('A1')).toEqual({ q: 0, r: 0 })
  })

  it('parses double-letter rows', () => {
    const aa1 = parseHexLabel('AA1')
    expect(aa1).toEqual(offsetToAxial({ col: 0, row: 26 }))
    const ab1 = parseHexLabel('AB1')
    expect(ab1).toEqual(offsetToAxial({ col: 0, row: 27 }))
  })

  it('returns null for malformed labels', () => {
    expect(parseHexLabel('g7')).toBeNull()       // lowercase
    expect(parseHexLabel('A')).toBeNull()        // no digits
    expect(parseHexLabel('7')).toBeNull()        // no letters
    expect(parseHexLabel('A0')).toBeNull()       // 1-indexed columns
    expect(parseHexLabel('A 1')).toBeNull()      // whitespace
    expect(parseHexLabel('')).toBeNull()
  })
})

describe('generateHexGrid', () => {
  it('produces a finite, plausible-count array for 1200x800 / size 40', () => {
    const grid = generateHexGrid(1200, 800, 40)
    expect(Array.isArray(grid)).toBe(true)
    expect(grid.length).toBeGreaterThanOrEqual(100)
    expect(grid.length).toBeLessThanOrEqual(1500)
  })

  it('every centroid lies within the canvas bounds', () => {
    const grid = generateHexGrid(1200, 800, 40)
    for (const cell of grid) {
      expect(cell.centroid[0]).toBeGreaterThanOrEqual(0)
      expect(cell.centroid[0]).toBeLessThanOrEqual(1200)
      expect(cell.centroid[1]).toBeGreaterThanOrEqual(0)
      expect(cell.centroid[1]).toBeLessThanOrEqual(800)
      expect(cell.corners.length).toBe(6)
      expect(cell.label.length).toBeGreaterThan(0)
    }
  })

  it('first cell is labelled A1 at the origin (0,0)', () => {
    const grid = generateHexGrid(1200, 800, 40)
    const a1 = grid.find((c) => c.label === 'A1')
    expect(a1).toBeDefined()
    expect(a1!.centroid[0]).toBeCloseTo(0, 5)
    expect(a1!.centroid[1]).toBeCloseTo(0, 5)
  })

  it('labels are unique across the grid', () => {
    const grid = generateHexGrid(1200, 800, 40)
    const labels = new Set(grid.map((c) => c.label))
    expect(labels.size).toBe(grid.length)
  })

  it('returns empty for invalid inputs', () => {
    expect(generateHexGrid(0, 800, 40)).toEqual([])
    expect(generateHexGrid(1200, 0, 40)).toEqual([])
    expect(generateHexGrid(1200, 800, 0)).toEqual([])
    expect(generateHexGrid(1200, 800, -10)).toEqual([])
  })
})

// ---------- Test fixture helpers ----------

function makeHex(cx: number, cy: number, size: number): HexCell {
  const corners: [number, number][] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90)
    corners.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)])
  }
  return {
    coord: { q: 0, r: 0 },
    label: 'A1',
    centroid: [cx, cy],
    corners,
  }
}

function makeTerrainCell(
  cx: number,
  cy: number,
  size: number,
  elevation: number,
  biome?: string,
): GeoJSONFeature {
  // A small square polygon centred at (cx, cy).
  const half = size
  const ring = [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
    [cx - half, cy - half],
  ]
  const props: Record<string, unknown> = {
    category: 'terrain_cell',
    elevation,
    civ: 'irrah',
    id: `tc_${cx}_${cy}`,
  }
  if (biome !== undefined) {
    props.biome = biome
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: props,
  }
}

function makePoint(category: string, x: number, y: number, extra: Record<string, unknown> = {}): GeoJSONFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [x, y] },
    properties: { category, ...extra },
  }
}

describe('sampleHexFeatures', () => {
  it('returns ["Open Sea"] for an empty feature list', () => {
    const hex = makeHex(600, 400, 40)
    expect(sampleHexFeatures(hex, [])).toEqual(['Open Sea'])
  })

  it('returns ["Open Sea"] when no features overlap the hex', () => {
    const hex = makeHex(600, 400, 40)
    const far = makePoint('landmark', 50, 50, { type: 'mountain' })
    expect(sampleHexFeatures(hex, [far])).toEqual(['Open Sea'])
  })

  it('includes "Hill" for a forested-ish terrain_cell whose polygon contains the hex centroid', () => {
    // elevation 400 → "Hill" per our biome bucketing. (The task asks for "Forest"
    // but Veydria terrain_cells expose only elevation, not biome — so we use
    // elevation buckets. The test verifies the descriptor *for the elevation*.)
    const hex = makeHex(600, 400, 40)
    const cell = makeTerrainCell(600, 400, 80, 400)
    const out = sampleHexFeatures(hex, [cell])
    expect(out).toContain('Hill')
  })

  it('uses biome prop when present instead of elevation bucket', () => {
    const hex = makeHex(600, 400, 40)
    const cell = makeTerrainCell(600, 400, 80, 400, 'Cloud forest')
    const out = sampleHexFeatures(hex, [cell])
    expect(out).toContain('Cloud forest')
    expect(out).not.toContain('Hill')
  })

  it('falls back to elevation bucket when biome prop is missing', () => {
    const hex = makeHex(600, 400, 40)
    const cell = makeTerrainCell(600, 400, 80, 50) // no biome
    const out = sampleHexFeatures(hex, [cell])
    expect(out).toContain('Plains')
  })

  it('treats a low-elevation cell as Plains', () => {
    const hex = makeHex(600, 400, 40)
    const cell = makeTerrainCell(600, 400, 80, 50)
    expect(sampleHexFeatures(hex, [cell])).toContain('Plains')
  })

  it('returns 1-4 unique strings, never undefined, never duplicates', () => {
    const hex = makeHex(600, 400, 40)
    const features: GeoJSONFeature[] = [
      makeTerrainCell(600, 400, 80, 50), // Plains
      makeTerrainCell(601, 401, 80, 50), // dup → still Plains
      makePoint('river', 600, 400),
      makePoint('oasis', 600, 400),
      makePoint('landmark', 600, 400, { type: 'ruin' }),
      makePoint('landmark', 601, 401, { type: 'fortress' }),
      makePoint('port', 600, 400),
    ]
    const out = sampleHexFeatures(hex, features)
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out.length).toBeLessThanOrEqual(4)
    expect(new Set(out).size).toBe(out.length)
    for (const s of out) {
      expect(s).toBeDefined()
      expect(typeof s).toBe('string')
      expect(s.length).toBeGreaterThan(0)
    }
  })

  it('caps output at 4 even when many distinct categories match', () => {
    const hex = makeHex(600, 400, 40)
    const features: GeoJSONFeature[] = [
      makeTerrainCell(600, 400, 80, 400), // Hill
      makePoint('river', 600, 400),
      makePoint('oasis', 600, 400),
      makePoint('port', 600, 400),
      makePoint('chokepoint', 600, 400, { type: 'mountain_pass' }),
      makePoint('contested_site', 600, 400),
      makePoint('landmark', 600, 400, { type: 'volcano' }),
    ]
    const out = sampleHexFeatures(hex, features)
    expect(out.length).toBe(4)
  })

  it('orders by frequency (most common first)', () => {
    const hex = makeHex(600, 400, 40)
    const features: GeoJSONFeature[] = [
      // Three Plains terrain cells, one River → Plains should be first.
      makeTerrainCell(600, 400, 80, 50),
      makeTerrainCell(601, 401, 80, 50),
      makeTerrainCell(599, 399, 80, 50),
      makePoint('river', 600, 400),
    ]
    const out = sampleHexFeatures(hex, features)
    expect(out[0]).toBe('Plains')
    expect(out).toContain('River')
  })
})

describe('axialDistance', () => {
  it('is zero for the same cell', () => {
    expect(axialDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0)
    expect(axialDistance({ q: 5, r: -3 }, { q: 5, r: -3 })).toBe(0)
  })

  it('is one for direct neighbours', () => {
    const origin: AxialCoord = { q: 0, r: 0 }
    for (const n of hexNeighbors(origin)) {
      expect(axialDistance(origin, n)).toBe(1)
    }
  })

  it('is symmetric', () => {
    const a: AxialCoord = { q: 4, r: -2 }
    const b: AxialCoord = { q: -1, r: 3 }
    expect(axialDistance(a, b)).toBe(axialDistance(b, a))
  })

  it('satisfies the triangle inequality on a sample of triples', () => {
    const samples: AxialCoord[] = [
      { q: 0, r: 0 },
      { q: 3, r: -1 },
      { q: -2, r: 4 },
      { q: 5, r: 5 },
      { q: -4, r: -2 },
    ]
    for (const a of samples) {
      for (const b of samples) {
        for (const c of samples) {
          expect(axialDistance(a, c)).toBeLessThanOrEqual(
            axialDistance(a, b) + axialDistance(b, c),
          )
        }
      }
    }
  })

  it('matches a known coord pair', () => {
    // (0,0) → (3,-2): cube delta is (3, -2, -1) → (3+2+1)/2 = 3.
    expect(axialDistance({ q: 0, r: 0 }, { q: 3, r: -2 })).toBe(3)
  })
})

describe('hexLineBetween', () => {
  it('returns just the start when start equals end', () => {
    const out = hexLineBetween({ q: 2, r: -1 }, { q: 2, r: -1 })
    expect(out).toEqual([{ q: 2, r: -1 }])
  })

  it('returns distance + 1 cells', () => {
    const a: AxialCoord = { q: 0, r: 0 }
    const b: AxialCoord = { q: 4, r: -2 }
    const out = hexLineBetween(a, b)
    expect(out.length).toBe(axialDistance(a, b) + 1)
  })

  it('starts at a and ends at b', () => {
    const a: AxialCoord = { q: -3, r: 5 }
    const b: AxialCoord = { q: 4, r: -1 }
    const line = hexLineBetween(a, b)
    expect(line[0]).toEqual(a)
    expect(line[line.length - 1]).toEqual(b)
  })

  it('produces only neighbour-adjacent steps', () => {
    const cases: Array<[AxialCoord, AxialCoord]> = [
      [{ q: 0, r: 0 }, { q: 5, r: 0 }],
      [{ q: 0, r: 0 }, { q: 3, r: -2 }],
      [{ q: -2, r: 4 }, { q: 4, r: -3 }],
      [{ q: 7, r: 0 }, { q: 0, r: 7 }],
    ]
    for (const [a, b] of cases) {
      const line = hexLineBetween(a, b)
      for (let i = 1; i < line.length; i++) {
        expect(axialDistance(line[i - 1], line[i])).toBe(1)
      }
    }
  })
})

describe('getHexBiomeColor', () => {
  it('returns the biome color when hex centroid is inside a terrain_cell with biome', () => {
    const hex = makeHex(600, 400, 40)
    const cell = makeTerrainCell(600, 400, 80, 400, 'Cloud forest')
    expect(getHexBiomeColor(hex, [cell])).toBe(BIOME_COLORS['Cloud forest'])
  })

  it('returns null when no terrain_cell contains the hex', () => {
    const hex = makeHex(600, 400, 40)
    const far = makePoint('landmark', 50, 50, { type: 'mountain' })
    expect(getHexBiomeColor(hex, [far])).toBeNull()
  })

  it('falls back to elevation-based color when biome prop is missing', () => {
    const hex = makeHex(600, 400, 40)
    const cell = makeTerrainCell(600, 400, 80, 50) // no biome → Plains
    expect(getHexBiomeColor(hex, [cell])).toBe(BIOME_COLORS['Plains'])
  })

  it('ignores non-terrain_cell features', () => {
    const hex = makeHex(600, 400, 40)
    const river = makePoint('river', 600, 400)
    const farCell = makeTerrainCell(50, 50, 80, 400, 'Desert')
    expect(getHexBiomeColor(hex, [river, farCell])).toBeNull()
  })
})

describe('getBiomeAtPoint', () => {
  it('returns biome name when point is inside a terrain_cell with biome', () => {
    const cell = makeTerrainCell(600, 400, 80, 400, 'Cloud forest')
    expect(getBiomeAtPoint(600, 400, [cell])).toBe('Cloud forest')
  })

  it('returns elevation fallback when biome prop is missing', () => {
    const cell = makeTerrainCell(600, 400, 80, 50) // no biome → Plains
    expect(getBiomeAtPoint(600, 400, [cell])).toBe('Plains')
  })

  it('returns null when point is outside all terrain_cells', () => {
    const far = makeTerrainCell(50, 50, 80, 400, 'Desert')
    expect(getBiomeAtPoint(600, 400, [far])).toBeNull()
  })

  it('ignores non-terrain_cell features', () => {
    const river = makePoint('river', 600, 400)
    const farCell = makeTerrainCell(50, 50, 80, 400, 'Desert')
    expect(getBiomeAtPoint(600, 400, [river, farCell])).toBeNull()
  })
})

describe('getRouteHexLabels', () => {
  const HEX_SIZE = 50

  it('returns empty array for empty nodes', () => {
    expect(getRouteHexLabels([], HEX_SIZE)).toEqual([])
  })

  it('returns a single label for a single node', () => {
    // Centroid of A1 at size 50, origin (0,0)
    const [x, y] = axialToPixel(0, 0, HEX_SIZE, [0, 0])
    expect(getRouteHexLabels([{ x, y }], HEX_SIZE)).toEqual(['A1'])
  })

  it('returns adjacent labels for two neighbouring nodes', () => {
    const [x1, y1] = axialToPixel(0, 0, HEX_SIZE, [0, 0])
    const [x2, y2] = axialToPixel(1, 0, HEX_SIZE, [0, 0])
    const labels = getRouteHexLabels([{ x: x1, y: y1 }, { x: x2, y: y2 }], HEX_SIZE)
    expect(labels.length).toBe(2)
    expect(labels[0]).toBe('A1')
    expect(labels[1]).toBe('A2')
  })

  it('deduplicates when two nodes land in the same hex', () => {
    const [x, y] = axialToPixel(0, 0, HEX_SIZE, [0, 0])
    // Two points both inside A1 (near centroid and slightly offset).
    const labels = getRouteHexLabels([{ x, y }, { x: x + 5, y: y + 5 }], HEX_SIZE)
    expect(labels).toEqual(['A1'])
  })

  it('produces a clean sequence across a longer line', () => {
    // (0,0) → (3,0) should pass through A1, A2, A3, A4
    const [x1, y1] = axialToPixel(0, 0, HEX_SIZE, [0, 0])
    const [x2, y2] = axialToPixel(3, 0, HEX_SIZE, [0, 0])
    const labels = getRouteHexLabels([{ x: x1, y: y1 }, { x: x2, y: y2 }], HEX_SIZE)
    expect(labels.length).toBeGreaterThanOrEqual(2)
    expect(labels[0]).toBe('A1')
    expect(labels[labels.length - 1]).toBe('A4')
    // No adjacent duplicates.
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i]).not.toBe(labels[i - 1])
    }
  })

  it('handles a multi-stop route without duplicates', () => {
    const [x1, y1] = axialToPixel(0, 0, HEX_SIZE, [0, 0])
    const [x2, y2] = axialToPixel(2, 0, HEX_SIZE, [0, 0])
    const [x3, y3] = axialToPixel(4, 0, HEX_SIZE, [0, 0])
    const labels = getRouteHexLabels(
      [{ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }],
      HEX_SIZE,
    )
    expect(labels.length).toBeGreaterThanOrEqual(3)
    expect(labels[0]).toBe('A1')
    expect(labels[labels.length - 1]).toBe('A5')
    for (let i = 1; i < labels.length; i++) {
      expect(labels[i]).not.toBe(labels[i - 1])
    }
  })
})

describe('HEX_EDGE_NEIGHBORS', () => {
  it('has six entries, one per hex edge', () => {
    expect(HEX_EDGE_NEIGHBORS).toHaveLength(6)
  })

  it('matches the documented edge-index ordering (NE, E, SE, SW, W, NW)', () => {
    expect(HEX_EDGE_NEIGHBORS[0]).toEqual({ q: 1, r: -1 }) // NE
    expect(HEX_EDGE_NEIGHBORS[1]).toEqual({ q: 1, r: 0 })  // E
    expect(HEX_EDGE_NEIGHBORS[2]).toEqual({ q: 0, r: 1 })  // SE
    expect(HEX_EDGE_NEIGHBORS[3]).toEqual({ q: -1, r: 1 }) // SW
    expect(HEX_EDGE_NEIGHBORS[4]).toEqual({ q: -1, r: 0 }) // W
    expect(HEX_EDGE_NEIGHBORS[5]).toEqual({ q: 0, r: -1 }) // NW
  })

  it('every offset has magnitude 1 (axial distance from origin)', () => {
    for (const offset of HEX_EDGE_NEIGHBORS) {
      expect(axialDistance({ q: 0, r: 0 }, offset)).toBe(1)
    }
  })

  it('offsets are symmetric — every direction has its opposite present', () => {
    for (const offset of HEX_EDGE_NEIGHBORS) {
      const opposite = { q: -offset.q, r: -offset.r }
      const found = HEX_EDGE_NEIGHBORS.some(
        (o) => o.q === opposite.q && o.r === opposite.r,
      )
      expect(found).toBe(true)
    }
  })
})

describe('getNeighborBiomes', () => {
  it('returns six entries in edge-index order', () => {
    const biomes = new Map<string, string | null>()
    expect(getNeighborBiomes({ q: 0, r: 0 }, biomes)).toHaveLength(6)
  })

  it('returns null for every edge when no neighbors exist', () => {
    const biomes = new Map<string, string | null>()
    biomes.set(axialKey({ q: 0, r: 0 }), 'Desert')
    const result = getNeighborBiomes({ q: 0, r: 0 }, biomes)
    expect(result).toEqual([null, null, null, null, null, null])
  })

  it('reads each neighbor by its axial-key', () => {
    const biomes = new Map<string, string | null>()
    biomes.set(axialKey({ q: 1, r: -1 }), 'NE-biome')
    biomes.set(axialKey({ q: 1, r: 0 }), 'E-biome')
    biomes.set(axialKey({ q: 0, r: 1 }), 'SE-biome')
    biomes.set(axialKey({ q: -1, r: 1 }), 'SW-biome')
    biomes.set(axialKey({ q: -1, r: 0 }), 'W-biome')
    biomes.set(axialKey({ q: 0, r: -1 }), 'NW-biome')
    const result = getNeighborBiomes({ q: 0, r: 0 }, biomes)
    expect(result).toEqual(['NE-biome', 'E-biome', 'SE-biome', 'SW-biome', 'W-biome', 'NW-biome'])
  })

  it('treats explicit-null biome entries the same as missing entries', () => {
    const biomes = new Map<string, string | null>()
    biomes.set(axialKey({ q: 1, r: 0 }), null)
    const result = getNeighborBiomes({ q: 0, r: 0 }, biomes)
    expect(result[1]).toBeNull()
  })

  it('works for non-origin source coords', () => {
    const biomes = new Map<string, string | null>()
    biomes.set(axialKey({ q: 5, r: 4 }), 'East-of-target')   // E of (4,4)
    biomes.set(axialKey({ q: 4, r: 3 }), 'NW-of-target')     // NW of (4,4)
    const result = getNeighborBiomes({ q: 4, r: 4 }, biomes)
    expect(result[1]).toBe('East-of-target')
    expect(result[5]).toBe('NW-of-target')
    expect(result[0]).toBeNull()
  })

  it('edge-index matches HEX_EDGE_NEIGHBORS exactly', () => {
    const biomes = new Map<string, string | null>()
    for (let i = 0; i < 6; i++) {
      biomes.set(axialKey(HEX_EDGE_NEIGHBORS[i]), `edge-${i}`)
    }
    const result = getNeighborBiomes({ q: 0, r: 0 }, biomes)
    for (let i = 0; i < 6; i++) {
      expect(result[i]).toBe(`edge-${i}`)
    }
  })
})

describe('axialKey', () => {
  it('formats axial coord as "q,r"', () => {
    expect(axialKey({ q: 0, r: 0 })).toBe('0,0')
    expect(axialKey({ q: -3, r: 5 })).toBe('-3,5')
  })

  it('is injective — distinct coords produce distinct keys', () => {
    const keys = new Set<string>()
    for (let q = -5; q <= 5; q++) {
      for (let r = -5; r <= 5; r++) {
        keys.add(axialKey({ q, r }))
      }
    }
    expect(keys.size).toBe(11 * 11)
  })
})
