/**
 * sim-batch.ts — Phase 2 of the AI sim harness (see SIM-HARNESS-ROADMAP.md)
 *
 * Iterates a parameter grid (civ pairs × seasons × modes × supply presets ×
 * party presets) and emits two artifacts:
 *   - traces.jsonl: one full trace per line (the same shape sim-journey emits)
 *   - summary.csv:  one row per run with headline metrics + flattened inputs
 *
 * No engine forks. Calls the same runJourney() from run-journey.ts that the
 * single-shot CLI uses. The graph is built once and reused across runs.
 *
 * Example:
 *   cd web
 *   npm run sim:batch                                # full ~4,300-run grid
 *   npm run sim:batch -- --limit 5 --out ../output/sim-test
 *   npm run sim:batch -- --seasons summer --modes direct --supply standard
 */

import { closeSync, existsSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'

import {
  buildGraphFromGeojson,
  loadGeojson,
  runJourney,
  type JourneyInputs,
  type Trace,
} from './run-journey'
import { POLICIES_LIST, type PolicyName } from './policies'
import type { PartyConfig, Season, RouteMode } from '../../web/src/utils/journey-graph'
import type { SupplyConfig } from '../../web/src/utils/journey-supply'

/* ─── Presets (per SIM-HARNESS-ROADMAP.md lines 43-44) ─── */

const SUPPLY_PRESETS: Record<string, SupplyConfig> = {
  tight:    { rationsPerPerson: 3,  waterPerPerson: 2, encumbrance: 'light',  packAnimals: 'none' },
  standard: { rationsPerPerson: 12, waterPerPerson: 6, encumbrance: 'normal', packAnimals: 'none' },
  caravan:  { rationsPerPerson: 14, waterPerPerson: 7, encumbrance: 'heavy', packAnimals: 'caravan' },
}

const PARTY_PRESETS: Record<string, PartyConfig> = {
  'light-fast':  { pace: 'fast',   mount: 'foot', size: 'small',  forcedMarch: false },
  'standard':    { pace: 'normal', mount: 'foot', size: 'medium', forcedMarch: false },
  'heavy-slow':  { pace: 'slow',   mount: 'foot', size: 'large',  forcedMarch: false },
}

const ALL_SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']
const ALL_MODES: RouteMode[] = ['direct', 'fastest', 'safest', 'cheapest']
const ALL_SUPPLY = Object.keys(SUPPLY_PRESETS)
const ALL_PARTY = Object.keys(PARTY_PRESETS)

/* ─── CLI parsing ─── */

interface BatchArgs {
  outDir: string
  seasons: Season[]
  modes: RouteMode[]
  supplyPresets: string[]
  partyPresets: string[]
  fromCivs: string[] | null
  toCivs: string[] | null
  limit: number | null
  quiet: boolean
  /** Phase 3b: when null, legacy single-pass (no policy column); otherwise one run per (grid_point × policy). */
  policies: PolicyName[] | null
}

function parseArgs(argv: string[]): BatchArgs {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  const has = (k: string): boolean => argv.includes(`--${k}`)
  const csv = (v: string | undefined): string[] | null =>
    v === undefined ? null : v.split(',').map(s => s.trim()).filter(Boolean)
  const enumCsv = <T extends string>(v: string | undefined, opts: readonly T[], def: readonly T[]): T[] => {
    if (v === undefined) return [...def]
    const parts = csv(v) ?? []
    for (const p of parts) {
      if (!(opts as readonly string[]).includes(p)) {
        throw new Error(`${JSON.stringify(p)} not one of ${opts.join(', ')}`)
      }
    }
    return parts as T[]
  }
  const policyRaw = get('policy')
  let policies: PolicyName[] | null = null
  if (policyRaw !== undefined) {
    if (policyRaw === 'all') {
      policies = [...POLICIES_LIST]
    } else {
      const parts = (csv(policyRaw) ?? []) as string[]
      for (const p of parts) {
        if (!POLICIES_LIST.includes(p as PolicyName)) {
          throw new Error(`--policy got ${JSON.stringify(p)}, expected one of ${POLICIES_LIST.join(', ')} or 'all'`)
        }
      }
      policies = parts as PolicyName[]
    }
  }
  return {
    outDir: get('out') ?? defaultOutDir(),
    seasons: enumCsv<Season>(get('seasons'), ALL_SEASONS, ALL_SEASONS),
    modes: enumCsv<RouteMode>(get('modes'), ALL_MODES, ALL_MODES),
    supplyPresets: enumCsv(get('supply'), ALL_SUPPLY, ALL_SUPPLY),
    partyPresets: enumCsv(get('party'), ALL_PARTY, ALL_PARTY),
    fromCivs: csv(get('from-civs')),
    toCivs: csv(get('to-civs')),
    limit: get('limit') !== undefined ? Number(get('limit')) : null,
    quiet: has('quiet'),
    policies,
  }
}

function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../..')
}

