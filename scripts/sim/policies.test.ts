/**
 * policies.test.ts — determinism + sanity checks for each baseline policy.
 *
 * Run from `web/`: `npm test -- policies`
 */

import { describe, it, expect } from 'vitest'
import { naive, greedySpeed, riskAverse, humanLike, getPolicy } from './policies'
import { initJourneyState } from '../../web/src/utils/journey-days'
import { DEFAULT_PARTY, type JourneyRoute } from '../../web/src/utils/journey-graph'
import { DEFAULT_SUPPLY } from '../../web/src/utils/journey-supply'

function makeRoute(opts: { edgeDays: number[]; totalKm: number }): JourneyRoute {
  const nodes = opts.edgeDays.map((_, i) => ({
    id: `n${i}`, name: `Node ${i}`, category: 'civilization', x: i * 100, y: 0,
  }))
  nodes.push({ id: `n${opts.edgeDays.length}`, name: `Node ${opts.edgeDays.length}`, category: 'civilization', x: opts.edgeDays.length * 100, y: 0 })
  const edges = opts.edgeDays.map((d, i) => ({
    from: nodes[i].id, to: nodes[i + 1].id,
    distanceSvg: d * 100,
    type: 'trade_route' as const,
    name: `Leg ${i}`,
    segmentDays: d,
  }))
  return {
    nodes, edges,
    totalDistanceSvg: opts.edgeDays.reduce((s, d) => s + d * 100, 0),
    totalKm: opts.totalKm,
    estimatedDays: opts.edgeDays.reduce((s, d) => s + d, 0),
    bottlenecks: [], seasonalWarnings: [],
  }
}

describe('policies: registry + determinism', () => {
  it('getPolicy returns each named policy', () => {
    expect(getPolicy('naive')).toBe(naive)
    expect(getPolicy('greedy-speed')).toBe(greedySpeed)
    expect(getPolicy('risk-averse')).toBe(riskAverse)
    expect(getPolicy('human-like')).toBe(humanLike)
  })

  it('each policy is deterministic — same state produces same action', () => {
    const route = makeRoute({ edgeDays: [2, 2, 1], totalKm: 125 })
    const stateA = initJourneyState({ route, season: 'summer', mode: 'direct', supply: DEFAULT_SUPPLY })
    const stateB = initJourneyState({ route, season: 'summer', mode: 'direct', supply: DEFAULT_SUPPLY })
    for (const p of [naive, greedySpeed, riskAverse, humanLike]) {
      expect(p(stateA)).toEqual(p(stateB))
    }
  })
})

describe('policies: naive', () => {
  it('always returns {kind:"continue"}', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    const state = initJourneyState({ route, season: 'spring', mode: 'direct' })
    expect(naive(state)).toEqual({ kind: 'continue' })
  })
})

describe('policies: greedy-speed', () => {
  it('force-marches when supplies are abundant relative to distance', () => {
    const route = makeRoute({ edgeDays: [1, 1], totalKm: 50 }) /* 2-day route */
    const state = initJourneyState({
      route, season: 'spring', mode: 'direct',
      supply: { ...DEFAULT_SUPPLY, rationsPerPerson: 30, waterPerPerson: 30 }, /* lots of supply */
    })
    expect(greedySpeed(state)).toEqual({ kind: 'force-march' })
  })

  it('rations when supplies tight vs. distance', () => {
    const route = makeRoute({ edgeDays: Array(20).fill(1), totalKm: 500 }) /* 20-day route */
    const state = initJourneyState({
      route, season: 'summer', mode: 'direct',
      supply: { ...DEFAULT_SUPPLY, rationsPerPerson: 7, waterPerPerson: 3 }, /* below need */
    })
    expect(greedySpeed(state)).toEqual({ kind: 'ration' })
  })
})

