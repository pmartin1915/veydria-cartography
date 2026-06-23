/**
 * passage-run.ts — Shared Passage-mode harness code path.
 *
 * Mirrors `run-journey.ts`: pure utilities for playing a Passage-mode crossing
 * with pluggable base + choice policies, plus the counterfactual fork machinery
 * used by the batch report to measure choice quality.
 *
 * Design constraints (non-negotiable):
 *  - No cloning of JourneyState / PassageState. The engine functions are pure on
 *    their inputs, so we fork by calling them repeatedly from the same state.
 *  - Engine + passage.ts stay byte-for-byte untouched. This file is additive only.
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve, isAbsolute } from 'node:path'

import {
  findRouteWithFallback,
  type PartyConfig,
  type Season,
  type RouteMode,
} from '../../web/src/utils/journey-graph'
import {
  type JourneyState,
  type JourneyStateOpts,
  type Action,
} from '../../web/src/utils/journey-days'
import type { Encounter } from '../../web/src/utils/encounters'
import {
  initPassage as initPassageFromEngine,
  passageAct as passageActEngine,
  passageChoose as passageChooseEngine,
  SIGNATURE_CHOICES,
  type PassageState as PassageStateT,
  type PendingEncounter as PendingEncounterT,
  type EncounterChoice as EncounterChoiceT,
  type PassageOutcome as PassageOutcomeT,
} from '../../web/src/utils/passage'

type PassageState = PassageStateT
type PendingEncounter = PendingEncounterT
type EncounterChoice = EncounterChoiceT
type PassageOutcome = PassageOutcomeT

export type { PassageState, PendingEncounter, EncounterChoice, PassageOutcome }
import { buildGraphFromGeojson, getResupplyTier, type Graph } from './run-journey'

export type Graph = Graph
export { getResupplyTier }

export function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '../..')
}

export function resolveRepoRel(p: string): string {
  return isAbsolute(p) ? p : resolve(repoRoot(), p)
}

/* ─── Public types ─── */

export type ChoicePolicy = (pending: PendingEncounter, journey: JourneyState) => number
export type BasePolicy = (state: PassageState) => Action

export interface ResolvedChoice {
  key: string
  day: number
  chosenIndex: number
  offered: number
}

export interface BranchOutcome {
  index: number
  label: string
  risk: 'none' | 'minor' | 'grave'
  outcome: PassageOutcome
  finalRations: number
  finalWater: number
  totalDays: number
}

export interface Instance {
  key: string
  day: number
  offered: number
  branches: BranchOutcome[]
  baselineChosen: number
}

/* ─── Supply / party presets ─── */

export const PASSAGE_PARTY: PartyConfig = {
  pace: 'normal',
  mount: 'foot',
  size: 'medium',
  forcedMarch: false,
}

export const STANDARD_SUPPLY = {
  rationsPerPerson: 12,
  waterPerPerson: 6,
  encumbrance: 'normal' as const,
  packAnimals: 'none' as const,
}

export const CARAVAN_SUPPLY = {
  rationsPerPerson: 12,
  waterPerPerson: 6,
  encumbrance: 'normal' as const,
  packAnimals: 'caravan' as const,
}

export const SUPPLY_PRESETS: Record<string, typeof STANDARD_SUPPLY> = {
  standard: STANDARD_SUPPLY,
  caravan: CARAVAN_SUPPLY,
}

export const CIVS = ['ngaru_bon', 'irrah', 'kheshkai', 'qollari', 'ndjadi', 'oravan']
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']

/* ─── Build opts / init ─── */

export function makePassageOpts(
  graph: Graph,
  from: string,
  to: string,
  season: Season,
  mode: RouteMode,
  supply = STANDARD_SUPPLY,
  party = PASSAGE_PARTY,
): JourneyStateOpts | null {
  const { route } = findRouteWithFallback(graph, from, to, season, mode, party)
  if (!route) return null
  return {
    route,
    season,
    mode,
    edgeBiomes: undefined,
    departureDayOfYear: undefined,
    party,
    supply,
    graph,
    endId: to,
    resupplyTierFor: getResupplyTier,
  }
}

/* ─── Signature helpers ─── */

export function signatureKeysInState(state: PassageState): string[] {
  const keys = new Set<string>()
  for (const encs of state.journey.encountersByDay.values()) {
    for (const enc of encs) {
      if (enc.key && SIGNATURE_CHOICES[enc.key]) keys.add(enc.key)
    }
  }
  return [...keys]
}

export function countSignatureFiresPerCrossing(state: PassageState): Map<string, number> {
  const counts = new Map<string, number>()
  for (const encs of state.journey.encountersByDay.values()) {
    for (const enc of encs) {
      if (enc.key && SIGNATURE_CHOICES[enc.key]) {
        counts.set(enc.key, (counts.get(enc.key) ?? 0) + 1)
      }
    }
  }
  return counts
}