function defaultOutDir(): string {
  return resolve(repoRoot(), 'output/sim')
}

function resolveOutDir(outDir: string): string {
  // Relative paths are repo-root-relative (not cwd-relative). npm runs
  // scripts from web/, so cwd-relative would be surprising; this matches
  // the default's behavior.
  return isAbsolute(outDir) ? outDir : resolve(repoRoot(), outDir)
}

/* ─── Civ discovery ─── */

function discoverCivs(): string[] {
  const geo = loadGeojson() as {
    features: Array<{ properties?: { id?: string; category?: string } }>
  }
  return geo.features
    .filter(f => f.properties?.category === 'civilization' && typeof f.properties.id === 'string')
    .map(f => f.properties!.id as string)
}

/* ─── Grid generation ─── */

export interface GridPoint {
  inputs: JourneyInputs
  supplyPreset: string
  partyPreset: string
}

function buildGrid(args: BatchArgs, civs: string[]): GridPoint[] {
  const fromList = args.fromCivs ?? civs
  const toList = args.toCivs ?? civs
  const points: GridPoint[] = []
  for (const from of fromList) {
    for (const to of toList) {
      if (from === to) continue
      for (const season of args.seasons) {
        for (const mode of args.modes) {
          for (const supplyPreset of args.supplyPresets) {
            for (const partyPreset of args.partyPresets) {
              points.push({
                inputs: {
                  from,
                  to,
                  season,
                  mode,
                  party: PARTY_PRESETS[partyPreset],
                  supply: SUPPLY_PRESETS[supplyPreset],
                },
                supplyPreset,
                partyPreset,
              })
            }
          }
        }
      }
    }
  }
  return args.limit != null ? points.slice(0, args.limit) : points
}

/* ─── CSV row shape ─── */

export interface SummaryRow {
  from: string
  to: string
  season: Season | ''
  mode: RouteMode
  /** Phase 3b: empty string on the legacy (no --policy) path. */
  policy: PolicyName | ''
  party_preset: string
  party_pace: string
  party_mount: string
  party_size: string
  party_forcedMarch: boolean
  supply_preset: string
  supply_rations: number
  supply_water: number
  supply_encumbrance: string
  supply_pack: string
  route_found: boolean
  total_km: number | ''
  estimated_days: number | ''
  days_count: number
  completed: boolean
  finished_reason: string
  encounters_total: number
  calendar_events_total: number
  rations_low_day: number | ''
  water_low_day: number | ''
  rations_out_day: number | ''
  water_out_day: number | ''
  final_rations_left: number
  final_water_left: number
  encounters_by_type_json: string
  encounters_by_severity_json: string
  /** Phase 4: count of full-restore nodes on the route (civilization + caravanserai).
   * Tests whether direct-mode routes geometrically bypass resupply stops. */
  civ_stops_on_route: number
  /** Phase 4: count of any non-'none' resupply nodes on the route (adds ports + oases). */
  resupply_stops_on_route: number
  error: string
  /** Phase 3b: action mix counts. Empty on the legacy (no --policy) path. Sum equals days_count. */
  action_continue: number | ''
  action_rest: number | ''
  action_force_march: number | ''
  action_ration: number | ''
  action_turn_back: number | ''
  action_reroute: number | ''
  /** Phase 3b: cumulative exhaustion at the final day. Empty on the legacy path. */
  exhaustion_final: number | ''
}

