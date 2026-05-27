/**
 * sim-fun-report.test.ts — Phase 4: pure-helper sanity checks.
 *
 * No fs I/O. Synthetic CSV rows + synthetic Trace objects exercise the
 * four metric functions: mode regret (best/worst per cell), pivot rate
 * (per-policy spread classification), surprise rate (encounter-driven
 * action shift), recovery distance (warning-lift detection).
 */

import { describe, it, expect } from 'vitest'
import {
  computeModeRegretWorst,
  computeModeRegretByPreset,
  computePivotRate,
  computeSurprise,
  computeRecovery,
  computeTLDR,
  type Trace,
} from './sim-fun-report'
import type { Row } from './report-utils'

function csvRow(over: Partial<Row>): Row {
  return {
    from: 'a', to: 'b', season: 'spring', mode: 'direct', policy: 'naive',
    party_preset: 'standard', supply_preset: 'standard',
    completed: 'false', finished_reason: 'water-out',
    days_count: '10', encounters_total: '0',
    exhaustion_final: '0',
    action_continue: '10', action_rest: '0', action_force_march: '0',
    action_ration: '0', action_turn_back: '0', action_reroute: '0',
    ...over,
  }
}

function trace(over: Partial<Trace> & {
  policy?: string
  rationsPerPerson?: number
  waterPerPerson?: number
  days?: Trace['days']
  completed?: boolean
  finishedReason?: Trace['summary']['finishedReason']
}): Trace {
  return {
    inputs: {
      from: 'a', to: 'b', season: 'spring', mode: 'direct',
      policy: over.policy,
      supply: {
        rationsPerPerson: over.rationsPerPerson ?? 12,
        waterPerPerson: over.waterPerPerson ?? 6,
        encumbrance: 'normal',
        packAnimals: 'none',
      },
    },
    days: over.days ?? [],
    summary: {
      daysCount: over.days?.length ?? 0,
      completed: over.completed ?? true,
      finishedReason: over.finishedReason ?? 'arrived',
    },
    ...over,
  }
}

describe('mode regret: computeModeRegretWorst', () => {
  it('flags cell where one mode completes and another does not', () => {
    /* 4 modes, 1 policy, 1 party — direct fails, fastest succeeds, others fail. */
    const rows: Row[] = [
      csvRow({ mode: 'direct',   completed: 'false' }),
      csvRow({ mode: 'fastest',  completed: 'true' }),
      csvRow({ mode: 'safest',   completed: 'false' }),
      csvRow({ mode: 'cheapest', completed: 'false' }),
    ]
    const worst = computeModeRegretWorst(rows, ['direct', 'fastest', 'safest', 'cheapest'], 5)
    expect(worst.length).toBe(1)
    expect(worst[0].bestMode).toBe('fastest')
    expect(worst[0].bestRate).toBe(1)
    expect(worst[0].worstRate).toBe(0)
    expect(worst[0].spreadPp).toBe(100)
  })

  it('produces empty regret when all modes have the same rate', () => {
    const rows: Row[] = ['direct', 'fastest', 'safest', 'cheapest'].map(mode =>
      csvRow({ mode, completed: 'true' }),
    )
    const worst = computeModeRegretWorst(rows, ['direct', 'fastest', 'safest', 'cheapest'], 5)
    expect(worst[0].spreadPp).toBe(0)
  })

  it('sorts cells by spread descending and respects topN', () => {
    /* Cell 1: 100 pp spread.  Cell 2: 50 pp spread. */
    const c1: Row[] = [
      csvRow({ from: 'x', mode: 'direct',   completed: 'false' }),
      csvRow({ from: 'x', mode: 'fastest',  completed: 'true' }),
      csvRow({ from: 'x', mode: 'safest',   completed: 'false' }),
      csvRow({ from: 'x', mode: 'cheapest', completed: 'false' }),
    ]
    /* 4 policies per mode-cell so we can get 50% rate on best mode. */
    const c2: Row[] = []
    for (const policy of ['p1', 'p2']) {
      c2.push(csvRow({ from: 'y', mode: 'direct',   policy, completed: 'false' }))
      c2.push(csvRow({ from: 'y', mode: 'fastest',  policy, completed: policy === 'p1' ? 'true' : 'false' }))
      c2.push(csvRow({ from: 'y', mode: 'safest',   policy, completed: 'false' }))
      c2.push(csvRow({ from: 'y', mode: 'cheapest', policy, completed: 'false' }))
    }
    const worst = computeModeRegretWorst([...c1, ...c2], ['direct', 'fastest', 'safest', 'cheapest'], 1)
    expect(worst.length).toBe(1)
    expect(worst[0].from).toBe('x')
    expect(worst[0].spreadPp).toBe(100)
  })
})

