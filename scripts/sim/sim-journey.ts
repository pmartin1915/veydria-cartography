/**
 * sim-journey.ts — Phase 1 of the AI sim harness (see SIM-HARNESS-ROADMAP.md)
 *
 * Single-shot CLI: takes (start, end, party, supply, season, mode) as flags,
 * runs one journey through the shared code path, prints the JSON trace.
 * The actual journey-driving lives in run-journey.ts so the batch runner
 * shares the exact same logic.
 *
 * Example:
 *   cd web
 *   npm run sim:journey -- --from ngaru_bon --to oravan --season summer
 *   npm run sim:journey -- --from ngaru_bon --to oravan --mode safest \
 *     --pace fast --rations 5 --water 3 --pretty
 *
 * Output: JSON on stdout. Pipe to jq or save as a baseline for diffing.
 */

import {
  buildGraphFromGeojson,
  runJourney,
  type JourneyInputs,
} from './run-journey'
import { POLICIES_LIST, type PolicyName } from './policies'
import type { PartyConfig, Season, RouteMode } from '../../web/src/utils/journey-graph'
import { DEFAULT_SUPPLY, type SupplyConfig } from '../../web/src/utils/journey-supply'

/* ─── CLI parsing (no dep — repo convention is `--key value`) ─── */

interface CliArgs extends JourneyInputs {
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
  const party: PartyConfig = {
    pace: oneOf(get('pace'), PACES, 'normal'),
    mount: oneOf(get('mount'), MOUNTS, 'foot'),
    size: oneOf(get('size'), SIZES, 'medium'),
    forcedMarch: has('forced-march'),
  }
  const supply: SupplyConfig = {
    rationsPerPerson: num('rations', DEFAULT_SUPPLY.rationsPerPerson),
    waterPerPerson: num('water', DEFAULT_SUPPLY.waterPerPerson),
    encumbrance: oneOf(get('encumbrance'), ENCUMB, DEFAULT_SUPPLY.encumbrance),
    packAnimals: oneOf(get('pack'), PACKS, DEFAULT_SUPPLY.packAnimals),
  }
  return {
    from: get('from') || 'ngaru_bon',
    to: get('to') || 'oravan',
    season: has('season') ? oneOf<Season>(get('season'), SEASONS, 'summer') : undefined,
    mode: oneOf<RouteMode>(get('mode'), MODES, 'fastest'),
    depart: has('depart') ? num('depart', 1) : undefined,
    party,
    supply,
    policy: has('policy') ? oneOf<PolicyName>(get('policy'), POLICIES_LIST, 'naive') : undefined,
    pretty: has('pretty'),
  }
}

/* ─── Main ─── */

const args = parseArgs(process.argv.slice(2))
const { pretty: _pretty, ...journeyInputs } = args
const graph = buildGraphFromGeojson()
const trace = runJourney(journeyInputs, graph)
process.stdout.write(JSON.stringify(trace, null, args.pretty ? 2 : 0) + '\n')
