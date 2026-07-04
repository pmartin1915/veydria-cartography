/**
 * sim-trail-report.ts — Grid aggregator for Trail-mode calibration.
 *
 * Sweeps (route × supply × partySize × season × huntPolicy × seed), writes
 * output/sim/trail-summary.csv, and prints a markdown calibration report to
 * stdout. Each section is tied to specific PROVISIONAL constants in trail.ts.
 *
 * Usage (run from web/):
 *   npm run sim:trail-report
 *   npm run sim:trail-report -- --seeds 50
 *
 * POLICY NOTE: Numbers are policy-conditioned. The hunt-when-low policy is
 * the representative baseline (exercises supplyStress constants). The
 * never-hunt column is the harsh bound (no ration source from hunts).
 * Compare both when tuning constants — the truth lives between them.
 *
 * DEAD-CONSTANT WARNING (printed in report header):
 * HUNT_ODDS keys 'Savanna', 'Forest', 'Highland', 'Scrubland' and
 * SEMI_ARID_BIOMES strings 'Savanna', 'Scrubland' are NOT reachable from
 * real geojson geometry. These biome names don't appear in veydria-spatial.geojson.
 * Only Desert/Sabkha/Steppe/Escarpment hit their specific HUNT_ODDS entries;
 * everything else falls to HUNT_ODDS.default / no-semi-arid pressure.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildGraphFromGeojson,
  loadGeojson,
  runTrail,
  type TrailInputs,
  type HuntPolicy,
  type SupplyPreset,
} from './trail-run'
import { table, pct } from './report-utils'
import type { Season } from '../../web/src/utils/journey-graph'

/* ─── CLI args ─── */

const argv = process.argv.slice(2)
const getArg = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}
const numArg = (k: string, def: number): number => {
  const v = getArg(k)
  if (v === undefined) return def
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`--${k} expects a number`)
  return n
}

const SEEDS_PER_CONFIG = numArg('seeds', 20)

/* ─── Grid definition ─── */

// NOTE: 'short' was irrah→'basin' through 2026-07-02 — findRoute has no alias
// resolution (node id is 'aethelian_basin'), so every historical short row was a
// No-Route sentinel (aborted, 0 days). aethelian_basin itself resolves but is a
// trivial 37 km / 2-day hop; khulut (177 km, ~7 est. days) is the shortest route
// that can actually exhibit a survival band. Historical short-row data is invalid.
const ROUTE_PAIRS: { from: string; to: string; label: string }[] = [
  { from: 'irrah',    to: 'khulut',    label: 'short'  },
  { from: 'irrah',    to: 'ngaru_bon', label: 'medium' },
  { from: 'kheshkai', to: 'oravan',    label: 'long'   },
]

const SUPPLY_PRESETS: SupplyPreset[] = ['caravan', 'standard', 'tight']
const PARTY_SIZES   = [2, 3, 4]
const SEASONS: Season[] = ['spring', 'summer']
const POLICIES: HuntPolicy[] = ['hunt-when-low', 'never-hunt', 'water-aware']

/* ─── Row type ─── */

interface Row {
  routeLabel:    string
  from:          string
  to:            string
  supply:        string
  partySize:     number
  season:        string
  policy:        string
  seed:          number
  outcome:       string
  daysElapsed:   number
  survivors:     number
  worsen:        number
  heal:          number
  deaths:        number
  huntAttempts:  number
  huntSuccess:   number
  supplyMargin:  number
  rank:          string
  routeKm:       number | null
  deathDaysCsv:  string
  // Water-recovery metrics (water-aware policy).
  forageAttempts: number
  forageSuccess:  number
  streamSurfaced: number
  streamRefills:  number
  contamHits:     number
  seepSurfaced:   number
  seepDug:        number
  seepSuccess:    number
  waterRecoveryPeaks: number
}

/* ─── Stat helpers ─── */

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

function fmt1(n: number): string { return n.toFixed(1) }

/* ─── Main ─── */

