/**
 * passage-playthrough.ts — Readable single-run journal emitter for Passage mode.
 *
 * Accepts optional --from --to --season --mode; with no args it scans for a
 * choice-rich crossing that arrives and prints the journal. All choices are
 * resolved by the cautious choice policy + survive base policy.
 *
 * Run:
 *   npm run sim:passage-play
 *   npm run sim:passage-play -- --from kheshkai --to irrah --season winter --mode direct
 */

import { type Season, type RouteMode } from '../../web/src/utils/journey-graph'
import { type PassageState, SIGNATURE_CHOICES } from '../../web/src/utils/passage'
import {
  CIVS,
  SEASONS,
  CARAVAN_SUPPLY,
  PASSAGE_PARTY,
  makePassageOpts,
  initPassage,
  playPassage,
  signatureKeysInState,
  loadGraph,
} from './passage-run'
import { survive, cautious } from './passage-policies'

const r1 = (n: number) => Math.round(n * 10) / 10

interface CliArgs {
  from?: string
  to?: string
  season?: Season
  mode?: RouteMode
}

function parseArgs(argv: string[]): CliArgs {
  const get = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`)
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
  }
  return {
    from: get('from'),
    to: get('to'),
    season: get('season') as Season | undefined,
    mode: get('mode') as RouteMode | undefined,
  }
}

function fullySpecified(args: CliArgs): args is Required<CliArgs> {
  return args.from !== undefined && args.to !== undefined && args.season !== undefined && args.mode !== undefined
}

function playOut(state0: PassageState): { state: PassageState; choicesMade: number } {
  const { state, choices } = playPassage(state0, survive, cautious)
  return { state, choicesMade: choices.length }
}

type Cand = {
  from: string
  to: string
  season: Season
  mode: RouteMode
  keys: string[]
  days: number
  choicesMade: number
  outcome: string
}

function scan(graph: ReturnType<typeof loadGraph>): Cand | null {
  process.stderr.write('Scanning crossings for a playable signature choice...\n')
  const seasons = SEASONS
  const modes: RouteMode[] = ['cheapest', 'fastest', 'safest', 'direct']
  const rank = (c: Cand) =>
    (c.outcome === 'arrived' ? 1000 : 0) +
    c.choicesMade * 100 +
    new Set(c.keys).size * 10 -
    Math.min(c.days, 99) * 0.01
  let best: Cand | null = null
  for (const from of CIVS) {
    for (const to of CIVS) {
      if (from === to) continue
      for (const season of seasons) {
        for (const mode of modes) {
          const opts = makePassageOpts(graph, from, to, season, mode, CARAVAN_SUPPLY, PASSAGE_PARTY)
          if (!opts) continue
          const state0 = initPassage(opts)
          const keys = signatureKeysInState(state0)
          if (keys.length === 0) continue
          const { state, choicesMade } = playOut(state0)
          if (choicesMade === 0) continue
          const cand: Cand = {
            from,
            to,
            season,
            mode,
            keys,
            days: state0.journey.totalDays,
            choicesMade,
            outcome: state.outcome,
          }
          if (!best || rank(cand) > rank(best)) best = cand
        }
      }
    }
  }
  return best
}

function printJournal(state0: PassageState, meta: { from: string; to: string; season: Season; mode: RouteMode; keys: string[] }) {
  let state = state0
  const destName = state.journey.route.nodes[state.journey.route.nodes.length - 1]?.name ?? meta.to
  const startName = state.journey.route.nodes[0]?.name ?? meta.from

  const L: string[] = []
  L.push('═══════════════════════════════════════════════════════════════')
  L.push(`  A PASSAGE: ${startName} → ${destName}`)
  L.push(`  ${meta.season}, on foot, normal pace · provisions: 12 rations / 6 water`)
  L.push(`  ${r1(state.journey.route.totalKm)} km · ~${state.journey.totalDays} days · signature beats waiting: ${meta.keys.join(', ')}`)
  L.push('═══════════════════════════════════════════════════════════════')
  L.push('')

  let plainBuf: Array<{ day: number; r: number; w: number }> = []
  const flushPlain = () => {
    if (plainBuf.length === 0) return
    if (plainBuf.length <= 4) {
      for (const p of plainBuf) L.push(`  Day ${p.day}: the road. (rations ${r1(p.r)} / water ${r1(p.w)})`)
    } else {
      const a = plainBuf[0], b = plainBuf[plainBuf.length - 1]
      L.push(`  Days ${a.day}–${b.day}: steady road, no incident. (rations ${r1(a.r)}→${r1(b.r)} / water ${r1(a.w)}→${r1(b.w)})`)
    }
    plainBuf = []
  }

  let printedUpTo = 0
  const emitNewEntries = () => {
    for (let i = printedUpTo; i < state.log.length; i++) {
      const e = state.log[i]
      if (e.kind === 'day') {
        const sig = e.day.encounters
        const warn = e.supply.warning
        const interesting = sig.length > 0 || (warn && warn !== '')
        if (!interesting) {
          plainBuf.push({ day: e.dayLabel, r: e.supply.rationsLeft, w: e.supply.waterLeft })
          continue
        }
        flushPlain()
        L.push(`  Day ${e.dayLabel}: ${e.day.campLabel}. ${e.day.weather}`)
        for (const enc of e.day.encounters) {
          if (enc.key && SIGNATURE_CHOICES[enc.key]) continue // shown as a choice below
          L.push(`     · ${enc.narrative}`)
        }
        if (warn && warn !== '') L.push(`     ⚠ ${warn}`)
        L.push(`     (rations ${r1(e.supply.rationsLeft)} / water ${r1(e.supply.waterLeft)})`)
      } else if (e.kind === 'wait') {
        flushPlain()
        L.push(`  Day ${e.dayLabel} — held: ${e.narrative} (rations ${r1(e.supply.rationsLeft)} / water ${r1(e.supply.waterLeft)})`)
      } else if (e.kind === 'choice') {
        flushPlain()
        L.push(`     ▸ CHOSE: "${e.label}" [${e.risk}]`)
        L.push(`       ${e.narrative}`)
      } else if (e.kind === 'ending') {
        flushPlain()
        L.push('')
        L.push(`  ── ${e.outcome.toUpperCase()} (day ${e.dayLabel}) ──`)
        L.push(`  ${e.narrative}`)
      }
    }
    printedUpTo = state.log.length
  }

  const safetyMax = (state.journey.totalDays + 1) * 3
  let safety = safetyMax
  while (state.outcome === 'in-progress' && safety-- > 0) {
    if (state.pending) {
      flushPlain()
      const enc = state.pending.encounter
      const choices = state.pending.choices
      L.push('')
      L.push(`  ⚑ ENCOUNTER (day ${state.journey.dayNum + state.extraDays + 1}): ${enc.narrative}`)
      for (let i = 0; i < choices.length; i++) {
        const o = choices[i].outcome
        const cost: string[] = []
        if (o.rationsDelta) cost.push(`${o.rationsDelta} rations`)
        if (o.waterDelta) cost.push(`${o.waterDelta} water`)
        if (o.daysDelta) cost.push(`+${o.daysDelta}d`)
        L.push(`       [${i}] ${choices[i].label} (${cost.join(', ') || 'no cost'}) [${o.risk ?? 'none'}]`)
      }
      state = playPassage(state, survive, cautious).state
      emitNewEntries()
      continue
    }
    state = playPassage(state, survive, cautious).state
    emitNewEntries()
  }
  flushPlain()

  L.push('')
  L.push(`  Final ledger: ${r1(state.journey.rationsLeft)} rations · ${r1(state.journey.waterLeft)} water · outcome: ${state.outcome}`)
  L.push('═══════════════════════════════════════════════════════════════')

  process.stdout.write(L.join('\n') + '\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const graph = loadGraph()

  let meta: { from: string; to: string; season: Season; mode: RouteMode; keys: string[] }
  if (fullySpecified(args)) {
    meta = { from: args.from, to: args.to, season: args.season, mode: args.mode, keys: [] }
  } else {
    const best = scan(graph)
    if (!best) {
      process.stderr.write('No crossing reached a signature choice.\n')
      return
    }
    process.stderr.write(`Selected: ${best.from} → ${best.to} (${best.season}, ${best.mode}) · choices=${best.choicesMade} · outcome=${best.outcome}\n`)
    meta = best
  }

  const opts = makePassageOpts(graph, meta.from, meta.to, meta.season, meta.mode, CARAVAN_SUPPLY, PASSAGE_PARTY)
  if (!opts) {
    process.stderr.write(`No route found for ${meta.from} → ${meta.to}.\n`)
    return
  }
  const state0 = initPassage(opts)
  meta.keys = signatureKeysInState(state0)
  printJournal(state0, meta)
}

main()
