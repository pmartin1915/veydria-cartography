/**
 * sim-batch.test.ts — Phase 3b: CSV-shape and action-mix contract for sim:batch.
 *
 * Doesn't run the full grid (slow); exercises toRow / computeActionMix /
 * the two CSV column schemas directly. The "all 576 rows balanced"
 * integration check is performed manually via the npm script.
 */

import { describe, it, expect } from 'vitest'
import {
  toRow,
  computeActionMix,
  LEGACY_COLUMNS,
  POLICY_COLUMNS,
  type GridPoint,
} from './sim-batch'
import type { Trace } from './run-journey'
import { POLICIES_LIST } from './policies'

function makeGridPoint(): GridPoint {
  return {
    inputs: {
      from: 'ngaru_bon',
      to: 'oravan',
      season: 'spring',
      mode: 'direct',
      party: { pace: 'normal', mount: 'foot', size: 'medium', forcedMarch: false },
      supply: { rationsPerPerson: 12, waterPerPerson: 6, encumbrance: 'normal', packAnimals: 'none' },
    },
    supplyPreset: 'standard',
    partyPreset: 'standard',
  }
}

function makeTrace(opts: {
  actions?: Array<'continue' | 'rest' | 'force-march' | 'ration' | 'turn-back'>
  policy?: 'naive' | 'greedy-speed' | 'risk-averse' | 'human-like'
  finalExhaustion?: number
  completed?: boolean
} = {}): Trace {
  const actions = opts.actions ?? ['continue', 'continue', 'continue']
  return {
    inputs: makeGridPoint().inputs,
    route: { found: true, totalKm: 100, estimatedDays: actions.length, bottlenecks: [], seasonalWarnings: [], pivotIds: [], nodeIds: ['ngaru_bon', 'oravan'], edgeCount: 1 },
    days: actions.map((a, i) => ({
      dayNum: i + 1, kmCovered: 30, startLabel: '', campLabel: '', weather: '', notable: [],
      encounters: [], calendarEvents: [], rationsLeft: 12 - i, waterLeft: 6 - i,
      rationsBurnedToday: 1, waterBurnedToday: 1,
      action: a, exhaustionLevel: i === actions.length - 1 ? opts.finalExhaustion ?? 0 : undefined,
    })),
    summary: {
      daysCount: actions.length,
      completed: opts.completed ?? false,
      finishedReason: opts.completed ? 'arrived' : 'water-out',
      encountersTotal: 0, encountersByType: {}, encountersBySeverity: {},
      calendarEventsTotal: 0,
      rationsLowDay: null, waterLowDay: null, rationsOutDay: null, waterOutDay: actions.length,
      finalRationsLeft: 0, finalWaterLeft: 0,
      civStopsOnRoute: 0, resupplyStopsOnRoute: 0,
      ...(opts.policy ? { policy: opts.policy } : {}),
    },
  }
}

describe('sim-batch: column schemas', () => {
  it('LEGACY_COLUMNS has no policy or action_* columns', () => {
    expect(LEGACY_COLUMNS).not.toContain('policy')
    expect(LEGACY_COLUMNS).not.toContain('action_continue')
    expect(LEGACY_COLUMNS).not.toContain('exhaustion_final')
  })

  it('POLICY_COLUMNS includes policy + all 6 action_* + exhaustion_final', () => {
    expect(POLICY_COLUMNS).toContain('policy')
    expect(POLICY_COLUMNS).toContain('action_continue')
    expect(POLICY_COLUMNS).toContain('action_rest')
    expect(POLICY_COLUMNS).toContain('action_force_march')
    expect(POLICY_COLUMNS).toContain('action_ration')
    expect(POLICY_COLUMNS).toContain('action_turn_back')
    expect(POLICY_COLUMNS).toContain('action_reroute')
    expect(POLICY_COLUMNS).toContain('exhaustion_final')
  })

  it('POLICY_COLUMNS is a superset of LEGACY_COLUMNS', () => {
    for (const col of LEGACY_COLUMNS) {
      expect(POLICY_COLUMNS).toContain(col)
    }
  })

  it('both schemas include the Phase 4 resupply-instrumentation columns', () => {
    expect(LEGACY_COLUMNS).toContain('civ_stops_on_route')
    expect(LEGACY_COLUMNS).toContain('resupply_stops_on_route')
    expect(POLICY_COLUMNS).toContain('civ_stops_on_route')
    expect(POLICY_COLUMNS).toContain('resupply_stops_on_route')
  })
})

