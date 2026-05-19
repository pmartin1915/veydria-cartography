/**
 * hex-grid.ts — pure-logic hex grid for the Veydria SVG coordinate space
 *
 * Civilization-V-style overlay foundation. This module is framework-agnostic:
 * it never imports React, Leaflet, or D3. The output is geometry + labels +
 * sampled descriptors in SVG coordinate space. Converting to lat/lng is the
 * caller's responsibility.
 *
 * Orientation: POINTY-TOP. Reasons:
 *   - Veydria's SVG is wider than tall (1200 x 800), so pointy-top hexes
 *     stack into more compact rows that read naturally as "row letters,
 *     column numbers" (the same convention used by Civ V's tactical layer).
 *   - The offset → axial mapping below uses "odd-r" offset (rows offset
 *     to the right on odd row indices), which is the canonical pointy-top
 *     pairing.
 *
 * Labeling: row letters (A, B, C, ..., Z, AA, AB, ...) by offset row,
 *           column numbers (1-indexed) by offset col.
 *           Example: row 0 col 0 → "A1"; row 6 col 6 → "G7".
 *
 * Geometry source of truth: Red Blob Games — Hex Grids
 * (https://www.redblobgames.com/grids/hexagons/). All trig is in pixel/SVG
 * units; `hexSize` is the radius from centre to corner.
 */

import type { GeoJSONFeature } from '../App'

// ---------- Types ----------

export type AxialCoord = { q: number; r: number }
export type OffsetCoord = { col: number; row: number }

export type HexCell = {
  coord: AxialCoord
  label: string
  /** Centre of the hex in SVG (x, y) units. */
  centroid: [number, number]
  /** Six corner points in SVG (x, y) units, ordered clockwise from the top. */
  corners: [number, number][]
}

// ---------- Pixel <-> Axial (pointy-top) ----------

const SQRT3 = Math.sqrt(3)

/**
 * Pointy-top axial → pixel.
 * x = size * (sqrt(3)*q + sqrt(3)/2 * r) + originX
 * y = size * (3/2 * r) + originY
 */
export function axialToPixel(
  q: number,
  r: number,
  hexSize: number,
  origin: [number, number],
): [number, number] {
  const x = hexSize * (SQRT3 * q + (SQRT3 / 2) * r) + origin[0]
  const y = hexSize * (1.5 * r) + origin[1]
  return [x, y]
}

/**
 * Pointy-top pixel → axial (continuous, no rounding).
 * Use `roundAxial` to snap to the nearest hex.
 */
export function pixelToAxial(
  x: number,
  y: number,
  hexSize: number,
  origin: [number, number],
): AxialCoord {
  const px = x - origin[0]
  const py = y - origin[1]
  const q = ((SQRT3 / 3) * px - (1 / 3) * py) / hexSize
  const r = ((2 / 3) * py) / hexSize
  return { q, r }
}

/**
 * Round a fractional axial coord to the nearest integer hex using cube
 * rounding (so the rounding is rotationally symmetric).
 */
export function roundAxial(coord: AxialCoord): AxialCoord {
  const x = coord.q
  const z = coord.r
  const y = -x - z

  let rx = Math.round(x)
  let ry = Math.round(y)
  let rz = Math.round(z)

  const xDiff = Math.abs(rx - x)
  const yDiff = Math.abs(ry - y)
  const zDiff = Math.abs(rz - z)

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz
  } else if (yDiff > zDiff) {
    ry = -rx - rz
  } else {
    rz = -rx - ry
  }
  return { q: rx, r: rz }
}

// ---------- Offset <-> Axial (odd-r, pointy-top) ----------

export function axialToOffset(coord: AxialCoord): OffsetCoord {
  const col = coord.q + (coord.r - (coord.r & 1)) / 2
  const row = coord.r
  return { col, row }
}

export function offsetToAxial(off: OffsetCoord): AxialCoord {
  const q = off.col - (off.row - (off.row & 1)) / 2
  const r = off.row
  return { q, r }
}

// ---------- Neighbours ----------

const AXIAL_DIRECTIONS: AxialCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export function hexNeighbors(coord: AxialCoord): AxialCoord[] {
  return AXIAL_DIRECTIONS.map((d) => ({ q: coord.q + d.q, r: coord.r + d.r }))
}

// ---------- Distance & line ----------

/**
 * Hex distance in cube space. s = -q-r, so
 *   |dq| + |dr| + |dq+dr| = |dq| + |dr| + |ds|, divided by 2.
 */
