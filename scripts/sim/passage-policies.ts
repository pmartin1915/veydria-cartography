/**
 * passage-policies.ts — Choice + base policies for Passage-mode sim harness.
 *
 * Pure functions only. The downstream fork policy is fixed at
 * (base = survive, choice = cautious) so counterfactual continuations are
 * comparable across branches of the same signature instance.
 */

import type { JourneyState, Action } from '../../web/src/utils/journey-days'
import type { PendingEncounter, EncounterChoice, PassageState } from '../../web/src/utils/passage'
import type { ChoicePolicy, BasePolicy } from './passage-run'

/* ─── Choice-policy cost terms ─── */

export function weightedHit(c: EncounterChoice): number {
  const o = c.outcome
  return -(o.rationsDelta ?? 0) + 1.5 * -(o.waterDelta ?? 0)
}

export function cautious(pending: PendingEncounter, _journey: JourneyState): number {
  const choices = pending.choices
  const score = (c: EncounterChoice) => {
    const o = c.outcome
    const gravePenalty = o.risk === 'grave' ? 1000 : 0
    return weightedHit(c) + 0.5 * (o.daysDelta ?? 0) + gravePenalty
  }
  let best = 0
  for (let i = 1; i < choices.length; i++) {
    if (score(choices[i]) < score(choices[best])) best = i
  }
  return best
}

export function first(_pending: PendingEncounter, _journey: JourneyState): number {
  return 0
}

export function aggressive(pending: PendingEncounter, _journey: JourneyState): number {
  const choices = pending.choices
  let best = 0
  for (let i = 1; i < choices.length; i++) {
    const bi = choices[i].outcome.daysDelta ?? 0
    const bb = choices[best].outcome.daysDelta ?? 0
    if (bi < bb) {
      best = i
    } else if (bi === bb) {
      if (weightedHit(choices[i]) < weightedHit(choices[best])) best = i
    }
  }
  return best
}

export function spendy(pending: PendingEncounter, _journey: JourneyState): number {
  const choices = pending.choices
  const zeroDayIndices: number[] = []
  for (let i = 0; i < choices.length; i++) {
    if (!choices[i].outcome.daysDelta) zeroDayIndices.push(i)
  }
  if (zeroDayIndices.length > 0) {
    let best = zeroDayIndices[0]
    for (let i = 1; i < zeroDayIndices.length; i++) {
      const idx = zeroDayIndices[i]
      if (weightedHit(choices[idx]) < weightedHit(choices[best])) best = idx
    }
    return best
  }
  // No zero-day option: fall back to minimizing daysDelta.
  let best = 0
  for (let i = 1; i < choices.length; i++) {
    if ((choices[i].outcome.daysDelta ?? 0) < (choices[best].outcome.daysDelta ?? 0)) best = i
  }
  return best
}

export const CHOICE_POLICIES: Record<string, ChoicePolicy> = {
  first,
  cautious,
  aggressive,
  spendy,
}

export const CHOICE_POLICY_NAMES = Object.keys(CHOICE_POLICIES)

export function getChoicePolicy(name: string): ChoicePolicy {
  const p = CHOICE_POLICIES[name]
  if (!p) throw new Error(`Unknown choice policy: ${name}`)
  return p
}

/* ─── Base policies ─── */

export const survive: BasePolicy = (state: PassageState): Action => {
  if (state.journey.waterLeft <= 2 || state.journey.rationsLeft <= 2) {
    return { kind: 'ration' }
  }
  return { kind: 'continue' }
}

export const headlong: BasePolicy = (_state: PassageState): Action => {
  return { kind: 'continue' }
}

export const BASE_POLICIES: Record<string, BasePolicy> = {
  survive,
  headlong,
}

export const BASE_POLICY_NAMES = Object.keys(BASE_POLICIES)

export function getBasePolicy(name: string): BasePolicy {
  const p = BASE_POLICIES[name]
  if (!p) throw new Error(`Unknown base policy: ${name}`)
  return p
}

/** Fixed downstream policy for counterfactual continuations. */
export const DOWNSTREAM_BASE: BasePolicy = survive
export const DOWNSTREAM_CHOICE: ChoicePolicy = cautious
