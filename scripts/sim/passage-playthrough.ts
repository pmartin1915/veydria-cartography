/**
 * passage-playthrough.ts — One-off: the AI plays a single Passage-mode crossing
 * end to end and prints the journal as a readable story.
 *
 * Unlike the sim harness (which plays the ENGINE and never touches the choice
 * layer), this drives the real Passage seam — initPassage / passageAct /
 * passageChoose — so the ford/bandits/fever branching choices are actually
 * made. A first pass scans civ-pair x season crossings for one that triggers a
 * signature encounter, then plays the best candidate with a simple "cautious
 * traveler" policy and prints every day, choice, wait, and the ending.
 *
 * Throwaway evaluation aid (not wired into CI). Run:
 *   npm run -s sim:journey  # (for the engine trace)
 *   vite-node ../scripts/sim/passage-playthrough.ts
 */

import { findRouteWithFallback, type PartyConfig, type Season, type RouteMode } from '../../web/src/utils/journey-graph'
import { type Action } from '../../web/src/utils/journey-days'
import {
  initPassage,
  passageAct,
  passageChoose,
  type PassageState,
  type EncounterChoice,
} from '../../web/src/utils/passage'
import { buildGraphFromGeojson, getResupplyTier, type Graph } from './run-journey'

const CIVS = ['ngaru_bon', 'irrah', 'kheshkai', 'qollari', 'ndjadi', 'oravan']
const PARTY: PartyConfig = { pace: 'normal', mount: 'foot', size: 'medium', forcedMarch: false }
// Caravan supply (pack animals) — the most survivable preset, so a run is likely
// to live long enough to actually reach a signature choice.
const SUPPLY = { rationsPerPerson: 12, waterPerPerson: 6, encumbrance: 'normal' as const, packAnimals: 'caravan' as const }

function makeOpts(graph: Graph, from: string, to: string, season: Season, mode: RouteMode) {
  const { route } = findRouteWithFallback(graph, from, to, season, mode, PARTY)
  if (!route) return null
  return {
    route,
    season,
    mode,
    edgeBiomes: undefined,
    departureDayOfYear: undefined,
    party: PARTY,
    supply: SUPPLY,
    graph,
    endId: to,
    resupplyTierFor: getResupplyTier,
  }
}

/** How many signature encounters are bucketed in this journey's days. */
function countSignatures(state: PassageState): { count: number; keys: string[] } {
  const keys: string[] = []
  for (const encs of state.journey.encountersByDay.values()) {
    for (const e of encs) {
      if (e.key && (e.key === 'ford' || e.key === 'bandits' || e.key === 'fever')) keys.push(e.key)
    }
  }
  return { count: keys.length, keys }
}

/** Cautious traveler: avoid grave risk if possible, else minimize supply hit
 *  (water weighted heavier than rations; waiting a small soft cost). */
function chooseCautious(choices: EncounterChoice[]): number {
  const score = (c: EncounterChoice) => {
    const o = c.outcome
    const supplyHit = (o.rationsDelta ? -o.rationsDelta : 0) + (o.waterDelta ? -o.waterDelta : 0) * 1.5
    const dayCost = (o.daysDelta ?? 0) * 0.5
    const gravePenalty = o.risk === 'grave' ? 100 : 0
    return supplyHit + dayCost + gravePenalty
  }
  let best = 0
  for (let i = 1; i < choices.length; i++) if (score(choices[i]) < score(choices[best])) best = i
  return best
}

/** Base day action: ration when supply gets tight (to survive to the choices),
 *  otherwise press on. Never turn back — we want to see it through. */