export function axialDistance(a: AxialCoord, b: AxialCoord): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

/**
 * Cells along the straight line from `a` to `b`, inclusive at both ends.
 * Returns `[a]` when a equals b, otherwise `distance + 1` cells where each
 * consecutive pair are neighbours. Uses fractional cube interpolation +
 * roundAxial — same approach used in pixelToAxial / hover lookup.
 */
export function hexLineBetween(a: AxialCoord, b: AxialCoord): AxialCoord[] {
  const N = axialDistance(a, b)
  if (N === 0) return [{ q: a.q, r: a.r }]
  const out: AxialCoord[] = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const q = a.q + (b.q - a.q) * t
    const r = a.r + (b.r - a.r) * t
    out.push(roundAxial({ q, r }))
  }
  return out
}

/**
 * Compute the sequence of hex labels a journey route passes through.
 * Samples each node and the straight line between consecutive nodes against
 * the hex grid. Duplicates are collapsed so the result reads as a clean
 * path like "G7 → H8 → I9".
 */
export function getRouteHexLabels(
  nodes: Array<{ x: number; y: number }>,
  hexSize: number,
): string[] {
  if (!nodes || nodes.length === 0) return []

  const result: string[] = []

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const axial = roundAxial(pixelToAxial(node.x, node.y, hexSize, [0, 0]))

    if (i === 0) {
      result.push(labelHex(axial))
    } else {
      const prevNode = nodes[i - 1]
      const prevAxial = roundAxial(pixelToAxial(prevNode.x, prevNode.y, hexSize, [0, 0]))
      const line = hexLineBetween(prevAxial, axial)

      // Append every label on the line, skipping the first (already added as
      // the previous node's hex) and skipping any immediate duplicates.
      for (let j = 1; j < line.length; j++) {
        const lineLabel = labelHex(line[j])
        if (lineLabel !== result[result.length - 1]) {
          result.push(lineLabel)
        }
      }
    }
  }

  return result
}

// ---------- Labels ----------

/**
 * 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB", ... (spreadsheet-style).
 */
function rowToLetters(row: number): string {
  if (row < 0) return '?'
  let n = row
  let s = ''
  // Bijective base-26: subtract 1 each iteration after the first digit.
  s = String.fromCharCode(65 + (n % 26)) + s
  n = Math.floor(n / 26)
  while (n > 0) {
    n -= 1
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26)
  }
  return s
}

/**
 * Label a hex from its axial coord.
 *   row letters use the offset row (odd-r, pointy-top);
 *   column number is offset col + 1 (so the first column reads as 1, not 0).
 *   Example: { q: 6, r: 6 } at offset { col: 9, row: 6 } → "G10".
 */
export function labelHex(coord: AxialCoord): string {
  const { col, row } = axialToOffset(coord)
  return `${rowToLetters(row)}${col + 1}`
}

/**
 * Inverse of `labelHex`. "G7" → { q, r }. Returns null for malformed input
 * (lowercase, missing digits, leading zeros). Does NOT validate that the
 * coord lands inside the rendered grid — callers that need that should
 * resolve through HexOverlay.getHexByLabel instead.
 */
export function parseHexLabel(label: string): AxialCoord | null {
  const m = /^([A-Z]+)(\d+)$/.exec(label)
  if (!m) return null
  const letters = m[1]
  let row = 0
  for (const ch of letters) {
    row = row * 26 + (ch.charCodeAt(0) - 64) // A=1, B=2, …
  }
  row -= 1 // bijective base-26 → 0-indexed
  const col = parseInt(m[2], 10) - 1
  if (col < 0) return null
  return offsetToAxial({ col, row })
}

// ---------- Edges & neighbors ----------

/**
 * Pointy-top axial neighbor offsets, ordered to match the edge index of a hex
 * whose corners are emitted by `hexCorners` (clockwise from top).
 *
 * Edge i lies between corners[i] and corners[(i+1) % 6]:
 *   edge 0 (top → upper-right)     ↔ NE neighbor (+1, -1)
 *   edge 1 (upper-right → lower-r) ↔ E  neighbor (+1,  0)
 *   edge 2 (lower-right → bottom)  ↔ SE neighbor ( 0, +1)
 *   edge 3 (bottom → lower-left)   ↔ SW neighbor (-1, +1)
 *   edge 4 (lower-left → upper-l)  ↔ W  neighbor (-1,  0)
 *   edge 5 (upper-left → top)      ↔ NW neighbor ( 0, -1)
 *
 * r increases downward in SVG coordinates, hence (q+1, r-1) is upper-right.
 */
