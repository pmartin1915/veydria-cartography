/**
 * policies.ts — Phase 3 baseline decision policies for the sim harness.
 *
 * A Policy is a pure function (state, options) → Action. It runs at the
 * top of each day, before nextDay() consumes the action. Policies must
 * be deterministic — same state → same action — so traces stay
 * reproducible. They read state.rationsLeft / waterLeft / exhaustionLevel
 * / route geometry, and pick from the Action grammar.
 *
 * The four baselines establish a survival-rate spread:
 *   naive        → no agency, always continue. Establishes the floor.
 *   greedy-speed → force-march by default, ration if supplies look tight.
 *   risk-averse  → rest on severe weather, ration on low supplies, turn back if both critical.
 *   human-like   → balanced: turn back if unrecoverable, sprint the last leg, otherwise continue.
 */

import type { JourneyState, Action } from '../../web/src/utils/journey-days'

export type PolicyName = 'naive' | 'greedy-speed' | 'risk-averse' | 'human-like'

export type Policy = (state: JourneyState) => Action

/* Severe weather strings emitted by journey-days WEATHER_POOLS. Risk-averse
 * uses these to decide whether to rest. Match on substrings since the pool
 * uses full prose lines and we want to flag the heavy-impact ones. */
const SEVERE_WEATHER_MARKERS = [
  'thunderhead', 'storm', 'squall', 'blizzard',
  'lethal', 'freeze', 'visibility to a spear-throw',
  'snow squall', 'hard frost', 'ice crystals',
]

function lastDayWeatherIsSevere(state: JourneyState): boolean {
  /* nextDay rolls weather inside; the policy sees state BEFORE the action is
   * applied. So "today's" weather isn't visible yet — we approximate via
   * the seed-derived sample. For simplicity, policies inspect the season-
   * dependent risk by deriving a deterministic dice roll here. */
  const localDay = (state.dayNum + 1) - state.dayOffset
  /* Reuse the same seed scheme as nextDay's rollWeather so the policy's
   * judgement aligns with the weather the day will actually surface. */
  const seedForDay = state.routeSeed + localDay * 7919
  const r = mulberry32(seedForDay)
  /* WEATHER_POOLS for a season has 6 entries; severe markers vary by season.
   * Heuristic: roll one uniform sample; treat top 1/3 as "severe-ish" in
   * winter/summer (the worst seasons) and top 1/6 otherwise. */
  const sample = r()
  const threshold = state.season === 'winter' || state.season === 'summer' ? 0.66 : 0.83
  void SEVERE_WEATHER_MARKERS /* kept exported for parity with prose docs */
  return sample > threshold
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6D2B79F5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* Days remaining at current burn rate (rough estimate, ignores biome /
 * resupply). Used by risk-averse and human-like to judge urgency. */
function estimateDaysLeft(rationsLeft: number, waterLeft: number, state: JourneyState): { rations: number; water: number } {
  const forcedR = state.party.forcedMarch ? 2.0 : 1.0
  const forcedW = state.party.forcedMarch ? 1.5 : 1.0
  const seasonR = state.season === 'winter' ? 1.25 : state.season === 'summer' ? 0.95 : 1.0
  const enc = state.supplyConstants.encMult
  const perDayR = enc * forcedR * seasonR
  const perDayW = enc * forcedW
  return {
    rations: perDayR > 0 ? rationsLeft / perDayR : Infinity,
    water: perDayW > 0 ? waterLeft / perDayW : Infinity,
  }
}

function daysToArrival(state: JourneyState): number {
  return state.totalDays - state.dayNum
}

/* ─── Baseline policies ─── */

export const naive: Policy = () => ({ kind: 'continue' })

/**
 * Greedy-speed — push hard. Force-march by default. Half-ration when
 * supplies thin, to stretch the budget. Never rests, never turns back.
 */
export const greedySpeed: Policy = (state) => {
  const remaining = estimateDaysLeft(state.rationsLeft, state.waterLeft, state)
  const toArrival = daysToArrival(state)
  /* If either supply would run out before arrival, ration. Otherwise force-march. */
  if (remaining.rations < toArrival || remaining.water < toArrival) {
    return { kind: 'ration' }
  }
  return { kind: 'force-march' }
}

/**
 * Risk-averse — protect the party. Rest on bad weather. Ration on first
 * low-supply signal. Turn back only when both rations and water look
 * unrecoverable (<= 2 days each and route remaining > 4).
 */
export const riskAverse: Policy = (state) => {
  const toArrival = daysToArrival(state)
  /* Unrecoverable: both supplies near zero AND too many days to push through. */
  if (state.rationsLeft <= 2 && state.waterLeft <= 2 && toArrival > 4) {
    return { kind: 'turn-back' }
  }
  if (lastDayWeatherIsSevere(state)) {
    return { kind: 'rest' }
  }
  if (state.rationsLeft <= 3 || state.waterLeft <= 3) {
    return { kind: 'ration' }
  }
  return { kind: 'continue' }
}

/**
 * Human-like — balanced GM-style play. Turn back if outcome is clearly
 * unrecoverable. Force-march the final 2 days to close out. Otherwise continue.
 */
export const humanLike: Policy = (state) => {
  const toArrival = daysToArrival(state)
  const remaining = estimateDaysLeft(state.rationsLeft, state.waterLeft, state)
  /* Unrecoverable shortfall: would run out > 2 days early on either. */
  if (remaining.rations < toArrival - 2 && remaining.water < toArrival - 2 && toArrival > 5) {
    return { kind: 'turn-back' }
  }
  /* Sprint the last 2 days if supplies allow. */
  if (toArrival <= 2 && remaining.rations >= toArrival && remaining.water >= toArrival) {
    return { kind: 'force-march' }
  }
  /* Conserve when supplies look just barely enough. */
  if (remaining.rations < toArrival + 1 || remaining.water < toArrival + 1) {
    return { kind: 'ration' }
  }
  return { kind: 'continue' }
}

export const POLICIES: Record<PolicyName, Policy> = {
  'naive': naive,
  'greedy-speed': greedySpeed,
  'risk-averse': riskAverse,
  'human-like': humanLike,
}

export const POLICIES_LIST: PolicyName[] = Object.keys(POLICIES) as PolicyName[]

export function getPolicy(name: PolicyName): Policy {
  const p = POLICIES[name]
  if (!p) throw new Error(`Unknown policy: ${name}`)
  return p
}
