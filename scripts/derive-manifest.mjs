#!/usr/bin/env node
/**
 * derive-manifest.mjs — Re-derive data/coordinate-manifest.yaml from canon
 *
 * Inputs (all synced, never edited here):
 *   - data/positions.yaml          worldbuilder canonical normalized positions
 *   - data/veydria-schematic.svg   canonical schematic (1200x800 viewBox)
 *   - data/coordinate-manifest.yaml  existing manifest (carry-over source)
 *
 * Geometry (coords, polygon, path, centroid, extra_polygons) comes from canon
 * (positions.yaml + schematic SVG). Every other field on an existing manifest
 * entry is carried over verbatim, matched by manifest ID. Any old manifest ID
 * that is not in the output and not in REMOVED_IDS is a script error, as is a
 * schematic signature that matches zero elements or more than listed.
 *
 * Usage:
 *   node scripts/derive-manifest.mjs           # write the manifest
 *   node scripts/derive-manifest.mjs --check   # exit 1 if output would differ
 */
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { createRequire } from 'module'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const POSITIONS_PATH = join(ROOT, 'data', 'positions.yaml')
const SCHEMATIC_PATH = join(ROOT, 'data', 'veydria-schematic.svg')
const MANIFEST_PATH = join(ROOT, 'data', 'coordinate-manifest.yaml')

// `yaml` is resolved from web/node_modules (same approach as sync-world-data.mjs)
const requireFromWeb = createRequire(resolve(ROOT, 'web', 'package.json'))
const YAML = requireFromWeb('yaml')

export const REMOVED_IDS = new Set(['ayn_salqat']) // canon: it has no marker

const W = 1200
const H = 800
const r1 = (v) => Math.round(v * 10) / 10
const pt = (x, y) => [r1(x), r1(y)]

/* ------------------------------------------------------------------ *
 * SVG parsing — match by style signature, never by element ID
 * ------------------------------------------------------------------ */

function parseAttrs(tag) {
  const attrs = {}
  for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]] = m[2]
  return attrs
}

/** Collect <path>/<polygon>/<polyline> elements (never <line>) with parsed attrs. */
function collectElements(svgText) {
  const elements = []
  for (const m of svgText.matchAll(/<(path|polygon|polyline)\b[^>]*\/?\s*>/g)) {
    elements.push({ tag: m[1], attrs: parseAttrs(m[0]) })
  }
  return elements
}

/**
 * Flatten a path `d` attribute (M, L, C, Z only) into a point list.
 * Every cubic C becomes 8 line segments.
 */
export function flattenPath(d) {
  const tokens = d.match(/[MLCZ]|-?\d+\.?\d*/g)
  if (!tokens) throw new Error(`unparseable path d: ${d.slice(0, 60)}`)
  const pts = []
  let cur = null
  let start = null
  let i = 0
  const num = () => {
    const v = parseFloat(tokens[i++])
    if (Number.isNaN(v)) throw new Error(`expected number in path: ${d.slice(0, 60)}`)
    return v
  }
  while (i < tokens.length) {
    const cmd = tokens[i++]
    if (cmd === 'M') {
      cur = [num(), num()]
      start = cur
      pts.push(cur)
    } else if (cmd === 'L') {
      cur = [num(), num()]
      pts.push(cur)
    } else if (cmd === 'C') {
      const p0 = cur
      const c1 = [num(), num()]
      const c2 = [num(), num()]
      const p1 = [num(), num()]
      for (let k = 1; k <= 8; k++) {
        const t = k / 8
        const u = 1 - t
        pts.push([
          u ** 3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * p1[0],
          u ** 3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * p1[1],
        ])
      }
      cur = p1
    } else if (cmd === 'Z') {
      if (start) pts.push([...start])
    } else {
      throw new Error(`unsupported path command ${cmd} in: ${d.slice(0, 60)}`)
    }
  }
  return pts
}

function flattenPoints(attr) {
  const nums = attr.match(/-?\d+\.?\d*/g).map(Number)
  const pts = []
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]])
  return pts
}

