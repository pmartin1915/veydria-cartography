#!/usr/bin/env node
/**
 * tag-points-with-civ.mjs — F5 (audit follow-up, 2026-05-28)
 *
 * Adds a `civ` property to every Point feature in veydria-spatial.geojson
 * by point-in-polygon containment against the civilization polygons that
 * already carry `civ`. Cells (terrain_cell category) and existing-civ
 * polygons are left untouched.
 *
 * The journey-planner's segment labeler previously inferred a point's
 * civ spatially on every render; tagging the source data shifts the
 * inference up-front and makes Tavakh-Qarat (Irrah) vs Tavakh-Rubāṭ
 * (Oravan) disambiguation a property lookup instead of a polygon scan.
 *
 * Idempotent: re-running on already-tagged data is a no-op.
 *
 * Usage: node scripts/tag-points-with-civ.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PATH = resolve(__dirname, '..', 'web', 'public', 'veydria-spatial.geojson')

// Standard ray-casting point-in-polygon. ring is an array of [x, y] pairs.
function pointInPolygon(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

const raw = readFileSync(PATH, 'utf-8')
const data = JSON.parse(raw)

// Collect civ polygons (category=civilization carries the canonical civ key
// as its `id`; terrain_cell polygons carry `civ` per-cell but are not the
// reference polygon for point assignment).
const civPolys = []
for (const f of data.features) {
  if (f.properties?.category !== 'civilization') continue
  if (f.geometry?.type !== 'Polygon') continue
  const ring = f.geometry.coordinates?.[0]
  if (!ring?.length) continue
  civPolys.push({ id: f.properties.id, ring })
}

if (civPolys.length === 0) {
  console.error('No civilization polygons found — bailing.')
  process.exit(1)
}

let tagged = 0
let skipped = 0
let unmatched = 0

for (const f of data.features) {
  if (f.geometry?.type !== 'Point') continue
  if (f.properties?.civ) { skipped++; continue }
  const [x, y] = f.geometry.coordinates
  let matchedCiv = null
  for (const cp of civPolys) {
    if (pointInPolygon(x, y, cp.ring)) {
      matchedCiv = cp.id
      break
    }
  }
  if (matchedCiv) {
    f.properties.civ = matchedCiv
    tagged++
  } else {
    unmatched++
    console.warn(`  unmatched: ${f.properties?.id ?? '(no id)'} @ ${x.toFixed(1)},${y.toFixed(1)} (likely sea/strait)`)
  }
}

// Pretty-print to match the existing geojson formatting (2-space indent).
writeFileSync(PATH, JSON.stringify(data, null, 2) + '\n')

console.log(`Tagged: ${tagged}, already-tagged: ${skipped}, unmatched: ${unmatched}`)