/* Two CSV schemas — legacy (no policy run) and policy. Switched at write time
 * so the no-flag invocation stays byte-identical with pre-Phase-3b output. */
export const LEGACY_COLUMNS: ReadonlyArray<keyof SummaryRow> = [
  'from', 'to', 'season', 'mode',
  'party_preset', 'party_pace', 'party_mount', 'party_size', 'party_forcedMarch',
  'supply_preset', 'supply_rations', 'supply_water', 'supply_encumbrance', 'supply_pack',
  'route_found', 'total_km', 'estimated_days',
  'days_count', 'completed', 'finished_reason',
  'encounters_total', 'calendar_events_total',
  'rations_low_day', 'water_low_day', 'rations_out_day', 'water_out_day',
  'final_rations_left', 'final_water_left',
  'encounters_by_type_json', 'encounters_by_severity_json',
  'civ_stops_on_route', 'resupply_stops_on_route',
  'error',
]

export const POLICY_COLUMNS: ReadonlyArray<keyof SummaryRow> = [
  'from', 'to', 'season', 'mode', 'policy',
  'party_preset', 'party_pace', 'party_mount', 'party_size', 'party_forcedMarch',
  'supply_preset', 'supply_rations', 'supply_water', 'supply_encumbrance', 'supply_pack',
  'route_found', 'total_km', 'estimated_days',
  'days_count', 'completed', 'finished_reason',
  'encounters_total', 'calendar_events_total',
  'rations_low_day', 'water_low_day', 'rations_out_day', 'water_out_day',
  'final_rations_left', 'final_water_left',
  'encounters_by_type_json', 'encounters_by_severity_json',
  'civ_stops_on_route', 'resupply_stops_on_route',
  'error',
  'action_continue', 'action_rest', 'action_force_march',
  'action_ration', 'action_turn_back', 'action_reroute',
  'exhaustion_final',
]

/* Action-mix counts derived from trace.days[].action. Only populated when a
 * policy ran. Returns the 6 counts + final exhaustion, all '' on the legacy path. */
export function computeActionMix(trace: Trace | null, policyRan: boolean): {
  action_continue: number | ''
  action_rest: number | ''
  action_force_march: number | ''
  action_ration: number | ''
  action_turn_back: number | ''
  action_reroute: number | ''
  exhaustion_final: number | ''
} {
  if (!policyRan || !trace) {
    return {
      action_continue: '', action_rest: '', action_force_march: '',
      action_ration: '', action_turn_back: '', action_reroute: '',
      exhaustion_final: '',
    }
  }
  let cont = 0, rest = 0, fm = 0, rat = 0, tb = 0, rr = 0
  for (const d of trace.days) {
    switch (d.action) {
      case 'continue':    cont++; break
      case 'rest':        rest++; break
      case 'force-march': fm++; break
      case 'ration':      rat++; break
      case 'turn-back':   tb++; break
      case 'reroute':     rr++; break
    }
  }
  const lastExh = trace.days.length > 0 ? (trace.days[trace.days.length - 1].exhaustionLevel ?? 0) : 0
  return {
    action_continue: cont, action_rest: rest, action_force_march: fm,
    action_ration: rat, action_turn_back: tb, action_reroute: rr,
    exhaustion_final: lastExh,
  }
}