describe('mode regret: computeModeRegretByPreset', () => {
  it('mean regret is zero when a mode is always the best', () => {
    /* fastest always 100%, direct always 0% → fastest regret = 0, direct regret = 100%. */
    const rows: Row[] = []
    for (const season of ['spring', 'summer']) {
      rows.push(csvRow({ season, mode: 'direct',   completed: 'false' }))
      rows.push(csvRow({ season, mode: 'fastest',  completed: 'true' }))
      rows.push(csvRow({ season, mode: 'safest',   completed: 'false' }))
      rows.push(csvRow({ season, mode: 'cheapest', completed: 'false' }))
    }
    const res = computeModeRegretByPreset(rows, ['direct', 'fastest', 'safest', 'cheapest'], ['standard'])
    const inner = res.get('standard')!
    expect(inner.get('fastest')).toBe(0)
    expect(inner.get('direct')).toBe(1)
  })
})

describe('pivot rate: computePivotRate', () => {
  it('flags cells where policy spread ≥ epsilon', () => {
    /* Single cell: 2 policies, one completes, one fails → spread = 1. */
    const rows: Row[] = [
      csvRow({ policy: 'a', completed: 'true' }),
      csvRow({ policy: 'b', completed: 'false' }),
    ]
    const out = computePivotRate(rows, ['a', 'b'], ['standard'], ['direct'], 0.05)
    const cell = out.find(c => c.supplyPreset === 'standard' && c.mode === 'direct')!
    expect(cell.decisionsMattered).toBe(1)
    expect(cell.total).toBe(1)
  })

  it('does not flag converged cells', () => {
    const rows: Row[] = [
      csvRow({ policy: 'a', completed: 'true' }),
      csvRow({ policy: 'b', completed: 'true' }),
    ]
    const out = computePivotRate(rows, ['a', 'b'], ['standard'], ['direct'], 0.05)
    const cell = out.find(c => c.supplyPreset === 'standard' && c.mode === 'direct')!
    expect(cell.decisionsMattered).toBe(0)
    expect(cell.total).toBe(1)
  })
})

describe('surprise rate: computeSurprise', () => {
  it('attributes day N surprise to day N+1 action; skips final day', () => {
    /* Next-day attribution: a policy chooses each day's action at day-start,
     * before encounters roll. So a surprise on day N can only show up in the
     * action picked at the start of day N+1.
     *
     * Fixture:
     *   day 1: mild (routine)    → day 2 ration       → routineNonContinue+1
     *   day 2: moderate (surp)   → day 3 turn-back    → surprisingNonContinue+1
     *   day 3: severe (surp)     → day 4 continue     → surprisingDays+1 only
     *   day 4: last day — skipped entirely (no "tomorrow")
     *
     * Expected: totalDays=3, surprisingDays=2, routineDays=1,
     *           surprisingNonContinue=1, routineNonContinue=1. */
    const t = trace({
      policy: 'naive',
      days: [
        { dayNum: 1, rationsLeft: 10, waterLeft: 5, encounters: [{ severity: 'mild' }], action: 'continue' },
        { dayNum: 2, rationsLeft: 9, waterLeft: 4, encounters: [{ severity: 'moderate' }], action: 'ration' },
        { dayNum: 3, rationsLeft: 8, waterLeft: 3, encounters: [{ severity: 'severe' }], action: 'turn-back' },
        { dayNum: 4, rationsLeft: 7, waterLeft: 2, encounters: [], action: 'continue' },
      ],
    })
    const out = computeSurprise([t])
    const v = out.get('naive')!
    expect(v.totalDays).toBe(3)
    expect(v.surprisingDays).toBe(2)              /* days 2 and 3 */
    expect(v.routineDays).toBe(1)                 /* day 1 only (day 4 skipped) */
    expect(v.surprisingNonContinue).toBe(1)       /* day 2 surprise → day 3 turn-back */
    expect(v.routineNonContinue).toBe(1)          /* day 1 routine → day 2 ration */
  })
})

