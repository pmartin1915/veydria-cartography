// Bundle-size budget gate. Measures the gzipped size of every emitted JS chunk
// in web/dist2/assets and fails (exit 1) if the APP chunk (`index-*.js`) exceeds
// BUDGET. Prints a per-chunk table; vendor chunks (leaflet/d3/html-to-image) are
// shown for context but NOT gated — they only change on dependency bumps, whereas
// the index chunk grows with app code (the drift this gate exists to catch, e.g.
// the +14 kB party-config regression the roadmap flagged).
//
// The index chunk is the "~174 kB gzip" figure the project tracks in handoff notes
// (as reported by Vite's own build summary). Our zlib measurement may differ by a
// few kB from Vite's reporter due to gzip settings — the gate tracks *drift* against
// a fixed budget, so a small constant offset is harmless.
//
// Zero dependencies: node:fs + node:zlib only. Run from web/ as `npm run check:size`
// (after `npm run build`), or directly: node scripts/check-bundle-size.mjs

import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BUDGET = 200 * 1024 // 200 KiB gzipped — the app-chunk cap the project tracks.
const APP_CHUNK = /^index-.*\.js$/ // the gated chunk; everything else is vendor.

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(here, '..', 'web', 'dist2', 'assets')

let files
try {
  files = readdirSync(assetsDir).filter((f) => f.endsWith('.js'))
} catch {
  console.error(`✗ Could not read ${assetsDir}. Run \`npm run build\` first.`)
  process.exit(1)
}

if (files.length === 0) {
  console.error(`✗ No .js chunks found in ${assetsDir}. Did the build succeed?`)
  process.exit(1)
}

const fmt = (bytes) => `${(bytes / 1024).toFixed(2)} kB`
const rows = files
  .map((name) => ({
    name,
    gz: gzipSync(readFileSync(join(assetsDir, name))).length,
    gated: APP_CHUNK.test(name),
  }))
  .sort((a, b) => b.gz - a.gz)

const appBytes = rows.filter((r) => r.gated).reduce((sum, r) => sum + r.gz, 0)
const totalBytes = rows.reduce((sum, r) => sum + r.gz, 0)
const nameWidth = Math.max(...rows.map((r) => r.name.length), 'chunk'.length)

console.log(`\nBundle size (gzipped) — app-chunk budget ${fmt(BUDGET)}\n`)
console.log(`  ${'chunk'.padEnd(nameWidth)}   gzip        gated`)
console.log(`  ${'-'.repeat(nameWidth)}   --------    -----`)
for (const r of rows) {
  console.log(`  ${r.name.padEnd(nameWidth)}   ${fmt(r.gz).padStart(8)}    ${r.gated ? 'yes' : '—'}`)
}
console.log(`  ${'-'.repeat(nameWidth)}   --------    -----`)
console.log(`  ${'app (gated)'.padEnd(nameWidth)}   ${fmt(appBytes).padStart(8)}`)
console.log(`  ${'total (info)'.padEnd(nameWidth)}   ${fmt(totalBytes).padStart(8)}\n`)

if (appBytes === 0) {
  console.error(`✗ No app chunk matching ${APP_CHUNK} found — cannot enforce budget.`)
  process.exit(1)
}
if (appBytes > BUDGET) {
  console.error(`✗ App chunk over budget by ${fmt(appBytes - BUDGET)} (${fmt(appBytes)} > ${fmt(BUDGET)}).`)
  process.exit(1)
}
console.log(`✓ App chunk within budget (${fmt(BUDGET - appBytes)} headroom).\n`)
