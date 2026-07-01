/**
 * sim-trail.ts — Single-shot Trail-mode CLI.
 *
 * Runs one trail and prints a JSON TrailTrace to stdout. For eyeballing a single
 * run before calibrating constants, or piping to jq.
 *
 * Examples (run from web/):
 *   npm run sim:trail -- --from irrah --to ngaru_bon --season summer --supply tight --seed 42 --pretty
 *   npm run sim:trail -- --from kheshkai --to oravan --season winter --supply standard --party 4 --policy always-hunt
 *   npm run sim:trail -- --from irrah --to basin --pretty
 *
 * Flags:
 *   --from        start civ id (default: irrah)
 *   --to          destination civ id (default: ngaru_bon)
 *   --season      spring | summer | autumn | winter (omit for seasonless)
 *   --mode        direct | fastest | safest | cheapest (default: direct)
 *   --supply      caravan | standard | tight (default: standard)
 *   --party       number of trail members 2–5 (default: 3)
 *   --seed        integer run seed (default: 42)
 *   --policy      hunt-when-low | never-hunt | always-hunt (default: hunt-when-low)
 *   --pretty      pretty-print JSON
 */

import {
  buildGraphFromGeojson,
  loadGeojson,
  runTrail,
  type TrailInputs,
  type SupplyPreset,
  type HuntPolicy,
} from './trail-run'
import type { Season, RouteMode } from '../../web/src/utils/journey-graph'

/* ─── CLI parsing (repo convention: no arg lib, inline closures) ─── */

const SEASONS: Season[]         = ['spring', 'summer', 'autumn', 'winter']
const MODES: RouteMode[]        = ['direct', 'fastest', 'safest', 'cheapest']
const SUPPLY_OPTS: SupplyPreset[] = ['caravan', 'standard', 'tight']
const POLICY_OPTS: HuntPolicy[] = ['hunt-when-low', 'never-hunt', 'always-hunt']

function parseArgs(argv: string[]): TrailInputs & { pretty: boolean } {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  const has = (k: string): boolean => argv.includes(`--${k}`)
  const oneOf = <T extends string>(v: string | undefined, opts: readonly T[], fallback: T): T => {
    if (!v) return fallback
    if ((opts as readonly string[]).includes(v)) return v as T
    throw new Error(`Expected one of ${opts.join(', ')}, got ${JSON.stringify(v)}`)
  }
  const num = (k: string, def: number): number => {
    const v = get(k)
    if (v === undefined) return def
    const n = Number(v)
    if (!Number.isFinite(n)) throw new Error(`--${k} expects a number, got ${JSON.stringify(v)}`)
    return n
  }

  return {
    from:         get('from') ?? 'irrah',
    to:           get('to')   ?? 'ngaru_bon',
    season:       has('season') ? oneOf<Season>(get('season'), SEASONS, 'spring') : undefined,
    mode:         oneOf<RouteMode>(get('mode'), MODES, 'direct'),
    supplyPreset: oneOf<SupplyPreset>(get('supply'), SUPPLY_OPTS, 'standard'),
    partySize:    num('party', 3),
    runSeed:      num('seed', 42),
    huntPolicy:   oneOf<HuntPolicy>(get('policy'), POLICY_OPTS, 'hunt-when-low'),
    pretty:       has('pretty'),
  }
}

const { pretty, ...trailInputs } = parseArgs(process.argv.slice(2))
const geojson = loadGeojson()
const graph   = buildGraphFromGeojson()
const trace   = runTrail(trailInputs, graph, geojson.features)
process.stdout.write(JSON.stringify(trace, null, pretty ? 2 : 0) + '\n')