function roundPath(pts) {
  return pts.map(([x, y]) => pt(x, y))
}

/** Convex hull (monotone chain), closed by repeating the first vertex. */
function convexHullClosed(pts) {
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1))
  hull.push([...hull[0]])
  return roundPath(hull)
}

/** Signature matcher: exact attribute values, path/polygon/polyline only. */
function matchBySignature(elements, sig) {
  return elements.filter((el) => {
    if (sig.tag && el.tag !== sig.tag) return false
    for (const [k, v] of Object.entries(sig.attrs)) {
      if ((el.attrs[k] ?? null) !== v) return false
    }
    if (sig.absent) {
      for (const k of sig.absent) if (k in el.attrs) return false
    }
    return true
  })
}

function expectCount(matches, sig, label) {
  if (matches.length !== sig.count) {
    throw new Error(
      `signature ${label} matched ${matches.length} elements, expected ${sig.count}`
    )
  }
}

/**
 * The signature table from PHASE1-SPEC.md A2, as an explicit table.
 * Each entry: how to find the element(s) and how many must match.
 */
const SIG = {
  ngaru_bon: [{ tag: 'path', attrs: { fill: 'url(#crown)' }, count: 1 }],
  kheshkai: [{ tag: 'path', attrs: { fill: '#a8b86a' }, count: 1 }],
  irrah_north: [{ tag: 'polygon', attrs: { fill: '#d4a854' }, count: 1 }],
  irrah_se: [{ tag: 'path', attrs: { fill: '#dcc584' }, count: 1 }],
  ndjadi: [{ tag: 'path', attrs: { fill: '#3a8a3a' }, absent: ['stroke'], count: 1 }],
  qollari: [{ tag: 'path', attrs: { fill: '#2d6b3f' }, count: 1 }],
  oravan_islands: [{ tag: 'path', attrs: { stroke: '#3a7a3a' }, count: 8 }],
  basin: [{ tag: 'path', attrs: { fill: '#3a7ca5' }, count: 1 }],
  river_north: [{ tag: 'path', attrs: { stroke: '#4a8ab0', 'stroke-width': '1.4' }, startsWith: 'M 700 405', count: 1 }],
  river_west: [{ tag: 'path', attrs: { stroke: '#4a8ab0', 'stroke-width': '1.4' }, startsWith: 'M 468 505', count: 1 }],
  river_qollari_south: [{ tag: 'path', attrs: { stroke: '#4a8ab0', 'stroke-width': '1.4' }, startsWith: 'M 520 592', count: 1 }],
  river_trunk_east: [{ tag: 'path', attrs: { stroke: '#4a8ab0', 'stroke-width': '1.4' }, startsWith: 'M 800 592', count: 1 }],
  river_wall_east: [{ tag: 'path', attrs: { stroke: '#4a8ab0', 'stroke-width': '1.4' }, startsWith: 'M 830 413', count: 1 }],
  river_dists: [{ tag: 'path', attrs: { stroke: '#4a8ab0', 'stroke-width': '1.3' }, count: 5 }],
  copper_for_steel_road: [{ tag: 'path', attrs: { stroke: '#8b5e3c', 'stroke-dasharray': '4,3' }, count: 1 }],
  corridor: [{ tag: 'path', attrs: { stroke: '#d4a017', 'stroke-dasharray': '6,4' }, count: 2 }],
  relay: [{ tag: 'path', attrs: { stroke: '#3a8a3a', 'stroke-dasharray': '3,5' }, count: 2 }],
  coastal_monsoon: [{ tag: 'path', attrs: { stroke: '#4a8ab0', 'stroke-dasharray': '8,2,2,2' }, count: 1 }],
  basin_hub: [{ tag: 'path', attrs: { stroke: '#fff', 'stroke-width': '1.1', 'stroke-dasharray': '3,3' }, count: 2 }],
  caravan: [{ tag: 'path', attrs: { stroke: '#d4a854', 'stroke-width': '2', 'stroke-dasharray': '3,4' }, count: 5 }],
  frankincense: [{ tag: 'path', attrs: { stroke: '#d4a854', 'stroke-width': '1', 'stroke-dasharray': '1,3' }, count: 1 }],
}

