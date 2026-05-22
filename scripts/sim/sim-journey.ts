/**
 * sim-journey.ts — Phase 1 of the AI sim harness (see SIM-HARNESS-ROADMAP.md)
 *
 * Composes the journey planner's pure utils into a single CLI that emits a
 * full per-day trace for one (start, end, party, supply, season, mode) tuple.
 * No DOM, no React. Runs under vite-node so it can import the .ts utils
 * directly from web/src/utils/ without a build step.
 *
 * Example:
 *   cd web
 *   npm run sim:journey -- --from ngaru_bon --to oravan --season summer
 *   npm run sim:journey -- --from ngaru_bon --to oravan --mode safest \
 *     --pace fast --rations 5 --water 3 --pretty
 *
 * Output: JSON on stdout. Pipe to jq or save as a baseline for diffing.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import {
  buildGraph,
  findRouteWithFallback,
  type PartyConfig,
  type Season,
  type RouteMode,
} from '../../web/src/utils/journey-graph'
import { buildDailyBreakdown } from '../../web/src/utils/journey-days'
import { computeSupplyTimeline, type SupplyConfig } from '../../web/src/utils/journey-supply'

/* ─── CLI parsing (no dep — repo convention is `--key value`) ─── */

interface CliArgs {
  from: string
  to: string
  season?: Season
  mode: RouteMode
  depart?: number
  party: PartyConfig
  supply: SupplyConfig
  pretty: boolean
}

const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']
const MODES: RouteMode[] = ['direct', 'fastest', 'safest', 'cheapest']
const PACES = ['slow', 'normal', 'fast'] as const
const MOUNTS = ['foot', 'mounted'] as const
const SIZES = ['small', 'medium', 'large'] as const
const ENCUMB = ['light', 'normal', 'heavy'] as const
const PACKS = ['none', 'few', 'caravan'] as const

function parseArgs(argv: string[]): CliArgs {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  const has = (k: string): boolean => argv.includes(`--${k}`)
  const oneOf = <T extends string>(v: string | undefined, opts: readonly T[], fallback: T): T => {
    if (!v) return fallback
    if ((opts as readonly string[]).includes(v)) return v as T
    throw new Error(`--${opts.join('/')} got ${JSON.stringify(v)}, expected one of ${opts.join(', ')}`)
  }
  const num = (k: string, def: number): number => {
    const v = get(k)
    if (v === undefined) return def
    const n = Number(v)
    if (!Number.isFinite(n)) throw new Error(`--${k} got ${JSON.stringify(v)}, expected a number`)
    return n
  }
  return {
    from: get('from') || 'ngaru_bon',
    to: get('to') || 'oravan',
    season: has('season') ? oneOf<Season>(get('season'), SEASONS, 'summer') : undefined,
    mode: oneOf<RouteMode>(get('mode'), MODES, 'direct'),
    depart: has('depart') ? num('depart', 1) : undefined,
    party: {
      pace: oneOf(get('pace'), PACES, 'normal'),
      mount: oneOf(get('mount'), MOUNTS, 'foot'),
      size: oneOf(get('size'), SIZES, 'medium'),
      forcedMarch: has('forced-march'),
    },
    supply: {
      rationsPerPerson: num('rations', 7),
      waterPerPerson: num('water', 3),
      encumbrance: oneOf(get('encumbrance'), ENCUMB, 'normal'),
      packAnimals: oneOf(get('pack'), PACKS, 'none'),
    },
    pretty: has('pretty'),
  }
}

/* ─── Geojson load (relative to script location, not cwd) ─── */

function loadGeojson(): unknown {
  const here = dirname(fileURLToPath(import.meta.url))
  const path = resolve(here, '../../web/public/veydria-spatial.geojson')
  return JSON.parse(readFileSync(path, 'utf-8'))
}

/* ─── Trace assembly ─── */

interface Trace {
  inputs: CliArgs
  route: {
    found: boolean
    totalKm: number
    estimatedDays: number
    bottlenecks: string[]
    seasonalWarnings: string[]
    pivotIds: string[]
    nodeIds: string[]
    edgeCount: number
  } | null
  days: Array<{
    dayNum: number
    kmCovered: number
    startLabel: string
    campLabel: string
    weather: string
    notable: string[]
    encounters: Array<{ type: string; severity: string; biome?: string; beat: string }>
    calendarEvents: Array<{ name: string; civ?: string }>
    rationsLeft: number
    waterLeft: number
    rationsBurnedToday: number
    waterBurnedToday: number
    supplyWarning?: string
  }>
  summary: {
    daysCount: number
    completed: boolean
    finishedReason: 'arrived' | 'water-out' | 'rations-out' | 'no-route'
    encountersTotal: number
    encountersByType: Record<string, number>
    encountersBySeverity: Record<string, number>
    calendarEventsTotal: number
    rationsLowDay: number | null
    waterLowDay: number | null
    rationsOutDay: number | null
    waterOutDay: number | null
    finalRationsLeft: number
    finalWaterLeft: number
  }
}