describe('sim-batch: computeActionMix', () => {
  it('returns all empty strings when policy did not run', () => {
    const trace = makeTrace({ actions: ['continue', 'continue'] })
    const mix = computeActionMix(trace, false)
    expect(mix.action_continue).toBe('')
    expect(mix.exhaustion_final).toBe('')
  })

  it('returns all empty when trace is null', () => {
    const mix = computeActionMix(null, true)
    expect(mix.action_continue).toBe('')
  })

  it('counts each action kind from trace.days', () => {
    const trace = makeTrace({
      actions: ['continue', 'rest', 'force-march', 'ration', 'turn-back', 'continue', 'continue'],
    })
    const mix = computeActionMix(trace, true)
    expect(mix.action_continue).toBe(3)
    expect(mix.action_rest).toBe(1)
    expect(mix.action_force_march).toBe(1)
    expect(mix.action_ration).toBe(1)
    expect(mix.action_turn_back).toBe(1)
    expect(mix.action_reroute).toBe(0)
  })

  it('action mix sums to days count', () => {
    const actions: Array<'continue' | 'ration' | 'rest'> = ['continue', 'continue', 'ration', 'ration', 'rest']
    const trace = makeTrace({ actions })
    const mix = computeActionMix(trace, true)
    const sum = Number(mix.action_continue) + Number(mix.action_rest) +
      Number(mix.action_force_march) + Number(mix.action_ration) +
      Number(mix.action_turn_back) + Number(mix.action_reroute)
    expect(sum).toBe(actions.length)
  })

  it('exhaustion_final reads from last day', () => {
    const trace = makeTrace({ actions: ['continue', 'continue'], finalExhaustion: 7 })
    const mix = computeActionMix(trace, true)
    expect(mix.exhaustion_final).toBe(7)
  })
})

describe('sim-batch: toRow', () => {
  it('legacy path (policy=null) emits empty action_* and policy fields', () => {
    const point = makeGridPoint()
    const trace = makeTrace({ actions: ['continue', 'continue'] })
    const row = toRow(point, trace, '', null)
    expect(row.policy).toBe('')
    expect(row.action_continue).toBe('')
    expect(row.action_force_march).toBe('')
    expect(row.exhaustion_final).toBe('')
    expect(row.days_count).toBe(2)
  })

  it('policy path emits policy name and numeric action counts', () => {
    const point = makeGridPoint()
    const trace = makeTrace({
      actions: ['continue', 'ration', 'continue', 'force-march'],
      policy: 'greedy-speed',
    })
    const row = toRow(point, trace, '', 'greedy-speed')
    expect(row.policy).toBe('greedy-speed')
    expect(row.action_continue).toBe(2)
    expect(row.action_ration).toBe(1)
    expect(row.action_force_march).toBe(1)
    expect(row.action_rest).toBe(0)
    expect(row.days_count).toBe(4)
    /* Sum invariant. */
    const cells = [row.action_continue, row.action_rest, row.action_force_march,
      row.action_ration, row.action_turn_back, row.action_reroute].map(Number)
    expect(cells.reduce((a, b) => a + b, 0)).toBe(row.days_count)
  })

  it('null-trace error path preserves policy name in the row', () => {
    const point = makeGridPoint()
    const row = toRow(point, null, 'graph: no route', 'naive')
    expect(row.policy).toBe('naive')
    expect(row.error).toBe('graph: no route')
    expect(row.completed).toBe(false)
    expect(row.action_continue).toBe('') /* No trace → empty mix even on policy path. */
  })

  it('produces one row per (point, policy) when called for each policy', () => {
    const point = makeGridPoint()
    const rows = POLICIES_LIST.map(p => toRow(point, makeTrace({ policy: p }), '', p))
    expect(rows).toHaveLength(POLICIES_LIST.length)
    expect(rows.map(r => r.policy).sort()).toEqual([...POLICIES_LIST].sort())
  })
})
