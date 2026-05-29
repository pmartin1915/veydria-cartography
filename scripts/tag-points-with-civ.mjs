#!/usr/bin/env node
/**
 * tag-points-with-civ.mjs — F5 (audit follow-up, 2026-05-28)
 *
 * Adds a `civ` property to every Point feature in veydria-spatial.geojson
 * by point-in-polygon containment against the civilization polygons that
 * already carry `civ`. Cells (terrain_cell category) and existing-civ
 * polygons are left untouched.
 *
 * The journey-planner's segment labeler now reads the authored `civ`
 * directly (buildGraph prefers it over nearest-centroid — F5), so tagging
 * the source data makes civ a property lookup instead of a polygon scan.
 *
 * IMPORTANT: point-in-polygon containment is NOT a reliable proxy for
 * canon ownership. The Irrah polygon is the large eastern hegemon, so
 * far-east steppe sites (kha_tepet, zang_kalli, dzong_kha) fall inside it
 * geometrically but belong to Kheshkai/Ngaru-Bon by canon. Those tags were
 * hand-corrected against worldbuilder canon. This script therefore:
 *   - NEVER overwrites an existing authored `civ` (canon wins over geometry),
 *   - WARNS when its PIP result disagrees with an authored value (the check
 *     that would have caught the mis-tags above),
 *   - SKIPS ids in DELIBERATELY_UNALIGNED (joint/contested/shared sites that
 *     must stay untagged), so a re-run can't re-introduce a wrong tag.
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

// Sites canon treats as joint / contested / shared (or that have no canon
// home yet). They must stay untagged — never auto-assign a civ to these,
// even if they fall inside a civ polygon by point-in-polygon.
const DELIBERATELY_UNALIGNED = new Set([
  'a_tzalan_ford',  // contested Kheshkai/Ndjadi crossing
  'qhabal_ur',      // Oravan-garrisoned, Ndjadi time-share
  'veyd_kirrha',    // four-tradition oracle, no formal treaty
  'dzong_kha',      // joint Ngaru-Bon + Kheshkai authority
  'tepet_apu',      // Kheshkai-Qollari mixed-clan truce site
  'tavakh_rubat',   // shared Irrah/Oravan administration (not Qollari)
])

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
let unaligned = 0
let disagreements = 0

function pipCiv(x, y) {
  for (const cp of civPolys) {
    if (pointInPolygon(x, y, cp.ring)) return cp.id
  }
  return null
}

for (const f of data.features) {
  if (f.geometry?.type !== 'Point') continue
  const id = f.properties?.id ?? '(no id)'
  const [x, y] = f.geometry.coordinates
  const matchedCiv = pipCiv(x, y)

  // Never touch deliberately-unaligned sites (canon: joint/contested/shared).
  if (DELIBERATELY_UNALIGNED.has(id)) {
    unaligned++
    continue
  }

  // Already authored: canon wins. Validate that geometry agrees, warn if not.
  if (f.properties?.civ) {
    skipped++
    if (matchedCiv && matchedCiv !== f.properties.civ) {
      disagreements++
      console.warn(`  DISAGREEMENT: ${id} authored '${f.properties.civ}', polygon '${matchedCiv}' — authored wins (check canon)`)
    }
    continue
  }

  // Untagged: assign by containment, or report as sea/strait.
  if (matchedCiv) {
    f.properties.civ = matchedCiv
    tagged++
  } else {
    unmatched++
    console.warn(`  unmatched: ${id} @ ${x.toFixed(1)},${y.toFixed(1)} (likely sea/strait)`)
  }
}

// Pretty-print to match the existing geojson formatting (2-space indent).
writeFileSync(PATH, JSON.stringify(data, null, 2) + '\n')

console.log(`Tagged: ${tagged}, already-tagged: ${skipped}, unaligned: ${unaligned}, unmatched: ${unmatched}, disagreements: ${disagreements}`)
