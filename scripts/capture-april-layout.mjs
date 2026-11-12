/**
 * capture-april-layout.mjs — snapshot the pre-Phase-1 (April) feature layout
 *
 * Reads data/coordinate-manifest.yaml exactly as it stood at bb76d8b (the
 * pre-Phase-1 master) via `git show`, and writes
 * web/src/generated/layout-april-positions.json. P1b uses this to re-anchor
 * persisted pins: a pin linked to a feature that exists in both this file
 * and the current geojson moves by (new position − April position).
 *
 * Two maps:
 *   points:    { id: [x, y] } — point features (ports, chokepoints, oases,
 *              contested sites, landmarks, waystations)
 *   centroids: { id: [x, y] } — civilization + water polygons (explicit
 *              manifest centroid, else vertex mean of the outer ring)
 *
 * Routes and rivers are NOT captured (P1b leaves route/river-linked pins
 * flagged for review rather than moving them).
 *
 * Run: node scripts/capture-april-layout.mjs   (from the repo root)
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { createRequire } from 'node:module'
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'package.json'))
const YAML = require('yaml')

const APRIL_REF = 'bb76d8b'
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_PATH = join(REPO_ROOT, 'web', 'src', 'generated', 'layout-april-positions.json')

const aprilYaml = execFileSync('git', ['show', `${APRIL_REF}:data/coordinate-manifest.yaml`], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
})
const manifest = YAML.parse(aprilYaml)

function ringCentroid(ring) {
  let cx = 0, cy = 0
  for (const [x, y] of ring) { cx += x; cy += y }
  return [cx / ring.length, cy / ring.length]
}

const points = {}
const centroids = {}

// Point sections of the manifest (id → { coords: [x, y], ... })
for (const section of ['chokepoints', 'ports', 'contested_sites', 'oases', 'waystations']) {
  for (const [id, entry] of Object.entries(manifest[section] ?? {})) {
    if (Array.isArray(entry.coords)) points[id] = entry.coords
  }
}
// Landmarks are a list, not a map
for (const lm of manifest.landmarks ?? []) {
  if (lm.id && Array.isArray(lm.coords)) points[lm.id] = lm.coords
}

// Civilization + water polygons
for (const [id, entry] of Object.entries(manifest.civilizations ?? {})) {
  if (Array.isArray(entry.centroid)) centroids[id] = entry.centroid
  else if (Array.isArray(entry.polygon)) centroids[id] = ringCentroid(entry.polygon)
}
for (const [id, entry] of Object.entries(manifest.water ?? {})) {
  if (Array.isArray(entry.centroid)) centroids[id] = entry.centroid
  else if (Array.isArray(entry.polygon)) centroids[id] = ringCentroid(entry.polygon)
}

const out = { layout: 'april-pre-phase1', ref: APRIL_REF, points, centroids }
mkdirSync(dirname(OUT_PATH), { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log(`✅ Wrote ${OUT_PATH} (${Object.keys(points).length} points, ${Object.keys(centroids).length} centroids)`)