function chooseAction(state: PassageState): Action {
  if (state.journey.waterLeft <= 2 || state.journey.rationsLeft <= 2) return { kind: 'ration' }
  return { kind: 'continue' }
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** Play a crossing headlessly with the cautious policy. Returns the finished
 *  state plus how many signature choices were actually resolved. */
function playOut(state0: PassageState): { state: PassageState; choicesMade: number } {
  let state = state0
  let choicesMade = 0
  let safety = (state.journey.totalDays + 1) * 3
  while (state.outcome === 'in-progress' && safety-- > 0) {
    if (state.pending) {
      state = passageChoose(state, chooseCautious(state.pending.choices))
      choicesMade++
      continue
    }
    const before = state
    state = passageAct(state, chooseAction(state))
    if (state === before) break
  }
  return { state, choicesMade }
}

function main() {
  const graph = buildGraphFromGeojson()

  // ── Scan for a crossing that actually REACHES a signature choice (and ideally arrives) ──
  process.stderr.write('Scanning crossings for a playable signature choice...\n')
  type Cand = {
    from: string; to: string; season: Season; mode: RouteMode
    keys: string[]; days: number; choicesMade: number; outcome: string
  }
  let best: Cand | null = null
  const seasons: Season[] = ['spring', 'summer', 'autumn', 'winter']
  const modes: RouteMode[] = ['cheapest', 'fastest', 'safest', 'direct']
  const rank = (c: Cand) =>
    (c.outcome === 'arrived' ? 1000 : 0) +     // prefer crossings that arrive
    c.choicesMade * 100 +                      // then ones with more resolved choices
    new Set(c.keys).size * 10 -                // then more distinct signature types
    Math.min(c.days, 99) * 0.01                // mild readability nudge toward shorter
  for (const from of CIVS) {
    for (const to of CIVS) {
      if (from === to) continue
      for (const season of seasons) {
        for (const mode of modes) {
          const opts = makeOpts(graph, from, to, season, mode)
          if (!opts) continue
          const state0 = initPassage(opts)
          const { count, keys } = countSignatures(state0)
          if (count === 0) continue
          const { state, choicesMade } = playOut(state0)
          if (choicesMade === 0) continue // never actually reached a choice
          const cand: Cand = { from, to, season, mode, keys, days: state0.journey.totalDays, choicesMade, outcome: state.outcome }
          if (!best || rank(cand) > rank(best)) best = cand
        }
      }
    }
  }

  if (!best) {
    process.stderr.write('No crossing reached a signature choice.\n')
    return
  }
  process.stderr.write(`Selected: ${best.from} → ${best.to} (${best.season}, ${best.mode}) · choices=${best.choicesMade} · outcome=${best.outcome}\n`)

  // ── Replay the chosen crossing, printing the journal ──
  const opts = makeOpts(graph, best.from, best.to, best.season, best.mode)!
  let state = initPassage(opts)
  const destName = state.journey.route.nodes[state.journey.route.nodes.length - 1]?.name ?? best.to
  const startName = state.journey.route.nodes[0]?.name ?? best.from

  const L: string[] = []
  L.push('═══════════════════════════════════════════════════════════════')
  L.push(`  A PASSAGE: ${startName} → ${destName}`)
  L.push(`  ${best.season}, on foot, normal pace · provisions: 12 rations / 6 water`)
  L.push(`  ${r1(state.journey.route.totalKm)} km · ~${state.journey.totalDays} days · signature beats waiting: ${best.keys.join(', ')}`)
  L.push('═══════════════════════════════════════════════════════════════')
  L.push('')

  // Buffer of plain travel days to collapse uneventful stretches.
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
          if (enc.key === 'ford' || enc.key === 'bandits' || enc.key === 'fever') continue // shown as a choice below
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
      // A signature encounter is on the table — show it, then choose.
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
      const pick = chooseCautious(choices)
      state = passageChoose(state, pick)
      emitNewEntries()
      continue
    }
    const before = state
    state = passageAct(state, chooseAction(state))
    if (state === before) break // no-op (stuck)
    emitNewEntries()
  }
  flushPlain()

  L.push('')
  L.push(`  Final ledger: ${r1(state.journey.rationsLeft)} rations · ${r1(state.journey.waterLeft)} water · outcome: ${state.outcome}`)
  L.push('═══════════════════════════════════════════════════════════════')

  process.stdout.write(L.join('\n') + '\n')
}

main()