describe('recovery: computeRecovery', () => {
  it('classifies recovered when warning lifts after first warning', () => {
    const t = trace({
      policy: 'risk-averse',
      rationsPerPerson: 12,
      waterPerPerson: 6,
      days: [
        { dayNum: 1, rationsLeft: 11, waterLeft: 5, encounters: [], supplyWarning: '' },
        { dayNum: 2, rationsLeft: 10, waterLeft: 1, encounters: [], supplyWarning: 'water-low' },
        { dayNum: 3, rationsLeft: 9, waterLeft: 0.5, encounters: [], supplyWarning: 'water-low' },
        { dayNum: 4, rationsLeft: 12, waterLeft: 6, encounters: [], supplyWarning: '' },
      ],
      completed: true,
      finishedReason: 'arrived',
    })
    const out = computeRecovery([t])
    const v = out.get('risk-averse|standard')!
    expect(v.warned).toBe(1)
    expect(v.recovered).toBe(1)
    expect(v.failed).toBe(0)
    expect(v.arrivedUnderPressure).toBe(0)
    expect(v.recoveryDays).toEqual([2])           /* day 2 → day 4 = 2 days */
  })

  it('classifies failed when never recovers and finishes water-out', () => {
    const t = trace({
      policy: 'naive',
      rationsPerPerson: 3,
      waterPerPerson: 2,
      days: [
        { dayNum: 1, rationsLeft: 2, waterLeft: 1, encounters: [], supplyWarning: 'water-low' },
        { dayNum: 2, rationsLeft: 1, waterLeft: 0, encounters: [], supplyWarning: 'water-out' },
        { dayNum: 3, rationsLeft: 0, waterLeft: -1, encounters: [], supplyWarning: 'water-out' },
      ],
      completed: false,
      finishedReason: 'water-out',
    })
    const out = computeRecovery([t])
    const v = out.get('naive|tight')!
    expect(v.warned).toBe(1)
    expect(v.recovered).toBe(0)
    expect(v.failed).toBe(1)
    expect(v.failureDays).toEqual([2])            /* day 1 → day 3 = 2 days */
  })

  it('classifies arrived-under-pressure when warning never lifts but trace ends arrived', () => {
    const t = trace({
      policy: 'human-like',
      rationsPerPerson: 12,
      days: [
        { dayNum: 1, rationsLeft: 11, waterLeft: 5, encounters: [], supplyWarning: '' },
        { dayNum: 2, rationsLeft: 10, waterLeft: 1, encounters: [], supplyWarning: 'water-low' },
        { dayNum: 3, rationsLeft: 9, waterLeft: 0.5, encounters: [], supplyWarning: 'water-low' },
      ],
      completed: true,
      finishedReason: 'arrived',
    })
    const out = computeRecovery([t])
    const v = out.get('human-like|standard')!
    expect(v.warned).toBe(1)
    expect(v.recovered).toBe(0)
    expect(v.arrivedUnderPressure).toBe(1)
    expect(v.failed).toBe(0)
  })

  it('ignores traces that never hit a warning', () => {
    const t = trace({
      policy: 'greedy-speed',
      days: [
        { dayNum: 1, rationsLeft: 11, waterLeft: 5, encounters: [], supplyWarning: '' },
        { dayNum: 2, rationsLeft: 10, waterLeft: 4, encounters: [], supplyWarning: '' },
      ],
    })
    const out = computeRecovery([t])
    expect(out.size).toBe(0)
  })
})

describe('TL;DR: computeTLDR', () => {
  it('produces no bullets on empty inputs', () => {
    const out = computeTLDR([], [], new Map(), new Map(), [])
    expect(out).toEqual([])
  })

  it('surfaces a worst-mode bullet when modeWorst is non-empty', () => {
    const out = computeTLDR(
      [{ from: 'x', to: 'y', season: 'spring', supplyPreset: 'standard',
        modeRates: { direct: 0, fastest: 1, safest: 0, cheapest: 0 },
        bestMode: 'fastest', bestRate: 1, worstMode: 'direct', worstRate: 0, spreadPp: 100 }],
      [], new Map(), new Map(), [],
    )
    expect(out.length).toBe(1)
    expect(out[0]).toMatch(/x.*y.*fastest.*direct/)
  })
})