export function toRow(
  point: GridPoint,
  trace: Trace | null,
  errorMessage: string,
  policy: PolicyName | null,
): SummaryRow {
  const { inputs, supplyPreset, partyPreset } = point
  const empty = '' as const
  const mix = computeActionMix(trace, policy !== null)

  if (!trace) {
    return {
      from: inputs.from,
      to: inputs.to,
      season: inputs.season ?? empty,
      mode: inputs.mode,
      policy: policy ?? empty,
      party_preset: partyPreset,
      party_pace: inputs.party.pace,
      party_mount: inputs.party.mount,
      party_size: inputs.party.size,
      party_forcedMarch: inputs.party.forcedMarch,
      supply_preset: supplyPreset,
      supply_rations: inputs.supply.rationsPerPerson,
      supply_water: inputs.supply.waterPerPerson,
      supply_encumbrance: inputs.supply.encumbrance,
      supply_pack: inputs.supply.packAnimals,
      route_found: false,
      total_km: empty,
      estimated_days: empty,
      days_count: 0,
      completed: false,
      finished_reason: 'error',
      encounters_total: 0,
      calendar_events_total: 0,
      rations_low_day: empty,
      water_low_day: empty,
      rations_out_day: empty,
      water_out_day: empty,
      final_rations_left: inputs.supply.rationsPerPerson,
      final_water_left: inputs.supply.waterPerPerson,
      encounters_by_type_json: '{}',
      encounters_by_severity_json: '{}',
      civ_stops_on_route: 0,
      resupply_stops_on_route: 0,
      error: errorMessage,
      ...mix,
    }
  }

  const r = trace.route
  const s = trace.summary
  return {
    from: inputs.from,
    to: inputs.to,
    season: inputs.season ?? empty,
    mode: inputs.mode,
    policy: policy ?? empty,
    party_preset: partyPreset,
    party_pace: inputs.party.pace,
    party_mount: inputs.party.mount,
    party_size: inputs.party.size,
    party_forcedMarch: inputs.party.forcedMarch,
    supply_preset: supplyPreset,
    supply_rations: inputs.supply.rationsPerPerson,
    supply_water: inputs.supply.waterPerPerson,
    supply_encumbrance: inputs.supply.encumbrance,
    supply_pack: inputs.supply.packAnimals,
    route_found: r !== null,
    total_km: r?.totalKm ?? empty,
    estimated_days: r?.estimatedDays ?? empty,
    days_count: s.daysCount,
    completed: s.completed,
    finished_reason: s.finishedReason,
    encounters_total: s.encountersTotal,
    calendar_events_total: s.calendarEventsTotal,
    rations_low_day: s.rationsLowDay ?? empty,
    water_low_day: s.waterLowDay ?? empty,
    rations_out_day: s.rationsOutDay ?? empty,
    water_out_day: s.waterOutDay ?? empty,
    final_rations_left: s.finalRationsLeft,
    final_water_left: s.finalWaterLeft,
    encounters_by_type_json: JSON.stringify(s.encountersByType),
    encounters_by_severity_json: JSON.stringify(s.encountersBySeverity),
    civ_stops_on_route: s.civStopsOnRoute,
    resupply_stops_on_route: s.resupplyStopsOnRoute,
    error: '',
    ...mix,
  }
}

/* ─── CSV serialization ─── */

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function writeCsv(path: string, rows: SummaryRow[], columns: ReadonlyArray<keyof SummaryRow>): void {
  const lines = [columns.join(',')]
  for (const row of rows) {
    lines.push(columns.map(col => csvCell(row[col])).join(','))
  }
  writeFileSync(path, lines.join('\n') + '\n', 'utf-8')
}

/* ─── Main ─── */