function run(args: CliArgs): Trace {
  const geo = loadGeojson() as Parameters<typeof buildGraph>[0]
  const graph = buildGraph(geo)
  const { route, pivots } = findRouteWithFallback(
    graph,
    args.from,
    args.to,
    args.season,
    args.mode,
    args.party,
  )

  if (!route) {
    return {
      inputs: args,
      route: null,
      days: [],
      summary: {
        daysCount: 0,
        completed: false,
        finishedReason: 'no-route',
        encountersTotal: 0,
        encountersByType: {},
        encountersBySeverity: {},
        calendarEventsTotal: 0,
        rationsLowDay: null,
        waterLowDay: null,
        rationsOutDay: null,
        waterOutDay: null,
        finalRationsLeft: args.supply.rationsPerPerson,
        finalWaterLeft: args.supply.waterPerPerson,
      },
    }
  }

  const days = buildDailyBreakdown(
    route,
    args.season,
    args.mode,
    undefined, // edgeBiomes — Phase 1 omits biome lookup; arid penalty stays unapplied
    args.depart,
    args.party,
  )

  const supply = computeSupplyTimeline(
    days,
    args.party,
    args.supply,
    undefined,
    args.season,
  )

  // First day each supply threshold was hit (null = never).
  const firstWith = (pred: (s: (typeof supply)[number]) => boolean): number | null => {
    const hit = supply.find(pred)
    return hit ? hit.dayNum : null
  }
  const rationsOutDay = firstWith(s => s.rationsLeft <= 0)
  const waterOutDay = firstWith(s => s.waterLeft <= 0)
  const rationsLowDay = firstWith(s => s.rationsLeft <= 2 && s.rationsLeft > 0)
  const waterLowDay = firstWith(s => s.waterLeft <= 2 && s.waterLeft > 0)

  // "Completed" here means the party reached the arrival day before either
  // supply ran out. A more nuanced metric (party gives up early, GM rolls
  // foraging, etc.) is Phase 3 territory.
  const arrivalDay = days.length
  const ranOutBeforeArrival =
    (rationsOutDay !== null && rationsOutDay < arrivalDay) ||
    (waterOutDay !== null && waterOutDay < arrivalDay)
  const finishedReason: Trace['summary']['finishedReason'] = ranOutBeforeArrival
    ? (waterOutDay !== null && (rationsOutDay === null || waterOutDay <= rationsOutDay)
        ? 'water-out'
        : 'rations-out')
    : 'arrived'

  // Encounter rollups
  const encountersByType: Record<string, number> = {}
  const encountersBySeverity: Record<string, number> = {}
  let encountersTotal = 0
  let calendarEventsTotal = 0
  for (const d of days) {
    encountersTotal += d.encounters.length
    for (const e of d.encounters) {
      encountersByType[e.type] = (encountersByType[e.type] || 0) + 1
      encountersBySeverity[e.severity] = (encountersBySeverity[e.severity] || 0) + 1
    }
    calendarEventsTotal += d.calendarEvents?.length ?? 0
  }

  const tracedDays: Trace['days'] = days.map((d, i) => ({
    dayNum: d.dayNum,
    kmCovered: round(d.kmCovered),
    startLabel: d.startLabel,
    campLabel: d.campLabel,
    weather: d.weather,
    notable: d.notable,
    encounters: d.encounters.map(e => ({
      type: e.type,
      severity: e.severity,
      biome: e.biome,
      beat: e.beat,
    })),
    calendarEvents: (d.calendarEvents ?? []).map(c => ({ name: c.name, civ: (c as { civ?: string }).civ })),
    rationsLeft: round(supply[i].rationsLeft),
    waterLeft: round(supply[i].waterLeft),
    rationsBurnedToday: round(supply[i].rationsBurnedToday),
    waterBurnedToday: round(supply[i].waterBurnedToday),
    supplyWarning: supply[i].warning,
  }))

  return {
    inputs: args,
    route: {
      found: true,
      totalKm: round(route.totalKm),
      estimatedDays: round(route.estimatedDays),
      bottlenecks: route.bottlenecks,
      seasonalWarnings: route.seasonalWarnings,
      pivotIds: pivots.map(p => p.id),
      nodeIds: route.nodes.map(n => n.id),
      edgeCount: route.edges.length,
    },
    days: tracedDays,
    summary: {
      daysCount: days.length,
      completed: finishedReason === 'arrived',
      finishedReason,
      encountersTotal,
      encountersByType,
      encountersBySeverity,
      calendarEventsTotal,
      rationsLowDay,
      waterLowDay,
      rationsOutDay,
      waterOutDay,
      finalRationsLeft: round(supply[supply.length - 1]?.rationsLeft ?? args.supply.rationsPerPerson),
      finalWaterLeft: round(supply[supply.length - 1]?.waterLeft ?? args.supply.waterPerPerson),
    },
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/* ─── Main ─── */

const args = parseArgs(process.argv.slice(2))
const trace = run(args)
process.stdout.write(JSON.stringify(trace, null, args.pretty ? 2 : 0) + '\n')
