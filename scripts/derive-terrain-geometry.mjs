#!/usr/bin/env node
/**
 * derive-terrain-geometry.mjs — derive data/terrain-geometry.yaml from the schematic
 *
 * The hard terrain lines (Kheshkai wall, Ngaru-Bon escarpment, southern rim crest), the land
 * shapes the manifest does not carry (northern arm, southern rim, the eight Oravan islands), the
 * Basin mouth cut line and the latitude grid. Matched by style signature (PHASE2-SPEC.md A1),
 * never by element ID; a signature matching the wrong count is an error.
 *
 * Usage:
 *   node scripts/derive-terrain-geometry.mjs           # write the file
 *   node scripts/derive-terrain-geometry.mjs --check   # exit 1 if output would differ
 */
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { createRequire } from 'module'
import { fileURLToPath, pathToFileURL } from 'url'
import { collectElements, matchBySignature, flattenPath, flattenPoints } from './derive-manifest.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SCHEMATIC_PATH = join(ROOT, 'data', 'veydria-schematic.svg')
const OUT_PATH = join(ROOT, 'data', 'terrain-geometry.yaml')
const requireFromWeb = createRequire(resolve(ROOT, 'web', 'package.json'))
const YAML = requireFromWeb('yaml')

const r1 = (v) => Math.round(v * 10) / 10
const round = (pts) => pts.map(([x, y]) => [r1(x), r1(y)])

// key -> signature; startsWith filters on the path `d`
const SIG = {
  'lines.kheshkai_wall': { tag: 'polyline', attrs: { stroke: '#4a2e12', 'stroke-width': '3' }, count: 1 },
  'lines.kheshkai_east_margin': { tag: 'path', attrs: { stroke: '#4a2e12', 'stroke-width': '1.2' }, startsWith: 'M 905 418', count: 1 },
  'lines.ngaru_bon_west_escarpment': { tag: 'path', attrs: { stroke: '#3a2e20', 'stroke-width': '1.1' }, count: 1 },
  'lines.ngaru_bon_east_edge': { tag: 'path', attrs: { stroke: '#5a4a35', 'stroke-dasharray': '5,2' }, count: 1 },
  'lines.southern_rim_crest': { tag: 'polyline', attrs: { stroke: '#6b4c2a', 'stroke-width': '1.4' }, count: 1 },
  'land.continent': { tag: 'path', attrs: { fill: '#c4a862' }, count: 1 },
  'land.north_arm': { tag: 'polygon', attrs: { fill: '#9fae5a' }, count: 1 },
  'land.southern_rim': { tag: 'polygon', attrs: { fill: '#8b7355' }, count: 1 },
  'land.oravan_islands': { tag: 'path', attrs: { stroke: '#3a7a3a' }, count: 8 },
}

function shapeOf(el) {
  return el.attrs.d ? flattenPath(el.attrs.d) : flattenPoints(el.attrs.points)
}

/** <line> elements with parsed numeric endpoints (collectElements skips <line>). */
function collectLines(svgText) {
  const out = []
  for (const m of svgText.matchAll(/<line\b[^>]*\/?>/g)) {
    const a = {}
    for (const am of m[0].matchAll(/([\w-]+)="([^"]*)"/g)) a[am[1]] = am[2]
    out.push(a)
  }
  return out
}

export function deriveTerrainGeometry(svgText) {
  const elements = collectElements(svgText)
  const doc = { lines: {}, land: {} }
  for (const [key, sig] of Object.entries(SIG)) {
    let matches = matchBySignature(elements, sig)
    if (sig.startsWith) matches = matches.filter((el) => (el.attrs.d || '').trim().startsWith(sig.startsWith))
    if (matches.length !== sig.count) {
      throw new Error(`signature ${key} matched ${matches.length} elements, expected ${sig.count}`)
    }
    const [section, name] = key.split('.')
    const shapes = matches.map((el) => round(shapeOf(el)))
    doc[section][name] = sig.count === 1 ? shapes[0] : shapes
  }

  const lines = collectLines(svgText)
  const mouth = lines.filter((a) => a.x1 === '283' && a.x2 === '283' && a.stroke === '#d6ecfa' && a['stroke-dasharray'] === '2,2')
  if (mouth.length !== 1) throw new Error(`basin_mouth matched ${mouth.length}, expected 1`)
  doc.basin_mouth = [[+mouth[0].x1, +mouth[0].y1], [+mouth[0].x2, +mouth[0].y2]]

  const grid = lines
    .filter((a) => a.stroke === '#fff' && a['stroke-dasharray'] === '3,5')
    .map((a) => +a.y1)
    .sort((p, q) => p - q)
  if (grid.length !== 7) throw new Error(`latitude grid matched ${grid.length}, expected 7`)
  const labels = [...svgText.matchAll(/>(\d+)N</g)].map((m) => +m[1]).sort((p, q) => q - p)
  if (labels.length !== 7) throw new Error(`latitude labels matched ${labels.length}, expected 7`)
  doc.latitude = grid.map((y, i) => ({ y, lat_n: labels[i] }))
  return doc
}

const HEADER = `# ============================================================
# Veydria terrain geometry — GENERATED, do not edit by hand.
# Derived from data/veydria-schematic.svg by scripts/derive-terrain-geometry.mjs
# (signatures: research/map-hardening/PHASE2-SPEC.md A1).
# Re-generate: node scripts/derive-terrain-geometry.mjs   Verify: --check
# Coordinates in the schematic viewBox (1200x800, y down, 4 km/unit).
# ============================================================
`

export function renderTerrainGeometry(doc) {
  return HEADER + YAML.stringify(doc, { flowCollectionPadding: false })
}

function main() {
  const out = renderTerrainGeometry(deriveTerrainGeometry(readFileSync(SCHEMATIC_PATH, 'utf8')))
  if (process.argv.includes('--check')) {
    let current = ''
    try { current = readFileSync(OUT_PATH, 'utf8') } catch { /* missing counts as stale */ }
    if (current.replace(/\r\n/g, '\n') !== out) {
      console.error('❌ data/terrain-geometry.yaml is out of date. Run: node scripts/derive-terrain-geometry.mjs')
      process.exit(1)
    }
    console.log('✅ data/terrain-geometry.yaml is up to date')
    return
  }
  writeFileSync(OUT_PATH, out)
  console.log('✅ Wrote data/terrain-geometry.yaml')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