export const EXPECTED_SIGNATURE_COUNTS = Object.fromEntries(
  Object.entries(SIG).map(([k, sigs]) => [k, sigs[0].count])
)

/** Match every signature against the SVG text and return the resolved shapes. */
export function matchSignatures(svgText) {
  const elements = collectElements(svgText)
  const shapes = {}
  for (const [key, sigs] of Object.entries(SIG)) {
    for (const sig of sigs) {
      let matches = matchBySignature(elements, sig)
      if (sig.startsWith) {
        matches = matches.filter((el) => (el.attrs.d || '').trim().startsWith(sig.startsWith))
      }
      expectCount(matches, sig, key)
      const pts = matches.map((el) =>
        el.attrs.d ? flattenPath(el.attrs.d) : flattenPoints(el.attrs.points)
      )
      shapes[key] = shapes[key] ? shapes[key].concat(pts) : pts
    }
  }
  // Per-shape structural checks from the spec table
  const [corridorA, corridorB] = shapes.corridor
  const shared = [860, 260]
  const eq = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6
  if (!eq(corridorA[corridorA.length - 1], shared) || !eq(corridorB[0], shared)) {
    throw new Error('highland_steppe_corridor elements do not join at (860,260)')
  }
  shapes.corridorJoined = [...corridorA, ...corridorB.slice(1)]
  // Basin hub ring: close it back to its first vertex
  const [ring, spur] = shapes.basin_hub
  if (!eq(ring[ring.length - 1], ring[0])) ring.push([...ring[0]])
  shapes.basin_hub_parts = [ring, spur]
  // Distributaries: number by end x ascending (west to east)
  shapes.river_dists_sorted = [...shapes.river_dists].sort(
    (a, b) => a[a.length - 1][0] - b[b.length - 1][0]
  )
  return shapes
}

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

function pointInRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

const titleCase = (slug) =>
  slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

/* ------------------------------------------------------------------ *
 * Manifest derivation
 * ------------------------------------------------------------------ */