export const HEX_EDGE_NEIGHBORS: ReadonlyArray<AxialCoord> = [
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
]

export function axialKey(coord: AxialCoord): string {
  return `${coord.q},${coord.r}`
}

/**
 * For each of the six edges of the hex at `coord`, return the biome of the
 * neighboring hex on that edge, or null if no neighbor exists (off-grid) or
 * the neighbor has no biome.
 *
 * `biomeByAxialKey` is keyed by `axialKey({q,r})`. Pure function; no DOM.
 */
export function getNeighborBiomes(
  coord: AxialCoord,
  biomeByAxialKey: Map<string, string | null>,
): (string | null)[] {
  return HEX_EDGE_NEIGHBORS.map((offset) => {
    const neighborKey = axialKey({ q: coord.q + offset.q, r: coord.r + offset.r })
    return biomeByAxialKey.get(neighborKey) ?? null
  })
}

// ---------- Corners ----------

function hexCorners(centerX: number, centerY: number, hexSize: number): [number, number][] {
  const corners: [number, number][] = []
  // Pointy-top: first corner at the top (angle = -90°), then every 60°.
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90)
    corners.push([centerX + hexSize * Math.cos(angle), centerY + hexSize * Math.sin(angle)])
  }
  return corners
}

// ---------- Grid generation ----------

/**
 * Generate every pointy-top hex whose centroid lies inside
 * [0, svgWidth] × [0, svgHeight]. Origin is fixed at (0, 0) so coordinates
 * are stable across renders. Caller picks `hexSize` (~50 SVG units gives
 * ~250 hexes for the 1200×800 canvas).
 */
export function generateHexGrid(
  svgWidth: number,
  svgHeight: number,
  hexSize: number,
): HexCell[] {
  if (!Number.isFinite(svgWidth) || svgWidth <= 0) return []
  if (!Number.isFinite(svgHeight) || svgHeight <= 0) return []
  if (!Number.isFinite(hexSize) || hexSize <= 0) return []

  const cells: HexCell[] = []

  // For pointy-top: row spacing = 1.5 * size; col spacing = sqrt(3) * size.
  const rowStep = 1.5 * hexSize
  const colStep = SQRT3 * hexSize
  const maxRow = Math.ceil(svgHeight / rowStep) + 1
  const maxCol = Math.ceil(svgWidth / colStep) + 1

  for (let row = 0; row <= maxRow; row++) {
    for (let col = 0; col <= maxCol; col++) {
      const axial = offsetToAxial({ col, row })
      const [cx, cy] = axialToPixel(axial.q, axial.r, hexSize, [0, 0])
      if (cx < 0 || cx > svgWidth) continue
      if (cy < 0 || cy > svgHeight) continue
      cells.push({
        coord: axial,
        label: labelHex(axial),
        centroid: [cx, cy],
        corners: hexCorners(cx, cy, hexSize),
      })
    }
  }
  return cells
}

// ---------- Feature sampling ----------

/**
 * Compute a tight bounding box for a hex (axis-aligned, in SVG units).
 */
/**
 * Return the biome name at an arbitrary SVG point by testing terrain_cell
 * polygon containment. Returns `null` if the point falls outside all known
 * terrain cells.
 */
export function getBiomeAtPoint(x: number, y: number, features: GeoJSONFeature[]): string | null {
  for (const f of features) {
    const props = f.properties || {}
    const cat = (props.category as string) || ''
    if (cat !== 'terrain_cell') continue
    if (f.geometry?.type !== 'Polygon') continue

    const ring = (f.geometry.coordinates as number[][][])[0]
    if (!ring || !ring.length) continue

    let pminX = Infinity,
      pminY = Infinity,
      pmaxX = -Infinity,
      pmaxY = -Infinity
    for (const [px, py] of ring) {
      if (px < pminX) pminX = px
      if (px > pmaxX) pmaxX = px
      if (py < pminY) pminY = py
      if (py > pmaxY) pmaxY = py
    }
    if (x < pminX || x > pmaxX || y < pminY || y > pmaxY) continue
    if (pointInPolygon(x, y, ring)) {
      return (props.biome as string) || elevationToBiome((props.elevation as number) ?? 0)
    }
  }
  return null
}

