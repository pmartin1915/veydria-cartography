/**
 * compare-summaries.mjs — A6.5: compare two sim:batch summary.csv files.
 *
 * Joins runs on (from,to,season,mode,party_preset,supply_preset) and reports
 * headline deltas: route-found, completion, median distance/day ratios, and
 * the largest per-run day swings. Used for the Phase 1 after-pass:
 *   stage1 (post-phase1-stage1) vs pre-phase1  → graph/topology effect at
 *                                                the OLD 2.5 km/unit scale
 *   stage2 (post-phase1)      vs stage1        → pure scale effect (2.5→4.0)
 *   stage2 vs pre-phase1                       → combined
 *
 * Usage: node scripts/sim/compare-summaries.mjs <a.csv> <b.csv> [label]
 */
import { readFileSync } from 'node:fs'

/** Minimal CSV parser (handles quoted fields with doubled quotes). */
function parseCsv(text) {
  const rows = []
  let field = '', row = [], inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  const header = rows.shift()
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

const KEY = ['from', 'to', 'season', 'mode', 'party_preset', 'supply_preset']
const keyOf = r => KEY.map(k => r[k]).join('|')
const num = v => (v === '' || v === undefined ? NaN : Number(v))
const median = xs => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`

function load(path) {
  const rows = parseCsv(readFileSync(path, 'utf-8'))
  const map = new Map()
  for (const r of rows) map.set(keyOf(r), r)
  return map
}

const [aPath, bPath, label] = process.argv.slice(2)
if (!aPath || !bPath) {
  console.error('usage: node scripts/sim/compare-summaries.mjs <a.csv> <b.csv> [label]')
  process.exit(1)
}
const A = load(aPath), B = load(bPath)
const tag = label ?? `${aPath} → ${bPath}`

const common = [...A.keys()].filter(k => B.has(k))
const onlyA = A.size - common.length, onlyB = B.size - common.length
console.log(`\n== ${tag} ==`)
console.log(`runs: ${aPath}=${A.size}  ${bPath}=${B.size}  common=${common.length}` +
  (onlyA || onlyB ? `  (only-in-a=${onlyA}, only-in-b=${onlyB})` : ''))

// route_found flips
let lost = 0, gained = 0
for (const k of common) {
  if (A.get(k).route_found === 'true' && B.get(k).route_found !== 'true') lost++
  if (A.get(k).route_found !== 'true' && B.get(k).route_found === 'true') gained++
}
console.log(`route_found: lost=${lost} gained=${gained}`)

// completion
const done = m => common.filter(k => m.get(k).completed === 'true').length
console.log(`completed: ${done(A)}/${common.length} (${pct(done(A), common.length)}) → ${done(B)}/${common.length} (${pct(done(B), common.length)})`)

// finished_reason distribution
for (const [name, m] of [['a', A], ['b', B]]) {
  const dist = {}
  for (const k of common) dist[m.get(k).finished_reason || '(none)'] = (dist[m.get(k).finished_reason || '(none)'] ?? 0) + 1
  console.log(`finished_reason (${name}):`, Object.entries(dist).sort((x, y) => y[1] - x[1]).map(([r, n]) => `${r}=${n}`).join(' '))
}

// median ratios on matched runs
const kmA = [], kmB = [], ratios = [], dayDeltas = []
for (const k of common) {
  const a = num(A.get(k).total_km), b = num(B.get(k).total_km)
  if (!Number.isNaN(a) && !Number.isNaN(b) && a > 0 && b > 0) { kmA.push(a); kmB.push(b); ratios.push(b / a) }
  const da = num(A.get(k).days_count), db = num(B.get(k).days_count)
  if (!Number.isNaN(da) && !Number.isNaN(db)) dayDeltas.push({ k, delta: db - da, a: da, b: db })
}
console.log(`total_km: median a=${median(kmA).toFixed(1)} b=${median(kmB).toFixed(1)} ratio(b/a)=${median(ratios).toFixed(3)}`)

// per-mode completion
for (const mode of ['direct', 'fastest', 'safest', 'cheapest']) {
  const ks = common.filter(k => k.split('|')[3] === mode)
  if (!ks.length) continue
  const ca = ks.filter(k => A.get(k).completed === 'true').length
  const cb = ks.filter(k => B.get(k).completed === 'true').length
  console.log(`  ${mode.padEnd(8)} completed ${pct(ca, ks.length)} → ${pct(cb, ks.length)}  (n=${ks.length})`)
}

// biggest day swings
dayDeltas.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
console.log('largest day_count swings (a → b):')
for (const d of dayDeltas.slice(0, 8)) {
  const [f, t, s, m, pp, sp] = d.k.split('|')
  console.log(`  ${f}→${t} ${s}/${m}/${pp}/${sp}: ${d.a} → ${d.b} (${d.delta >= 0 ? '+' : ''}${d.delta})`)
}