export function generateManifest({ positionsText, svgText, oldManifestText, today }) {
  const positions = YAML.parse(positionsText)
  const old = YAML.parse(oldManifestText)
  const shapes = matchSignatures(svgText)

  const norm = (entry) => pt(entry.x * W, entry.y * H)
  const pxOf = (entry) => (entry.px ? pt(entry.px[0], entry.px[1]) : norm(entry))

  // --- Civilization polygons (derived) for endpoint containment tests ---
  const civPolygons = {
    ngaru_bon: roundPath(shapes.ngaru_bon[0]),
    irrah: roundPath(shapes.irrah_north[0]),
    kheshkai: roundPath(shapes.kheshkai[0]),
    ndjadi: roundPath(shapes.ndjadi[0]),
    qollari: roundPath(shapes.qollari[0]),
    oravan: convexHullClosed(shapes.oravan_islands.flat()),
  }
  const civExtraPolygons = { irrah: [roundPath(shapes.irrah_se[0])] }

  const civInOrder = ['ngaru_bon', 'irrah', 'kheshkai', 'ndjadi', 'qollari', 'oravan']
  const civilizations = {}
  for (const civ of civInOrder) {
    const carried = old.civilizations?.[civ] ?? {}
    const anchor = positions.regions[civ.replace(/_/g, '-')]?.label_anchor
    if (!anchor) throw new Error(`no label_anchor for region ${civ}`)
    const entry = {
      polygon: civPolygons[civ],
      ...(civExtraPolygons[civ] ? { extra_polygons: civExtraPolygons[civ] } : {}),
      centroid: norm(anchor),
      fill: carried.fill ?? '#888',
    }
    civilizations[civ] = entry
  }

  const water = {
    aethelian_basin: {
      polygon: roundPath(shapes.basin[0]),
      fill: old.water?.aethelian_basin?.fill ?? '#3a7ca5',
      fillOpacity: old.water?.aethelian_basin?.fillOpacity ?? 0.6,
    },
  }

  // --- Point features from positions ---
  const pointSections = (section, idFn = (s) => s.replace(/-/g, '_')) => {
    const out = {}
    for (const [slug, entry] of Object.entries(positions[section] ?? {})) {
      out[idFn(slug)] = norm(entry)
    }
    return out
  }
  const chokeCoords = pointSections('chokepoints')
  const portCoords = pointSections('ports')
  const oasisCoords = pointSections('oases')
  const contestedCoords = pointSections('sacred_sites')
  const mountainCoords = pointSections('mountains')

  const carriedPoint = (section, id) => {
    const c = old[section]?.[id]
    if (!c) throw new Error(`no carried entry ${section}.${id} in existing manifest`)
    return c
  }

  const pointEntry = (section, id, coords) => {
    const carried = carriedPoint(section, id)
    return { ...carried, coords }
  }

  const chokepointIds = ['lam_chen_pass', 'a_tzalan_ford', 'smith_spring', 'breath_of_cloud', 'qollari_cliff_roads', 'halkar_straits']
  const chokepoints = {}
  for (const id of chokepointIds) chokepoints[id] = pointEntry('chokepoints', id, chokeCoords[id])

  const portIds = ['ki_mbuhari', 'tavakh_qarat', 'halani_tamu', 'dzong_tamu']
  const ports = {}
  for (const id of portIds) ports[id] = pointEntry('ports', id, portCoords[id])

  const oasisIds = ['qarat_al_fidda', 'ghadam_thalla', 'tin_mashraq', 'khulut', 'zin_iferis']
  const oases = {}
  for (const id of oasisIds) oases[id] = pointEntry('oases', id, oasisCoords[id])

  const contestedIds = ['qhabal_ur', 'veyd_kirrha']
  const contested_sites = {}
  for (const id of contestedIds) contested_sites[id] = pointEntry('contested_sites', id, contestedCoords[id])

  // --- Landmarks ---
  const authored = positions.authored_places?.places ?? {}
  const landmarkCoords = {
    zang_ri: mountainCoords.zang_ri,
    apu_yana: mountainCoords.apu_yana,
    volata_xal: mountainCoords.volata_xal,
    halkar_port: pxOf(authored.halkar),
    kha_tepet: pxOf(authored['kha-tepet']),
    ki_jenga: pxOf(authored['ki-jenga']),
    hassag_nganin: pxOf(authored['hassag-nganin']),
    wasi_puma: pxOf(authored['wasi-puma']),
    first_caldera: pxOf(authored['first-caldera']),
    kelata: pxOf(authored.kelata),
  }
  const landmarkIds = Object.keys(landmarkCoords)
  const oldLandmarks = new Map((old.landmarks ?? []).map((l) => [l.id, l]))
  const landmarks = []
  for (const id of landmarkIds) {
    const carried = oldLandmarks.get(id)
    if (!carried) throw new Error(`no carried landmark ${id} in existing manifest`)
    landmarks.push({ ...carried, coords: landmarkCoords[id] })
  }
  const newLandmark = (slug, description) => {
    const a = authored[slug]
    if (!a) throw new Error(`authored place ${slug} missing`)
    if (!a.kind?.startsWith('landmark:')) throw new Error(`authored place ${slug} is not a landmark`)
    return {
      id: slug.replace(/-/g, '_'),
      name: titleCase(slug),
      coords: pxOf(a),
      type: a.kind.split(':')[1],
      description,
      marker_color: '#c4a862',
      marker_symbol: 'star',
      ...(a.civ ? { civ: a.civ } : {}),
    }
  }
  landmarks.push(
    newLandmark('morina', 'Northernmost island of the Oravan chain.'),
    newLandmark('arokar', 'Southernmost island of the Oravan chain.'),
    newLandmark(
      'the-neck',
      "The lowland gap between Qollari's north-east foothills and the west end of Kheshkai's wall, where the Ndjadi drains north to the Basin."
    )
  )

  // --- Waystations ---
  const waystationIds = ['tavakh_rubat', 'kelata_tamu', 'wasi_pukya', 'dzong_kha', 'tepet_apu', 'kalli_xal', 'zang_kalli', 'rubat_al_darb']
  const waystations = {}
  for (const id of waystationIds) {
    const slug = id.replace(/_/g, '-')
    const a = authored[slug]
    if (!a) throw new Error(`authored waystation ${slug} missing`)
    const carried = carriedPoint('waystations', id)
    waystations[id] = { ...carried, coords: pxOf(a) }
  }
  if (authored['tin-aghiz']?.kind !== 'waystation:port') {
    throw new Error('authored place tin-aghiz missing or not a waystation:port')
  }
  waystations.tin_aghiz = {
    category: 'port',
    coords: pxOf(authored['tin-aghiz']),
    in_world_name: 'Tin-Aghiz',
    description: "Frankincense port on Irrah's south-east coast, the southern terminus of the frankincense crossing.",
    marker_color: '#e8c840',
    marker_symbol: 'harbor',
    civ: 'irrah',
  }

  // --- Rivers ---
  const riverGeometry = {
    ndjadi_tributary_north: shapes.river_north[0],
    ndjadi_tributary_west: shapes.river_west[0],
    ndjadi_tributary_qollari_south: shapes.river_qollari_south[0],
    ndjadi_trunk_east: shapes.river_trunk_east[0],
    ndjadi_tributary_wall_east: shapes.river_wall_east[0],
  }
  shapes.river_dists_sorted.forEach((pts, i) => {
    riverGeometry[`ndjadi_dist_${i + 1}`] = pts
  })
  const NEW_RIVERS = {
    ndjadi_tributary_qollari_south: {
      name: 'Southern Tributary (from Qollari)',
      description: 'Flows from the southern Qollari foothills north into the trunk channel.',
    },
    ndjadi_trunk_east: {
      name: 'Eastern Trunk',
      description: 'Eastern trunk channel gathering the southern tributaries before the distributary fan.',
    },
    ndjadi_tributary_wall_east: {
      name: 'Eastern Wall Tributary (from Kheshkai)',
      description: 'Descends from the eastern Kheshkai wall into the trunk channel.',
    },
  }
  const riverIds = [
    'ndjadi_tributary_north',
    'ndjadi_tributary_west',
    'ndjadi_tributary_qollari_south',
    'ndjadi_trunk_east',
    'ndjadi_tributary_wall_east',
    'ndjadi_dist_1',
    'ndjadi_dist_2',
    'ndjadi_dist_3',
    'ndjadi_dist_4',
    'ndjadi_dist_5',
  ]
  const rivers = {}
  for (const id of riverIds) {
    const carried = old.rivers?.[id] ?? NEW_RIVERS[id]
    if (!carried) throw new Error(`no carried or authored river ${id}`)
    rivers[id] = { ...carried, path: roundPath(riverGeometry[id]) }
  }

  // --- Trade routes ---
  const resolveStop = (slug) => {
    const at = slug.match(/^off-map-west@(\d+\.?\d*)$/)
    if (at) return pt(0, parseFloat(at[1]))
    for (const section of ['ports', 'chokepoints', 'oases', 'mountains', 'sacred_sites', 'regions']) {
      const entry = positions[section]?.[slug]
      if (entry) return section === 'regions' ? norm(entry.label_anchor) : norm(entry)
    }
    const a = authored[slug]
    if (a) return pxOf(a)
    throw new Error(`cannot resolve route stop ${slug}`)
  }
  const stopPath = (stops) => stops.map(resolveStop)
  const routeStopPaths = {
    scribal_ladder: stopPath(positions.authored_places.routes['scribal-ladder'].stops),
    western_route: stopPath(positions.authored_places.routes['western-route'].stops),
  }

  const MULTI_PART = {
    highland_relay: [shapes.relay[0], shapes.relay[1]],
    aethelian_basin_hub: shapes.basin_hub_parts,
    caravan_thread: [...shapes.caravan, shapes.frankincense[0]],
  }

  const carriedRoute = (id) => {
    const c = old.trade_routes?.[id]
    if (!c) throw new Error(`no carried trade route ${id}`)
    return c
  }

  const trade_routes = {}
  const routeIds = [
    'copper_for_steel_road',
    'highland_steppe_corridor',
    'highland_relay',
    'coastal_monsoon',
    'caravan_thread',
    'scribal_ladder',
    'western_route',
    'aethelian_basin_hub',
  ]
  const singlePaths = {
    copper_for_steel_road: roundPath(shapes.copper_for_steel_road[0]),
    highland_steppe_corridor: roundPath(shapes.corridorJoined),
    coastal_monsoon: roundPath(shapes.coastal_monsoon[0]),
    scribal_ladder: routeStopPaths.scribal_ladder,
    western_route: routeStopPaths.western_route,
  }
  for (const id of routeIds) {
    if (MULTI_PART[id]) continue // filled below, after endpoints exist
    const carried = carriedRoute(id)
    trade_routes[id] = { path: singlePaths[id], style: carried.style }
  }

  // --- part_endpoints for multi-part routes ---
  // For each part's first and last vertex: nearest point feature within 20
  // units; else the civilization whose polygon contains the vertex; else error.
  const pointFeatures = []
  const addPoints = (section, map) => {
    for (const [id, coords] of Object.entries(map)) {
      pointFeatures.push({ id, coords, section })
    }
  }
  addPoints('ports', Object.fromEntries(Object.entries(ports).map(([k, v]) => [k, v.coords])))
  addPoints('oases', Object.fromEntries(Object.entries(oases).map(([k, v]) => [k, v.coords])))
  addPoints('waystations', Object.fromEntries(Object.entries(waystations).map(([k, v]) => [k, v.coords])))
  addPoints('chokepoints', Object.fromEntries(Object.entries(chokepoints).map(([k, v]) => [k, v.coords])))
  addPoints('contested_sites', Object.fromEntries(Object.entries(contested_sites).map(([k, v]) => [k, v.coords])))
  for (const lm of landmarks) pointFeatures.push({ id: lm.id, coords: lm.coords, section: 'landmarks' })

  const civContains = (x, y) => {
    for (const civ of civInOrder) {
      const rings = [civPolygons[civ], ...(civExtraPolygons[civ] ?? [])]
      for (const ring of rings) if (pointInRing(x, y, ring)) return civ
    }
    return null
  }
  const endpointId = (vertex, label) => {
    const [x, y] = vertex
    let best = null
    let bestDist = Infinity
    for (const p of pointFeatures) {
      const d = Math.hypot(p.coords[0] - x, p.coords[1] - y)
      if (d <= 20 && d < bestDist) {
        bestDist = d
        best = p.id
      }
    }
    if (best) return best
    const civ = civContains(x, y)
    if (civ) return civ
    throw new Error(`no endpoint feature or containing civilization for ${label} vertex (${x},${y})`)
  }
  const partEndpoints = (parts, label) =>
    parts.map((part, i) => [endpointId(part[0], `${label} part ${i + 1} start`), endpointId(part[part.length - 1], `${label} part ${i + 1} end`)])

  trade_routes.aethelian_basin_hub = {
    paths: MULTI_PART.aethelian_basin_hub.map(roundPath),
    part_endpoints: partEndpoints(MULTI_PART.aethelian_basin_hub, 'aethelian_basin_hub'),
    style: { color: '#ffffff', dash_array: '3,3', label: 'Aethelian Basin Hub' },
  }
  for (const id of ['highland_relay', 'caravan_thread']) {
    const carried = carriedRoute(id)
    trade_routes[id] = {
      paths: MULTI_PART[id].map(roundPath),
      part_endpoints: partEndpoints(MULTI_PART[id], id),
      style: carried.style,
    }
  }

  // --- ID accounting: every old ID present or in REMOVED_IDS ---
  const oldIds = new Set()
  for (const section of ['civilizations', 'water', 'chokepoints', 'ports', 'contested_sites', 'oases', 'waystations', 'rivers', 'trade_routes']) {
    for (const id of Object.keys(old[section] ?? {})) oldIds.add(id)
  }
  for (const l of old.landmarks ?? []) oldIds.add(l.id)
  const newIds = new Set()
  for (const section of ['civilizations', 'water', 'chokepoints', 'ports', 'contested_sites', 'oases', 'waystations', 'rivers', 'trade_routes']) {
    const doc = { civilizations, water, chokepoints, ports, contested_sites, oases, waystations, rivers, trade_routes }[section]
    for (const id of Object.keys(doc)) newIds.add(id)
  }
  for (const l of landmarks) newIds.add(l.id)
  const missing = [...oldIds].filter((id) => !newIds.has(id) && !REMOVED_IDS.has(id))
  if (missing.length) throw new Error(`old manifest IDs missing from output: ${missing.join(', ')}`)

  // --- Metadata ---
  const oldMeta = old.metadata ?? {}
  const body = {
    coordinate_system: old.coordinate_system,
    civilizations,
    water,
    chokepoints,
    ports,
    contested_sites,
    oases,
    landmarks,
    waystations,
    rivers,
    trade_routes,
  }
  const stripDate = (m) => {
    const c = { ...(m ?? {}) }
    delete c.last_updated
    return c
  }
  const newMetaBase = {
    version: '2.0.0',
    ...(oldMeta.author ? { author: oldMeta.author } : {}),
    layout: 'canon-2026-09-29',
    note: 'Generated by scripts/derive-manifest.mjs from data/positions.yaml and data/veydria-schematic.svg. Do not edit by hand; re-run the derive script.',
  }
  // last_updated = run date only when the derived content (everything except
  // last_updated) changed; otherwise keep the existing value so --check stays
  // stable across days.
  const contentChanged =
    stableStringify({ ...body, metadata: stripDate(newMetaBase) }) !==
    stableStringify({ ...old, metadata: stripDate(oldMeta) })
  const metadata = {
    ...newMetaBase,
    last_updated: contentChanged ? today : oldMeta.last_updated ?? today,
  }

  const doc = { ...body, metadata }
  return { doc, endpoints: Object.fromEntries(Object.entries(trade_routes).map(([k, v]) => [k, v.part_endpoints ?? null])) }
}