export function getHexBiomeColor(hex: HexCell, features: GeoJSONFeature[]): string | null {
  const [hcx, hcy] = hex.centroid
  const bounds = hexBounds(hex)

  for (const f of features) {
    const props = f.properties || {}
    const cat = (props.category as string) || ''
    if (cat !== 'terrain_cell') continue
    if (f.geometry?.type !== 'Polygon') continue

    const ring = (f.geometry.coordinates as number[][][])[0]
    if (!ring || !ring.length) continue

    let pminX = Infinity,
      pminY = Infinity,
      pmaxX = -Infinity,
      pmaxY = -Infinity
    for (const [px, py] of ring) {
      if (px < pminX) pminX = px
      if (px > pmaxX) pmaxX = px
      if (py < pminY) pminY = py
      if (py > pmaxY) pmaxY = py
    }
    if (
      pmaxX < bounds.minX ||
      pminX > bounds.maxX ||
      pmaxY < bounds.minY ||
      pminY > bounds.maxY
    ) {
      continue
    }
    if (pointInPolygon(hcx, hcy, ring)) {
      const biome = (props.biome as string) || ''
      if (biome && BIOME_COLORS[biome]) {
        return BIOME_COLORS[biome]
      }
      const elev = (props.elevation as number) ?? 0
      const elevBiome = elevationToBiome(elev)
      return BIOME_COLORS[elevBiome] || null
    }
  }
  return null
}

function hexBounds(hex: HexCell): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of hex.corners) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

function pointInBounds(
  x: number,
  y: number,
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY
}

