/**
 * passage-run.test.ts — Choice-layer harness correctness + known-finding regression.
 */

import { describe, it, expect } from 'vitest'

import { SIGNATURE_CHOICES } from '../../web/src/utils/passage'
import {
  CIVS,
  SEASONS,
  STANDARD_SUPPLY,
  CARAVAN_SUPPLY,
  PASSAGE_PARTY,
  makePassageOpts,
  initPassage,
  passageAct,
  playPassage,
  forkInstance,
  walkWithForks,
  countSignatureFiresPerCrossing,
  allInitialEncounters,
  computeInstanceDominance,
  computeDifferentiation,
  countDistinctOutcomes,
  median,
  loadGraph,
} from './passage-run'
import {
  survive,
  cautious,
  DOWNSTREAM_BASE,
  DOWNSTREAM_CHOICE,
} from './passage-policies'
import type { BranchOutcome, PassageState } from './passage-run'
import type { Season, RouteMode } from '../../web/src/utils/journey-graph'

const graph = loadGraph()

/* ─── Helpers ─── */

function firstPendingWithKey(key: string): { state: PassageState; key: string } | null {
  const modes: RouteMode[] = ['direct', 'cheapest', 'fastest', 'safest']
  for (const from of CIVS) {
    for (const to of CIVS) {
      if (from === to) continue
      for (const season of SEASONS) {
        for (const mode of modes) {
          const opts = makePassageOpts(graph, from, to, season, mode, CARAVAN_SUPPLY, PASSAGE_PARTY)
          if (!opts) continue
          let state = initPassage(opts)
          const cap = (state.journey.totalDays + 1) * 3
          let safety = cap
          while (state.outcome === 'in-progress' && safety-- > 0) {
            if (state.pending) {
              if (state.pending.encounter.key === key) {
                return { state, key }
              }
              // Resolve the non-matching choice and keep stepping so we can catch later ones.
              state = playPassage(state, survive, cautious).state
              continue
            }
            const before = state
            state = passageAct(state, survive(state))
            if (state === before) break
          }
        }
      }
    }
  }
  return null
}

/* ─── Determinism of fork ─── */

describe('fork determinism', () => {
  for (const key of Object.keys(SIGNATURE_CHOICES)) {
    it(`forkInstance is deterministic and non-mutating for ${key}`, () => {
      const found = firstPendingWithKey(key)
      expect(found).not.toBeNull()
      const pending = found!.state
      const before = {
        rationsLeft: pending.journey.rationsLeft,
        waterLeft: pending.journey.waterLeft,
        dayNum: pending.journey.dayNum,
      }
      const run1 = forkInstance(pending, DOWNSTREAM_BASE, DOWNSTREAM_CHOICE)
      const run2 = forkInstance(pending, DOWNSTREAM_BASE, DOWNSTREAM_CHOICE)
      expect(run1).toEqual(run2)
      expect(pending.journey.rationsLeft).toBe(before.rationsLeft)
      expect(pending.journey.waterLeft).toBe(before.waterLeft)
      expect(pending.journey.dayNum).toBe(before.dayNum)
    })
  }
})

/* ─── Metric helpers ─── */

describe('metric helpers on synthetic branches', () => {
  const branches: BranchOutcome[] = [
    { index: 0, label: 'A', risk: 'none', outcome: 'arrived', finalRations: 8, finalWater: 5, totalDays: 12 },
    { index: 1, label: 'B', risk: 'minor', outcome: 'arrived', finalRations: 6, finalWater: 5, totalDays: 11 },
    { index: 2, label: 'C', risk: 'grave', outcome: 'perished', finalRations: 2, finalWater: 1, totalDays: 9 },
  ]

  it('dominance picks branch that is ≥ others on arrived/water/rations', () => {
    const dom = computeInstanceDominance(branches)
    // Branch A dominates: arrived tie, best rations, best water (vs B and C).
    expect(dom.dominantIndex).toBe(0)
  })

  it('dead branches are those best-on-no-axis', () => {
    const dom = computeInstanceDominance(branches)
    // Branch A best rations and tied best water; B tied best water; C not best on any counted axis.
    expect(dom.bestOnAnyAxis.has(0)).toBe(true)
    expect(dom.bestOnAnyAxis.has(1)).toBe(true)
    expect(dom.bestOnAnyAxis.has(2)).toBe(false)
  })

  it('differentiation computes max-min ranges', () => {
    const diff = computeDifferentiation(branches)
    expect(diff.waterRange).toBe(5 - 1)
    expect(diff.rationsRange).toBe(8 - 2)
  })

  it('impact counts distinct outcomes', () => {
    expect(countDistinctOutcomes(branches)).toBe(2)
  })

  it('median handles odd and even counts', () => {
    expect(median([1, 2, 3])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})

/* ─── Known-finding regression ─── */

describe('known-finding regression', () => {
  it('Kheshkai → Irrah, winter, direct buckets bandits ≥2× and lists customs raid + plague quarantine as non-interactive severe beats', () => {
    const opts = makePassageOpts(graph, 'kheshkai', 'irrah', 'winter', 'direct', STANDARD_SUPPLY, PASSAGE_PARTY)
    expect(opts).not.toBeNull()
    const state0 = initPassage(opts!)
    const fires = countSignatureFiresPerCrossing(state0)
    expect((fires.get('bandits') ?? 0)).toBeGreaterThanOrEqual(2)

    const signatureKeys = new Set(Object.keys(SIGNATURE_CHOICES))
    const nonInteractiveSevere = allInitialEncounters(state0).filter(
      e => (e.severity === 'moderate' || e.severity === 'severe') && !(e.key && signatureKeys.has(e.key)),
    )
    const narratives = nonInteractiveSevere.map(e => e.narrative)
    expect(narratives.some(n => n.includes('Basin customs raid'))).toBe(true)
    expect(narratives.some(n => n.includes('Plague-quarantine'))).toBe(true)
  })

  it('Kheshkai → Qollari, spring, direct, standard supply dies/aborts with zero signature choices', () => {
    const opts = makePassageOpts(graph, 'kheshkai', 'qollari', 'spring', 'direct', STANDARD_SUPPLY, PASSAGE_PARTY)
    expect(opts).not.toBeNull()
    const state0 = initPassage(opts!)
    const { state, choices } = playPassage(state0, survive, cautious)
    expect(['perished', 'aborted']).toContain(state.outcome)
    expect(choices.length).toBe(0)
  })
})

/* ─── walkWithForks smoke ─── */

describe('walkWithForks', () => {
  it('records an instance for each signature choice presented by the baseline', () => {
    const opts = makePassageOpts(graph, 'kheshkai', 'irrah', 'winter', 'direct', CARAVAN_SUPPLY, PASSAGE_PARTY)
    expect(opts).not.toBeNull()
    const state0 = initPassage(opts!)
    const { finalState, instances } = walkWithForks(
      state0,
      survive,
      cautious,
      DOWNSTREAM_BASE,
      DOWNSTREAM_CHOICE,
    )
    expect(finalState.outcome).not.toBe('in-progress')
    expect(instances.length).toBeGreaterThan(0)
    for (const inst of instances) {
      expect(inst.branches.length).toBeGreaterThan(1)
      expect(inst.baselineChosen).toBeGreaterThanOrEqual(0)
      expect(inst.baselineChosen).toBeLessThan(inst.offered)
    }
  })
})