describe('policies: risk-averse', () => {
  it('turns back when both supplies near zero and route far from end', () => {
    const route = makeRoute({ edgeDays: Array(15).fill(1), totalKm: 300 }) /* 15-day route, lots remaining */
    let state = initJourneyState({ route, season: 'summer', mode: 'direct', supply: DEFAULT_SUPPLY })
    /* Force the state into a critical-supply scenario. */
    state = { ...state, rationsLeft: 1, waterLeft: 1 }
    expect(riskAverse(state)).toEqual({ kind: 'turn-back' })
  })

  it('rations on low supplies (no critical, no severe weather)', () => {
    const route = makeRoute({ edgeDays: Array(10).fill(1), totalKm: 250 })
    let state = initJourneyState({ route, season: 'spring', mode: 'direct', supply: DEFAULT_SUPPLY })
    /* Low water (≤3) but not critical and route still has many days. */
    state = { ...state, waterLeft: 2.5, rationsLeft: 7 }
    const action = riskAverse(state)
    /* Could be 'rest' if weather sample says severe; if 'ration' we know
     * the supply path was hit. Accept either as valid risk-averse output;
     * the important assertion is "not continue". */
    expect(['ration', 'rest']).toContain(action.kind)
  })

  it('continues when supplies are healthy and weather sample mild', () => {
    /* Build many states and confirm at least one picks 'continue'. With a
     * 10-day route, full supplies, and mild season, the policy should not
     * always rest or ration. */
    const route = makeRoute({ edgeDays: Array(10).fill(1), totalKm: 200 })
    const state = initJourneyState({
      route, season: 'spring', mode: 'direct',
      supply: { ...DEFAULT_SUPPLY, rationsPerPerson: 30, waterPerPerson: 30 },
    })
    /* Probe several day positions; at least one should be 'continue'. */
    const actions = [0, 1, 2, 3, 4].map(d => riskAverse({ ...state, dayNum: d }).kind)
    expect(actions).toContain('continue')
  })
})

describe('policies: human-like', () => {
  it('turns back in early half when route is long and both supplies far short', () => {
    const route = makeRoute({ edgeDays: Array(20).fill(1), totalKm: 500 }) /* 20-day route */
    let state = initJourneyState({
      route, season: 'summer', mode: 'direct',
      supply: { ...DEFAULT_SUPPLY, rationsPerPerson: 3, waterPerPerson: 2 }, /* dead-on-arrival */
    })
    /* halfway-guard requires dayNum >= 1 (no day-0 turn-back without
     * any observed travel). dayNum=1 of a 20-day route is well in the early half. */
    state = { ...state, dayNum: 1 }
    expect(humanLike(state)).toEqual({ kind: 'turn-back' })
  })

  it('force-marches in the last two days when supplies allow', () => {
    const route = makeRoute({ edgeDays: Array(5).fill(1), totalKm: 125 }) /* 5-day route */
    let state = initJourneyState({
      route, season: 'spring', mode: 'direct',
      supply: { ...DEFAULT_SUPPLY, rationsPerPerson: 30, waterPerPerson: 30 },
    })
    /* Advance to day 4 (one day before arrival; 1 day to go ≤ 2). */
    state = { ...state, dayNum: 4 }
    expect(humanLike(state)).toEqual({ kind: 'force-march' })
  })

  it('continues when route is comfortably within supplies (no other trigger)', () => {
    const route = makeRoute({ edgeDays: Array(5).fill(1), totalKm: 125 })
    const state = initJourneyState({
      route, season: 'spring', mode: 'direct',
      supply: { ...DEFAULT_SUPPLY, rationsPerPerson: 30, waterPerPerson: 30 },
    })
    /* Day 1 of a 5-day route with abundant supply → continue. */
    expect(humanLike(state).kind).toBe('continue')
  })

  it('does NOT turn back when a mid-route oasis rescues low water', () => {
    /* 10-day route on a single trade-route polyline; mark node 2 as 'oasis'
     * and provide resupplyTierFor so the engine populates resupplyByDay. */
    const route = makeRoute({ edgeDays: Array(10).fill(1), totalKm: 250 })
    route.nodes[2] = { ...route.nodes[2], category: 'oasis' }
    let state = initJourneyState({
      route, season: 'spring', mode: 'direct',
      supply: { ...DEFAULT_SUPPLY, rationsPerPerson: 12, waterPerPerson: 2 }, /* low water, plenty rations */
      resupplyTierFor: (cat) => cat === 'oasis' ? 'water' : 'none',
    })
    state = { ...state, dayNum: 1 } /* past halfway-guard floor; still in early half */
    /* Pre-fix (naive scalar): water dies in ~2 days vs 9 to go → turn-back.
     * Post-fix (resupply-aware): the day-2 oasis restores water to startingWater,
     * so the run survives → policy must not turn back. */
    expect(humanLike(state).kind).not.toBe('turn-back')
  })

  it('does NOT turn back past halfway even with critical shortage (sunk-cost guard)', () => {
    /* 10-day route, past midpoint, both supplies near zero. Pre-change would
     * turn back; new logic keeps going (or rations) because returning costs
     * the same supplies as pressing on. */
    const route = makeRoute({ edgeDays: Array(10).fill(1), totalKm: 250 })
    let state = initJourneyState({
      route, season: 'summer', mode: 'direct',
      supply: { ...DEFAULT_SUPPLY, rationsPerPerson: 8, waterPerPerson: 8 },
    })
    state = { ...state, dayNum: 6, rationsLeft: 1, waterLeft: 1 }
    expect(humanLike(state).kind).not.toBe('turn-back')
  })
})
