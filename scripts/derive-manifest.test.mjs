#!/usr/bin/env node
/**
 * derive-manifest.test.mjs — Acceptance tests for scripts/derive-manifest.mjs
 * (PHASE1-SPEC.md A6.2). Run: node --test scripts/derive-manifest.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

import {
  generateManifest,
  renderManifest,
  matchSignatures,
  EXPECTED_SIGNATURE_COUNTS,
  REMOVED_IDS,
} from './derive-manifest.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const requireFromWeb = createRequire(resolve(ROOT, 'web', 'package.json'))
const YAML = requireFromWeb('yaml')

const positionsText = readFileSync(join(ROOT, 'data', 'positions.yaml'), 'utf8')
const svgText = readFileSync(join(ROOT, 'data', 'veydria-schematic.svg'), 'utf8')
const oldManifestText = readFileSync(join(ROOT, 'data', 'coordinate-manifest.yaml'), 'utf8')

const TODAY = '2026-11-11'
const gen = () =>
  generateManifest({ positionsText, svgText, oldManifestText, today: TODAY })
const { doc } = gen()

test('running twice gives identical output', () => {
  const a = renderManifest(generateManifest({ positionsText, svgText, oldManifestText, today: TODAY }).doc)
  const b = renderManifest(gen().doc)
  assert.equal(a, b)
})

test('every signature matches its listed count', () => {
  const shapes = matchSignatures(svgText)
  for (const [key, count] of Object.entries(EXPECTED_SIGNATURE_COUNTS)) {
    assert.ok(shapes[key], `shape ${key} resolved`)
    const matched = Array.isArray(shapes[key][0]) ? shapes[key].length : 1
    assert.equal(matched, count, `signature ${key}`)
  }
  // a zero-or-over match is a script error — matchSignatures must have thrown above
})

test('every old ID is present or in REMOVED_IDS', () => {
  const old = YAML.parse(oldManifestText)
  const oldIds = new Set()
  for (const section of ['civilizations', 'water', 'chokepoints', 'ports', 'contested_sites', 'oases', 'waystations', 'rivers', 'trade_routes']) {
    for (const id of Object.keys(old[section] ?? {})) oldIds.add(id)
  }
  for (const l of old.landmarks ?? []) oldIds.add(l.id)
  const newIds = new Set()
  for (const section of ['civilizations', 'water', 'chokepoints', 'ports', 'contested_sites', 'oases', 'waystations', 'rivers', 'trade_routes']) {
    for (const id of Object.keys(doc[section] ?? {})) newIds.add(id)
  }
  for (const l of doc.landmarks ?? []) newIds.add(l.id)
  const missing = [...oldIds].filter((id) => !newIds.has(id) && !REMOVED_IDS.has(id))
  assert.deepEqual(missing, [])
  assert.ok(REMOVED_IDS.has('ayn_salqat'))
  assert.equal(doc.oases.ayn_salqat, undefined)
})

test('every feature lies inside the 1200x800 frame', () => {
  const inFrame = (p) => p[0] >= 0 && p[0] <= 1200 && p[1] >= 0 && p[1] <= 800
  const checkRing = (ring, label) => {
    for (const p of ring) assert.ok(inFrame(p), `${label} vertex ${p} outside frame`)
  }
  for (const [id, c] of Object.entries(doc.civilizations)) {
    checkRing(c.polygon, `civilizations.${id}.polygon`)
    for (const [i, ring] of (c.extra_polygons ?? []).entries()) checkRing(ring, `civilizations.${id}.extra_polygons[${i}]`)
    assert.ok(inFrame(c.centroid), `civilizations.${id}.centroid`)
  }
  checkRing(doc.water.aethelian_basin.polygon, 'water.aethelian_basin')
  for (const section of ['chokepoints', 'ports', 'contested_sites', 'oases', 'waystations']) {
    for (const [id, e] of Object.entries(doc[section])) assert.ok(inFrame(e.coords), `${section}.${id}`)
  }
  for (const l of doc.landmarks) assert.ok(inFrame(l.coords), `landmark ${l.id}`)
  for (const [id, r] of Object.entries(doc.rivers)) checkRing(r.path, `rivers.${id}`)
  for (const [id, r] of Object.entries(doc.trade_routes)) {
    if (r.path) checkRing(r.path, `trade_routes.${id}`)
    if (r.paths) r.paths.forEach((p, i) => checkRing(p, `trade_routes.${id}.paths[${i}]`))
  }
})

test('ports, waystations and oases sit within 1 unit of the positions value', () => {
  const positions = YAML.parse(positionsText)
  const norm = (e) => [Math.round(e.x * 1200 * 10) / 10, Math.round(e.y * 800 * 10) / 10]
  const px = (e) => (e.px ? [Math.round(e.px[0] * 10) / 10, Math.round(e.px[1] * 10) / 10] : norm(e))
  const close = (a, b, label) => {
    assert.ok(Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1, `${label}: ${a} vs ${b}`)
  }
  for (const [slug, e] of Object.entries(positions.ports)) {
    close(doc.ports[slug.replace(/-/g, '_')].coords, norm(e), `ports.${slug}`)
  }
  for (const [slug, e] of Object.entries(positions.oases)) {
    close(doc.oases[slug.replace(/-/g, '_')].coords, norm(e), `oases.${slug}`)
  }
  for (const [id, e] of Object.entries(doc.waystations)) {
    const slug = id.replace(/_/g, '-')
    close(e.coords, px(positions.authored_places.places[slug]), `waystations.${id}`)
  }
})

test('spec-mandated part endpoints', () => {
  const hub = doc.trade_routes.aethelian_basin_hub
  assert.equal(hub.part_endpoints[1][1], 'the_neck', 'Basin Hub spur ends at the_neck')
  const relay = doc.trade_routes.highland_relay
  assert.equal(relay.part_endpoints[1][0], 'ki_mbuhari', 'Relay branch starts at ki_mbuhari')
  const caravan = doc.trade_routes.caravan_thread
  assert.equal(caravan.part_endpoints[5][1], 'tin_aghiz', 'frankincense crossing ends at tin_aghiz')
  assert.equal(caravan.part_endpoints[5][0], 'khulut', 'frankincense crossing starts at khulut')
})

test('metadata: version, layout, stable last_updated', () => {
  assert.equal(doc.metadata.version, '2.0.0')
  assert.equal(doc.metadata.layout, 'canon-2026-09-29')
  // Second run against the NEW manifest must not bump last_updated
  const newText = renderManifest(doc)
  const second = generateManifest({ positionsText, svgText, oldManifestText: newText, today: '2026-12-01' })
  assert.equal(second.doc.metadata.last_updated, doc.metadata.last_updated)
})