export function allInitialEncounters(state: PassageState): Encounter[] {
  const out: Encounter[] = []
  const days = [...state.journey.encountersByDay.keys()].sort((a, b) => a - b)
  for (const d of days) {
    out.push(...(state.journey.encountersByDay.get(d) ?? []))
  }
  return out
}

/* ─── Play loop ─── */

function currentDayLabel(state: PassageState): number {
  return state.journey.dayNum + state.extraDays
}

export function playPassage(
  state0: PassageState,
  basePolicy: BasePolicy,
  choicePolicy: ChoicePolicy,
): { state: PassageState; choices: ResolvedChoice[] } {
  let state = state0
  const choices: ResolvedChoice[] = []
  const cap = (state.journey.totalDays + 1) * 3
  let safety = cap
  while (state.outcome === 'in-progress' && safety-- > 0) {
    if (state.pending) {
      const idx = choicePolicy(state.pending, state.journey)
      choices.push({
        key: state.pending.encounter.key ?? 'unknown',
        day: currentDayLabel(state) + 1,
        chosenIndex: idx,
        offered: state.pending.choices.length,
      })
      state = passageChooseEngine(state, idx)
      continue
    }
    const before = state
    const action = basePolicy(state)
    state = passageActEngine(state, action)
    if (state === before) break
  }
  return { state, choices }
}

/* ─── Counterfactual fork ─── */

export function forkInstance(
  pendingState: PassageState,
  downstreamBase: BasePolicy,
  downstreamChoice: ChoicePolicy,
): BranchOutcome[] {
  if (!pendingState.pending) return []
  const choices = pendingState.pending.choices
  const key = pendingState.pending.encounter.key ?? 'unknown'
  const day = currentDayLabel(pendingState) + 1
  return choices.map((choice, index) => {
    let branch = passageChooseEngine(pendingState, index)
    const result = playPassage(branch, downstreamBase, downstreamChoice)
    const final = result.state
    return {
      index,
      label: choice.label,
      risk: choice.outcome.risk ?? 'none',
      outcome: final.outcome,
      finalRations: final.journey.rationsLeft,
      finalWater: final.journey.waterLeft,
      totalDays: final.journey.dayNum + final.extraDays,
    }
  })
}

/* ─── Walk with forks ─── */

export function walkWithForks(
  state0: PassageState,
  baselineBase: BasePolicy,
  baselineChoice: ChoicePolicy,
  downstreamBase: BasePolicy,
  downstreamChoice: ChoicePolicy,
): { finalState: PassageState; instances: Instance[] } {
  const instances: Instance[] = []
  let state = state0
  const cap = (state.journey.totalDays + 1) * 3
  let safety = cap
  while (state.outcome === 'in-progress' && safety-- > 0) {
    if (state.pending) {
      const branches = forkInstance(state, downstreamBase, downstreamChoice)
      const baselineChosen = baselineChoice(state.pending, state.journey)
      instances.push({
        key: state.pending.encounter.key ?? 'unknown',
        day: currentDayLabel(state) + 1,
        offered: state.pending.choices.length,
        branches,
        baselineChosen,
      })
      state = passageChooseEngine(state, baselineChosen)
      continue
    }
    const before = state
    const action = baselineBase(state)
    state = passageActEngine(state, action)
    if (state === before) break
  }
  return { finalState: state, instances }
}

/* ─── Metric helpers (pure, unit-testable) ─── */

export function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

function arrivedValue(outcome: PassageOutcome): number {
  return outcome === 'arrived' ? 1 : 0
}

export interface InstanceDominance {
  /** Index of a branch that dominates (≥ all others on arrived/water/rations), or null. */
  dominantIndex: number | null
  /** Set of branch indices that are best on at least one axis (arrived/water/rations). */
  bestOnAnyAxis: Set<number>
}

export function computeInstanceDominance(branches: BranchOutcome[]): InstanceDominance {
  let dominantIndex: number | null = null
  const bestOnAnyAxis = new Set<number>()
  for (let i = 0; i < branches.length; i++) {
    const bi = branches[i]
    // Strict (Pareto) dominance: bi must be >= every other branch on all axes
    // (arrived/water/rations) AND strictly > at least one branch on at least one
    // axis. A full three-way tie (every branch equal) is NOT dominance — it means
    // the choice is inert, which the differentiation/impact metrics report instead.
    // Weak dominance would false-flag such ties as a "fun-killer".
    let dominates = true
    let strictlyBetterSomewhere = false
    for (let j = 0; j < branches.length; j++) {
      if (i === j) continue
      const bj = branches[j]
      if (
        arrivedValue(bi.outcome) < arrivedValue(bj.outcome) ||
        bi.finalWater < bj.finalWater ||
        bi.finalRations < bj.finalRations
      ) {
        dominates = false
        break
      }
      if (
        arrivedValue(bi.outcome) > arrivedValue(bj.outcome) ||
        bi.finalWater > bj.finalWater ||
        bi.finalRations > bj.finalRations
      ) {
        strictlyBetterSomewhere = true
      }
    }
    if (dominates && strictlyBetterSomewhere) {
      // If multiple branches strictly dominate, report the first (lowest index).
      if (dominantIndex === null) dominantIndex = i
    }
    const bestArrived = branches.every(
      b => arrivedValue(bi.outcome) >= arrivedValue(b.outcome),
    )
    const bestWater = branches.every(b => bi.finalWater >= b.finalWater)
    const bestRations = branches.every(b => bi.finalRations >= b.finalRations)
    if (bestArrived || bestWater || bestRations) bestOnAnyAxis.add(i)
  }
  return { dominantIndex, bestOnAnyAxis }
}