function pointInPolygon(x: number, y: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function capitalizeWord(s: string): string {
  if (!s) return s
  return s
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
}

/**
 * Map an elevation in metres (the only signal terrain_cell carries today)
 * to a single-word biome descriptor. Buckets chosen against the actual
 * Veydria elevation distribution (-1100 m basin floor → 2600 m highlands).
 */
// Cross-reviewed (Cowork, 2026-05-19) and tuned against the parchment base
// layer (feat(hex-overlay): parchment base). Hue pulled 8-12° toward yellow,
// saturation dropped ~20%, value lifted so cells read as tinted paper not
// paint chips. Desert/Highland/Mountain kept — already correct ochre/parchment.
export const BIOME_COLORS: Record<string, string> = {
  // Primary biomes
  'Cloud forest': '#5e7a4a',
  'Highland savanna': '#a8b06a',
  'Desert': '#d4a76a',
  'Steppe': '#c4c290',
  'Monsoon delta': '#6a8e5e',
  'Volcanic archipelago': '#7a543c',
  // Secondary — Ngaru-Bon
  'Miombo woodland': '#7a8848',
  'Afroalpine heath': '#a6a89a',
  'River gorge': '#6a7a6a',
  // Secondary — Irrah
  'Sabkha': '#d8c898',
  'Oasis': '#8aaa5c',
  'Escarpment': '#a89878',
  // Secondary — Kheshkai
  'Highland grassland': '#b4b878',
  'Cliff edge': '#9c9686',
  'River gallery': '#7a967a',
  // Secondary — Ndjadi
  'Mangrove swamp': '#5a7e58',
  'Floodplain': '#94a468',
  'Stone baray': '#adaa92',
  // Secondary — Qollari
  'Mountain terrace': '#76886c',
  'Fog bank': '#b0b8be',
  'Cliff road': '#968474',
  // Secondary — Oravan
  'Coral reef': '#6a9aa4',
  'Geothermal vent': '#a8623c',
  'Strait': '#6a8ea6',
  // Elevation fallback buckets
  'Sea': '#6a8ca8',
  'Plains': '#a4b070',
  'Hill': '#aaa86c',
  'Highland': '#a89a6a',
  'Mountain': '#9a8a6a',
  'Peak': '#c4beae',
}

function elevationToBiome(elev: number): string {
  if (elev < 0) return 'Sea'
  if (elev < 200) return 'Plains'
  if (elev < 600) return 'Hill'
  if (elev < 1200) return 'Highland'
  if (elev < 2000) return 'Mountain'
  return 'Peak'
}

function landmarkDescriptor(props: Record<string, unknown>): string {
  const t = (props.type as string | undefined) ?? ''
  switch (t) {
    case 'mountain':
      return 'Mountain'
    case 'volcano':
      return 'Volcano'
    case 'sacred_site':
      return 'Sacred Site'
    case 'ruin':
      return 'Ruin'
    case 'fortress':
      return 'Fortress'
    case 'city':
      return 'City'
    case 'port_city':
      return 'Port'
    case 'resource':
      return 'Resource'
    default:
      return capitalizeWord(t || 'Landmark')
  }
}

function getCentroidOfFeature(f: GeoJSONFeature): [number, number] | null {
  const g = f.geometry
  if (!g || !g.coordinates) return null
  if (g.type === 'Point') {
    const [x, y] = g.coordinates as number[]
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return [x, y]
  }
  if (g.type === 'LineString') {
    const pts = g.coordinates as number[][]
    if (!pts.length) return null
    const mid = pts[Math.floor(pts.length / 2)]
    return [mid[0], mid[1]]
  }
  if (g.type === 'Polygon') {
    const ring = (g.coordinates as number[][][])[0]
    if (!ring || !ring.length) return null
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
    return [cx, cy]
  }
  return null
}

/**
 * Return up to four short, capitalised terrain descriptors for a hex.
 * Strategy:
 *   1. For each feature: if it's a polygon, test whether the hex centroid
 *      falls inside the polygon ring (catches terrain_cell coverage); for
 *      points + line midpoints, test whether the feature centroid falls
 *      inside the hex's bounding box.
 *   2. Translate matched features into descriptors (terrain_cell → biome;
 *      water → Sea; river → River; etc.).
 *   3. Tally frequency, dedupe, and return the top 4. If nothing matches,
 *      fall back to "Open Sea".
 *
 * Performance note for callers: this is O(features) per hex. With ~3000
 * features and ~300 hexes, naive use is ~900k checks — acceptable for a
 * one-shot precompute, but consider a spatial index if you re-sample on
 * pan/zoom.
 */
export function sampleHexFeatures(hex: HexCell, features: GeoJSONFeature[]): string[] {
  if (!features || features.length === 0) return ['Open Sea']

  const bounds = hexBounds(hex)
  const [hcx, hcy] = hex.centroid
  const counts = new Map<string, number>()
  const bump = (label: string) => {
    if (!label) return
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }

  for (const f of features) {
    const props = f.properties || {}
    const cat = (props.category as string) || ''
    const geomType = f.geometry?.type

    let matched = false
    if (geomType === 'Polygon') {
      const ring = (f.geometry.coordinates as number[][][])[0]
      if (ring && ring.length > 0) {
        // Polygon containment by hex centroid is the right "is this hex on
        // top of that biome cell" test. Bounding box pre-check keeps the
        // expensive ray cast off the hot path.
        let pminX = Infinity,
          pminY = Infinity,
          pmaxX = -Infinity,
          pmaxY = -Infinity
        for (const [px, py] of ring) {
          if (px < pminX) pminX = px
          if (px > pmaxX) pmaxX = px
          if (py < pminY) pminY = py
          if (py > pmaxY) pmaxY = py
        }
        // If polygon bbox doesn't intersect hex bbox, skip.
        if (
          pmaxX < bounds.minX ||
          pminX > bounds.maxX ||
          pmaxY < bounds.minY ||
          pminY > bounds.maxY
        ) {
          continue
        }
        if (pointInPolygon(hcx, hcy, ring)) matched = true
      }
    } else {
      const c = getCentroidOfFeature(f)
      if (c && pointInBounds(c[0], c[1], bounds)) matched = true
    }

    if (!matched) continue

    if (cat === 'terrain_cell') {
      const biome = (props.biome as string | undefined)
      if (biome) {
        bump(biome)
      } else {
        // Fallback to elevation bucket if no biome prop (backward compat)
        const elev = (props.elevation as number) ?? 0
        bump(elevationToBiome(elev))
      }
    } else if (cat === 'water') {
      // Use the descriptive 'type' if present, else the generic word.
      const t = (props.type as string | undefined) ?? ''
      bump(t ? capitalizeWord(t) : 'Sea')
    } else if (cat === 'river') {
      bump('River')
    } else if (cat === 'oasis') {
      bump('Oasis')
    } else if (cat === 'landmark') {
      bump(landmarkDescriptor(props))
    } else if (cat === 'port') {
      bump('Port')
    } else if (cat === 'chokepoint') {
      const t = (props.type as string | undefined) ?? ''
      // mountain_pass → "Mountain Pass" reads better than "Chokepoint".
      bump(t ? capitalizeWord(t.replace(/_/g, ' ')) : 'Chokepoint')
    } else if (cat === 'contested_site') {
      bump('Contested Site')
    } else if (cat === 'civilization') {
      // Civilizations cover broad swathes; skip — biome already conveys terrain.
      continue
    } else if (cat === 'trade_route') {
      bump('Trade Route')
    }
    // Unknown categories: ignored.
  }

  if (counts.size === 0) return ['Open Sea']

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([label]) => label)
}
