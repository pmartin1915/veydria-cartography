import { describe, it, expect } from 'vitest'
import {
  axialToPixel,
  pixelToAxial,
  roundAxial,
  axialToOffset,
  offsetToAxial,
  hexNeighbors,
  labelHex,
  generateHexGrid,
  sampleHexFeatures,
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

function makeTerrainCell(cx: number, cy: number, size: number, elevation: number): GeoJSONFeature {
  // A small square polygon centred at (cx, cy).
  const half = size
  const ring = [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half],
    [cx - half, cy - half],
  ]
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: { category: 'terrain_cell', elevation, civ: 'irrah', id: `tc_${cx}_${cy}` },
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