function main(): void {
  const args = parseArgs(process.argv.slice(2))

  const civs = discoverCivs()
  if (civs.length === 0) throw new Error('no civilizations found in geojson')

  const grid = buildGrid(args, civs)
  if (grid.length === 0) {
    process.stderr.write('no grid points to run (check filters)\n')
    process.exit(1)
  }

  const outDir = resolveOutDir(args.outDir)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const jsonlPath = resolve(outDir, 'traces.jsonl')
  const csvPath = resolve(outDir, 'summary.csv')

  const graph = buildGraphFromGeojson()
  const rows: SummaryRow[] = []
  const jsonlFd = openSync(jsonlPath, 'w')
  /* Per-policy aggregate counters. `null` key = legacy no-policy pass. */
  const perPolicy = new Map<PolicyName | null, { runs: number; routeFound: number; completed: number; waterOut: number; rationsOut: number }>()
  /* (mode, policy) → tally. policy is '' on legacy path. */
  const byModePolicy = new Map<string, { total: number; completed: number; mode: string; policy: string }>()
  /* When a policy is set, run all policies on each grid point; otherwise one no-policy pass. */
  const policyAxis: Array<PolicyName | null> = args.policies ?? [null]
  const totalRuns = grid.length * policyAxis.length

  const ensure = (p: PolicyName | null) => {
    let v = perPolicy.get(p)
    if (!v) { v = { runs: 0, routeFound: 0, completed: 0, waterOut: 0, rationsOut: 0 }; perPolicy.set(p, v) }
    return v
  }

  const startedAt = Date.now()
  let runIdx = 0
  try {
    for (let i = 0; i < grid.length; i++) {
      const point = grid[i]
      for (const policy of policyAxis) {
        const journeyInputs: JourneyInputs = policy === null
          ? point.inputs
          : { ...point.inputs, policy }
        let trace: Trace | null = null
        let errorMessage = ''
        try {
          trace = runJourney(journeyInputs, graph)
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : String(err)
        }

        const tally = ensure(policy)
        tally.runs++
        if (trace) {
          writeSync(jsonlFd, JSON.stringify(trace) + '\n')
          if (trace.route) tally.routeFound++
          if (trace.summary.completed) tally.completed++
          if (trace.summary.waterOutDay !== null) tally.waterOut++
          if (trace.summary.rationsOutDay !== null) tally.rationsOut++
          const key = `${point.inputs.mode}|${policy ?? ''}`
          let mp = byModePolicy.get(key)
          if (!mp) { mp = { total: 0, completed: 0, mode: point.inputs.mode, policy: policy ?? '' }; byModePolicy.set(key, mp) }
          mp.total++
          if (trace.summary.completed) mp.completed++
        }

        rows.push(toRow(point, trace, errorMessage, policy))

        runIdx++
        if (!args.quiet && runIdx % 50 === 0) {
          const tag = trace ? `completed=${trace.summary.completed} days=${trace.summary.daysCount}` : `error=${errorMessage}`
          const polTag = policy ? ` policy=${policy}` : ''
          process.stderr.write(
            `[${runIdx}/${totalRuns}] from=${point.inputs.from} to=${point.inputs.to} season=${point.inputs.season} mode=${point.inputs.mode}${polTag} ${tag}\n`,
          )
        }
      }
    }
  } finally {
    closeSync(jsonlFd)
  }

  const columns = args.policies === null ? LEGACY_COLUMNS : POLICY_COLUMNS
  writeCsv(csvPath, rows, columns)

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
  process.stderr.write('\n')
  process.stderr.write(`runs: ${totalRuns} (in ${elapsedSec}s)\n`)
  for (const [policy, t] of perPolicy.entries()) {
    const label = policy ?? '(none)'
    const pct = (n: number) => t.runs === 0 ? '–' : `${((n / t.runs) * 100).toFixed(1)}%`
    process.stderr.write(`\npolicy=${label}  runs=${t.runs}\n`)
    process.stderr.write(`  route_found: ${t.routeFound} (${pct(t.routeFound)})\n`)
    process.stderr.write(`  completed:   ${t.completed} (${pct(t.completed)})\n`)
    process.stderr.write(`  water_out:   ${t.waterOut} (${pct(t.waterOut)})\n`)
    process.stderr.write(`  rations_out: ${t.rationsOut} (${pct(t.rationsOut)})\n`)
  }
  process.stderr.write('\nby_mode:\n')
  const sorted = [...byModePolicy.values()].sort((a, b) =>
    a.mode === b.mode ? a.policy.localeCompare(b.policy) : a.mode.localeCompare(b.mode),
  )
  for (const s of sorted) {
    const ratePct = s.total === 0 ? '–' : `${((s.completed / s.total) * 100).toFixed(1)}%`
    const polTag = s.policy ? ` policy=${s.policy.padEnd(13)}` : ''
    process.stderr.write(`  ${s.mode.padEnd(10)}${polTag} ${s.completed}/${s.total} completed (${ratePct})\n`)
  }
  process.stderr.write(`\nartifacts:\n  ${jsonlPath}\n  ${csvPath}\n`)
}

/* Gate auto-run so tests can import this module without firing main(). vitest
 * sets process.env.VITEST; vite-node does not. */
if (!process.env.VITEST) main()