const HEADER = `# ============================================================
# Veydria Coordinate Manifest — Spatial Feature Positions
# ============================================================
# GENERATED FILE — do not edit by hand. This manifest is derived
# from data/positions.yaml (worldbuilder canonical positions) and
# data/veydria-schematic.svg (canonical schematic shapes) by
# scripts/derive-manifest.mjs.
#
# Re-generate with:  node scripts/derive-manifest.mjs
# Verify with:       node scripts/derive-manifest.mjs --check
# ============================================================
`

export function renderManifest(doc) {
  return HEADER + YAML.stringify(doc)
}

function main() {
  const checkMode = process.argv.includes('--check')
  const today = new Date().toISOString().slice(0, 10)
  const { doc } = generateManifest({
    positionsText: readFileSync(POSITIONS_PATH, 'utf8'),
    svgText: readFileSync(SCHEMATIC_PATH, 'utf8'),
    oldManifestText: readFileSync(MANIFEST_PATH, 'utf8'),
    today,
  })
  const out = renderManifest(doc)
  if (checkMode) {
    const current = readFileSync(MANIFEST_PATH, 'utf8')
    if (current !== out) {
      console.error('❌ data/coordinate-manifest.yaml is out of date. Run: node scripts/derive-manifest.mjs')
      process.exit(1)
    }
    console.log('✅ data/coordinate-manifest.yaml is up to date')
    return
  }
  writeFileSync(MANIFEST_PATH, out)
  console.log('✅ Wrote data/coordinate-manifest.yaml')
  const eps = Object.entries(doc.trade_routes)
    .filter(([, v]) => v.part_endpoints)
    .map(([k, v]) => `   ${k}: ${JSON.stringify(v.part_endpoints)}`)
  if (eps.length) console.log('part_endpoints:\n' + eps.join('\n'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