export function countDistinctOutcomes(branches: BranchOutcome[]): number {
  return new Set(branches.map(b => b.outcome)).size
}

export interface Differentiation {
  waterRange: number
  rationsRange: number
}

export function computeDifferentiation(branches: BranchOutcome[]): Differentiation {
  const waters = branches.map(b => b.finalWater)
  const rations = branches.map(b => b.finalRations)
  return {
    waterRange: Math.max(...waters) - Math.min(...waters),
    rationsRange: Math.max(...rations) - Math.min(...rations),
  }
}

export interface PerKeyAggregates {
  key: string
  instances: number
  /** Per branch index: stats + ending counts. */
  branchStats: Map<
    number,
    {
      label: string
      risk: 'none' | 'minor' | 'grave'
      completed: number
      finalWaters: number[]
      finalRations: number[]
      totalDays: number[]
      outcomes: Map<PassageOutcome, number>
    }
  >
  dominanceFrequency: Map<number, number>
  deadFrequency: Map<number, number>
  outcomeImpactFraction: number
  medianWaterDiff: number
  medianRationsDiff: number
}

export function computePerKeyMetrics(instances: Instance[]): Map<string, PerKeyAggregates> {
  const byKey = new Map<string, PerKeyAggregates>()
  const waterDiffsByKey = new Map<string, number[]>()
  const rationsDiffsByKey = new Map<string, number[]>()
  for (const inst of instances) {
    let agg = byKey.get(inst.key)
    if (!agg) {
      agg = {
        key: inst.key,
        instances: 0,
        branchStats: new Map(),
        dominanceFrequency: new Map(),
        deadFrequency: new Map(),
        outcomeImpactFraction: 0,
        medianWaterDiff: 0,
        medianRationsDiff: 0,
      }
      byKey.set(inst.key, agg)
      waterDiffsByKey.set(inst.key, [])
      rationsDiffsByKey.set(inst.key, [])
    }
    agg.instances++
    const { dominantIndex, bestOnAnyAxis } = computeInstanceDominance(inst.branches)
    if (dominantIndex !== null) {
      agg.dominanceFrequency.set(
        dominantIndex,
        (agg.dominanceFrequency.get(dominantIndex) ?? 0) + 1,
      )
    }
    for (let i = 0; i < inst.branches.length; i++) {
      const b = inst.branches[i]
      let stats = agg.branchStats.get(i)
      if (!stats) {
        stats = {
          label: b.label,
          risk: b.risk,
          completed: 0,
          finalWaters: [],
          finalRations: [],
          totalDays: [],
          outcomes: new Map(),
        }
        agg.branchStats.set(i, stats)
      }
      if (b.outcome === 'arrived') stats.completed++
      stats.finalWaters.push(b.finalWater)
      stats.finalRations.push(b.finalRations)
      stats.totalDays.push(b.totalDays)
      stats.outcomes.set(b.outcome, (stats.outcomes.get(b.outcome) ?? 0) + 1)
      if (!bestOnAnyAxis.has(i)) {
        agg.deadFrequency.set(i, (agg.deadFrequency.get(i) ?? 0) + 1)
      }
    }
    if (countDistinctOutcomes(inst.branches) >= 2) {
      agg.outcomeImpactFraction += 1
    }
    const diff = computeDifferentiation(inst.branches)
    waterDiffsByKey.get(inst.key)!.push(diff.waterRange)
    rationsDiffsByKey.get(inst.key)!.push(diff.rationsRange)
  }
  for (const agg of byKey.values()) {
    agg.outcomeImpactFraction = agg.instances === 0 ? 0 : agg.outcomeImpactFraction / agg.instances
    agg.medianWaterDiff = median(waterDiffsByKey.get(agg.key) ?? [])
    agg.medianRationsDiff = median(rationsDiffsByKey.get(agg.key) ?? [])
  }
  return byKey
}

/* ─── Graph loader convenience ─── */

export function loadGraph(): Graph {
  return buildGraphFromGeojson()
}

/** Re-export the engine's passage primitives so callers (tests, playthrough)
 *  can build and step a PassageState from one import. */
export { initPassageFromEngine as initPassage }
export { passageActEngine as passageAct }
export { passageChooseEngine as passageChoose }