function main() {
  const geojson  = loadGeojson()
  const graph    = buildGraphFromGeojson()
  const features = geojson.features

  const rows: Row[] = []
  let done = 0
  const total =
    ROUTE_PAIRS.length * SUPPLY_PRESETS.length * PARTY_SIZES.length *
    SEASONS.length * POLICIES.length * SEEDS_PER_CONFIG

  process.stderr.write(`Trail calibration grid: ${total} runs\n`)

  for (const route of ROUTE_PAIRS) {
    for (const supply of SUPPLY_PRESETS) {
      for (const partySize of PARTY_SIZES) {
        for (const season of SEASONS) {
          for (const policy of POLICIES) {
            for (let s = 0; s < SEEDS_PER_CONFIG; s++) {
              // Spread seeds; avoid 0 (mulberry32(0) degenerates).
              const seed = s * 997 + 1

              const inputs: TrailInputs = {
                from: route.from,
                to:   route.to,
                season,
                mode: 'direct',
                supplyPreset: supply,
                partySize,
                runSeed: seed,
                huntPolicy: policy,
              }

              const t = runTrail(inputs, graph, features)

              rows.push({
                routeLabel:   route.label,
                from:         route.from,
                to:           route.to,
                supply,
                partySize,
                season,
                policy,
                seed,
                outcome:      t.outcome,
                daysElapsed:  t.daysElapsed,
                survivors:    t.survivors,
                worsen:       t.events.worsen,
                heal:         t.events.heal,
                deaths:       t.events.deaths,
                huntAttempts: t.huntAttempts,
                huntSuccess:  t.huntSuccess,
                supplyMargin: t.supplyMargin,
                rank:         t.rank,
                routeKm:      t.routeKm,
                deathDaysCsv: t.deathDays.join(';'),
                forageAttempts: t.forageAttempts,
                forageSuccess:  t.forageSuccess,
                streamSurfaced: t.streamSurfaced,
                streamRefills:  t.streamRefills,
                contamHits:     t.contamHits,
                seepSurfaced:   t.seepSurfaced,
                seepDug:        t.seepDug,
                seepSuccess:    t.seepSuccess,
                waterRecoveryPeaks: t.waterRecoveryPeaks,
              })

              done++
              if (done % 50 === 0) process.stderr.write(`  ${done}/${total}\n`)
            }
          }
        }
      }
    }
  }
  process.stderr.write(`  ${done}/${total} — done\n`)

  /* ─── Write CSV ─── */

  const here   = dirname(fileURLToPath(import.meta.url))
  const outDir = resolve(here, '../../output/sim')
  mkdirSync(outDir, { recursive: true })
  const csvPath = resolve(outDir, 'trail-summary.csv')

  const csvHeader = [
    'routeLabel','from','to','supply','partySize','season','policy','seed',
    'outcome','daysElapsed','survivors','worsen','heal','deaths',
    'huntAttempts','huntSuccess','supplyMargin','rank','routeKm','deathDays',
    'forageAttempts','forageSuccess','streamSurfaced','streamRefills','contamHits',
    'seepSurfaced','seepDug','seepSuccess','waterRecoveryPeaks',
  ].join(',')
  const csvLines = rows.map(r =>
    [
      r.routeLabel, r.from, r.to, r.supply, r.partySize, r.season, r.policy, r.seed,
      r.outcome, r.daysElapsed, r.survivors, r.worsen, r.heal, r.deaths,
      r.huntAttempts, r.huntSuccess, r.supplyMargin,
      `"${r.rank}"`, r.routeKm ?? '', `"${r.deathDaysCsv}"`,
      r.forageAttempts, r.forageSuccess, r.streamSurfaced, r.streamRefills, r.contamHits,
      r.seepSurfaced, r.seepDug, r.seepSuccess, r.waterRecoveryPeaks,
    ].join(','),
  )
  writeFileSync(csvPath, [csvHeader, ...csvLines].join('\n') + '\n')
  process.stderr.write(`CSV: ${csvPath}\n`)

  /* ─── Markdown calibration report ─── */

  const out: string[] = []

  out.push('# Trail Mode Calibration Report')
  out.push('')
  out.push(`> **All constants PROVISIONAL.** Edit trail.ts and re-run \`npm run sim:trail-report\`.`)
  out.push(`> Numbers conditioned on hunt-when-low policy unless stated. never-hunt = harsh bound.`)
  out.push(`> Grid: ${ROUTE_PAIRS.length} routes × ${SUPPLY_PRESETS.length} supply tiers × ${PARTY_SIZES.length} party sizes × ${SEASONS.length} seasons × ${POLICIES.length} policies × ${SEEDS_PER_CONFIG} seeds = ${total} runs`)
  out.push('')

  out.push('### Dead-constant vocabulary warning')
  out.push('The following keys are **not reachable** from real geojson geometry')
  out.push('and therefore never influence any sim run. Reconcile their spelling with actual geojson biome names')
  out.push('in a separate pass if you want per-biome tuning to bite.')
  out.push('')
  out.push('| Constant | Unreachable keys | Hits default instead |')
  out.push('| --- | --- | --- |')
  out.push('| HUNT_ODDS | Savanna, Forest, Highland, Scrubland | HUNT_ODDS.default (0.30 chance / 2 yield) |')
  out.push('| SEMI_ARID_BIOMES | Savanna, Scrubland | Geojson has "Highland savanna", "Miombo woodland", etc. |')
  out.push('| FORAGE_WATER_ODDS / STREAM_ODDS | (none listed) | These tables use the live geojson biome names; verify keys match current features. |')
  out.push('| Fully live | Desert, Sabkha, Steppe, Escarpment | Hit both HUNT_ODDS and ARID_BIOMES |')
  out.push('')

  /* 1. Outcome distribution */
  out.push('## 1. Outcome Distribution')
  out.push('')
  for (const policy of POLICIES) {
    const pr = rows.filter(r => r.policy === policy)
    if (pr.length === 0) continue
    const counts: Record<string, number> = {}
    for (const r of pr) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1
    out.push(`**${policy}** (n = ${pr.length})`)
    const outRows = Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => [k, String(v), pct(v, pr.length)])
    out.push(table(['outcome', 'n', '%'], outRows))
    out.push('')
  }

  /* 2. Survival (arrived%) by supply × route */
  out.push('## 2. Survival Rate by Supply × Route')
  out.push('')
  out.push('> Validates overall difficulty. Target: caravan should mostly arrive; tight should mostly fail on long routes.')
  out.push('')
  for (const policy of POLICIES) {
    out.push(`**${policy}**`)
    const hdrs = ['supply \\ route', ...ROUTE_PAIRS.map(r => r.label)]
    const srows = SUPPLY_PRESETS.map(supply => {
      const cells = ROUTE_PAIRS.map(route => {
        const sub = rows.filter(r =>
          r.policy === policy && r.supply === supply && r.routeLabel === route.label
        )
        const arr = sub.filter(r => r.outcome === 'arrived').length
        return pct(arr, sub.length)
      })
      return [supply, ...cells]
    })
    out.push(table(hdrs, srows))
    out.push('')
  }

  /* 3. Health transition rates */
  out.push('## 3. Health Transition Rates')
  out.push('')
  out.push('> Validates bidirectionality. Heal rate must be non-trivial — if heal ≈ 0 across all')
  out.push('> supply tiers, the 0.20 passive heal or 0.45 fort heal constant is too low.')
  out.push('> Heal only fires on clean days (severity=0 AND supplyStress=0).')
  out.push('')
  for (const policy of POLICIES) {
    const pr = rows.filter(r => r.policy === policy)
    const n  = pr.length
    if (n === 0) continue
    const tw  = pr.reduce((s, r) => s + r.worsen, 0)
    const th  = pr.reduce((s, r) => s + r.heal,   0)
    const td  = pr.reduce((s, r) => s + r.deaths,  0)
    const per = (x: number) => (x / n).toFixed(2)
    out.push(`**${policy}** (n = ${n})`)
    out.push(table(
      ['metric', 'total', 'per run'],
      [
        ['worsen events', String(tw), per(tw)],
        ['heal events',   String(th), per(th)],
        ['deaths',        String(td), per(td)],
        ['heal/worsen ratio', '—', tw > 0 ? (th / tw).toFixed(2) : '—'],
      ],
    ))
    out.push('')
  }

  /* 4. Death timing */
  out.push('## 4. Death Timing')
  out.push('')
  out.push('> Are deaths too early (constants too harsh) or too late / absent (too lenient)?')
  out.push('> Very ill members on clean days have 0.20 heal chance — deaths after day 3 indicate correct graduation.')
  out.push('')
  for (const policy of POLICIES) {
    const dd = rows
      .filter(r => r.policy === policy)
      .flatMap(r => r.deathDaysCsv ? r.deathDaysCsv.split(';').filter(Boolean).map(Number) : [])
    if (dd.length === 0) {
      out.push(`**${policy}**: no deaths recorded`)
      out.push('')
      continue
    }
    out.push(
      `**${policy}** (${dd.length} deaths): ` +
      `mean day ${fmt1(mean(dd))}, median ${fmt1(median(dd))}, ` +
      `earliest ${Math.min(...dd)}, latest ${Math.max(...dd)}`
    )
    out.push('')
  }

  /* 5. Per-config difficulty gradient */
  out.push('## 5. Difficulty Gradient (hunt-when-low, arrived%)')
  out.push('')
  out.push('> The curve Perry tunes against. Should form a clear supply-tier × route-length gradient.')
  out.push('> If caravan=tight at short route, base worsen chance (0.10) may be too high.')
  out.push('')
  const hwl = rows.filter(r => r.policy === 'hunt-when-low')
  const gradRows: string[][] = []
  for (const route of ROUTE_PAIRS) {
    for (const supply of SUPPLY_PRESETS) {
      for (const season of SEASONS) {
        const sub = hwl.filter(r =>
          r.routeLabel === route.label && r.supply === supply && r.season === season
        )
        if (sub.length === 0) continue
        const arr  = sub.filter(r => r.outcome === 'arrived').length
        const mS   = mean(sub.map(r => r.partySize > 0 ? r.survivors / r.partySize : 0))
        const mD   = mean(sub.map(r => r.daysElapsed))
        gradRows.push([
          route.label, supply, season,
          String(sub.length),
          pct(arr, sub.length),
          fmt1(mS * 100) + '%',
          fmt1(mD),
        ])
      }
    }
  }
  out.push(table(['route', 'supply', 'season', 'n', 'arrived%', 'survivor%', 'mean days'], gradRows))
  out.push('')

  /* 6. Rank distribution */
  out.push('## 6. Rank Distribution (hunt-when-low)')
  out.push('')
  out.push('> Validates scoreTrail() thresholds. "Trail Warden" requires all-survive + supplyMargin > 4.')
  out.push('')
  const rankCounts: Record<string, number> = {}
  for (const r of hwl) rankCounts[r.rank] = (rankCounts[r.rank] ?? 0) + 1
  const rankRows = Object.entries(rankCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => [k, String(v), pct(v, hwl.length)])
  out.push(table(['rank', 'n', '%'], rankRows))
  out.push('')

  /* 7. Hunt success rate */
  out.push('## 7. Hunt Success Rate (hunt-when-low only)')
  out.push('')
  out.push('> Validates HUNT_ODDS.chance. If huntAttempts = 0, biomeForEdge is not wired (bug).')
  out.push('> For fully-live biomes (Desert/Sabkha/Steppe/Escarpment) success rate will differ from default (0.30).')
  out.push('')
  const huntRows = rows.filter(r => r.policy !== 'never-hunt' && r.huntAttempts > 0)
  if (huntRows.length === 0) {
    out.push('**No hunt attempts recorded.** Verify biomeForEdge is wired (land routes should always surface hunts).')
  } else {
    const totAtt = huntRows.reduce((s, r) => s + r.huntAttempts, 0)
    const totSuc = huntRows.reduce((s, r) => s + r.huntSuccess, 0)
    out.push(`Overall: ${totAtt} attempts, ${totSuc} successes (${pct(totSuc, totAtt)})`)
    out.push('')
    const byRoute = ROUTE_PAIRS.map(route => {
      const sub = huntRows.filter(r => r.routeLabel === route.label)
      const att = sub.reduce((s, r) => s + r.huntAttempts, 0)
      const suc = sub.reduce((s, r) => s + r.huntSuccess, 0)
      return [route.label, String(att), String(suc), pct(suc, att)]
    })
    out.push(table(['route', 'attempts', 'successes', 'rate'], byRoute))
    out.push('')
  }

  /* 8. Water Recovery Levers (water-aware policy only) */
  out.push('## 8. Water Recovery Levers')
  out.push('')
  out.push('> Per route × supply, water-aware policy. Shows how much each new lever contributes.')
  out.push('')
  const waterAware = rows.filter(r => r.policy === 'water-aware')
  const waterRows: string[][] = []
  for (const route of ROUTE_PAIRS) {
    for (const supply of SUPPLY_PRESETS) {
      const sub = waterAware.filter(r => r.routeLabel === route.label && r.supply === supply)
      if (sub.length === 0) continue
      const arrived = sub.filter(r => r.outcome === 'arrived')
      const arrivedN = arrived.length / sub.length
      const hwl = rows.filter(r =>
        r.policy === 'hunt-when-low' && r.routeLabel === route.label && r.supply === supply
      )
      const hwlArrivedN = hwl.length > 0 ? hwl.filter(r => r.outcome === 'arrived').length / hwl.length : 0
      const delta = (arrivedN - hwlArrivedN) * 100
      waterRows.push([
        route.label,
        supply,
        fmt1(mean(sub.map(r => r.streamSurfaced))),
        `${sub.reduce((s, r) => s + r.forageAttempts, 0)} / ${sub.reduce((s, r) => s + r.forageSuccess, 0)}`,
        fmt1(mean(sub.map(r => r.seepSurfaced))),
        `${sub.reduce((s, r) => s + r.seepDug, 0)} / ${sub.reduce((s, r) => s + r.seepSuccess, 0)}`,
        fmt1(mean(arrived.map(r => r.waterRecoveryPeaks))),
        `${pct(arrived.length, sub.length)} (Δ ${delta >= 0 ? '+' : ''}${fmt1(delta)}%)`,
      ])
    }
  }
  out.push(table(
    ['route', 'supply', 'streams/run', 'forage att/succ', 'seeps/run', 'seep dug/succ', 'recovery peaks', 'arrived% (Δ hwl)'],
    waterRows,
  ))
  out.push('')

  process.stdout.write(out.join('\n') + '\n')
  process.stderr.write('Done.\n')
}

if (!process.env.VITEST) main()
