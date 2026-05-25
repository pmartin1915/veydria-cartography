/**
 * sim-policy-report.test.ts — Phase 3b: report emitter sanity checks.
 *
 * Tests the pure helpers (no fs I/O). Feeds a synthetic row set and asserts
 * the markdown sections include the right policy names, headline numbers,
 * and convergence flags.
 */

import { describe, it, expect } from 'vitest'
import {
  parseCsvLine,
  sectionHeadline,
  sectionActionMix,
  sectionConvergence,
  type Row,
} from './sim-policy-report'

function row(over: Partial<Row>): Row {
  return {
    from: 'a', to: 'b', season: 'spring', mode: 'direct', policy: 'naive',
    party_preset: 'standard', party_pace: 'normal', party_mount: 'foot',
    party_size: 'medium', party_forcedMarch: 'false',
    supply_preset: 'standard', supply_rations: '12', supply_water: '6',
    supply_encumbrance: 'normal', supply_pack: 'none',
    route_found: 'true', total_km: '100', estimated_days: '10',
    days_count: '10', completed: 'false', finished_reason: 'water-out',
    encounters_total: '0', calendar_events_total: '0',
    rations_low_day: '', water_low_day: '', rations_out_day: '', water_out_day: '10',
    final_rations_left: '0', final_water_left: '0',
    encounters_by_type_json: '{}', encounters_by_severity_json: '{}', error: '',
    action_continue: '10', action_rest: '0', action_force_march: '0',
    action_ration: '0', action_turn_back: '0', action_reroute: '0',
    exhaustion_final: '0',
    ...over,
  }
}

describe('sim-policy-report: parseCsvLine', () => {
  it('parses simple comma-separated cells', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c'])
  })

  it('handles quoted fields with embedded commas', () => {
    expect(parseCsvLine('"a,b",c,"d"')).toEqual(['a,b', 'c', 'd'])
  })

  it('handles escaped quotes inside quoted fields', () => {
    expect(parseCsvLine('"a""b",c')).toEqual(['a"b', 'c'])
  })

  it('handles empty trailing field', () => {
    expect(parseCsvLine('a,b,')).toEqual(['a', 'b', ''])
  })
})

describe('sim-policy-report: sectionHeadline', () => {
  it('lists every policy with its completion rate', () => {
    const rows: Row[] = [
      row({ policy: 'naive', completed: 'true' }),
      row({ policy: 'naive', completed: 'false' }),
      row({ policy: 'greedy-speed', completed: 'true' }),
      row({ policy: 'greedy-speed', completed: 'true' }),
    ]
    const md = sectionHeadline(rows, ['naive', 'greedy-speed'])
    expect(md).toContain('## Headline')
    expect(md).toContain('naive')
    expect(md).toContain('greedy-speed')
    expect(md).toContain('50.0%') /* naive: 1/2 */
    expect(md).toContain('100.0%') /* greedy-speed: 2/2 */
  })

  it('reports the spread as max−min in percentage points', () => {
    const rows: Row[] = [
      row({ policy: 'naive', completed: 'false' }),
      row({ policy: 'naive', completed: 'false' }),
      row({ policy: 'greedy-speed', completed: 'true' }),
      row({ policy: 'greedy-speed', completed: 'true' }),
    ]
    const md = sectionHeadline(rows, ['naive', 'greedy-speed'])
    /* naive=0%, greedy=100% → spread 100.0 */
    expect(md).toContain('**100.0 pp**')
  })
})

describe('sim-policy-report: sectionActionMix', () => {
  it('reports % of each action across all runs per policy', () => {
    const rows: Row[] = [
      row({ policy: 'naive', days_count: '10', action_continue: '10' }),
      row({ policy: 'naive', days_count: '10', action_continue: '10' }),
      row({
        policy: 'risk-averse', days_count: '4',
        action_continue: '2', action_rest: '1', action_ration: '1',
      }),
    ]
    const md = sectionActionMix(rows, ['naive', 'risk-averse'])
    expect(md).toContain('## Action mix')
    expect(md).toContain('100.0%') /* naive continue */
    expect(md).toContain('50.0%')  /* risk-averse continue */
    expect(md).toContain('25.0%')  /* risk-averse rest / ration */
  })
})

describe('sim-policy-report: sectionConvergence', () => {
  it('flags (from, to, season) triples where policy spread is below epsilon', () => {
    /* Two triples: one convergent (all 0%), one divergent. */
    const rows: Row[] = [
      /* Convergent: from=a to=b season=spring, all policies 0%. */
      row({ from: 'a', to: 'b', season: 'spring', policy: 'naive', completed: 'false' }),
      row({ from: 'a', to: 'b', season: 'spring', policy: 'greedy-speed', completed: 'false' }),
      /* Divergent: from=c to=d season=summer, one policy 100%, another 0%. */
      row({ from: 'c', to: 'd', season: 'summer', policy: 'naive', completed: 'false' }),
      row({ from: 'c', to: 'd', season: 'summer', policy: 'greedy-speed', completed: 'true' }),
    ]
    const md = sectionConvergence(rows, ['naive', 'greedy-speed'], 0.05)
    expect(md).toContain('## Convergence')
    /* Convergent triple is listed. */
    expect(md).toContain('| a | b | spring |')
    /* Divergent triple is NOT listed. */
    expect(md).not.toContain('| c | d | summer |')
  })

  it('emits "no convergent triples" when none qualify', () => {
    const rows: Row[] = [
      row({ from: 'a', to: 'b', season: 'spring', policy: 'naive', completed: 'true' }),
      row({ from: 'a', to: 'b', season: 'spring', policy: 'greedy-speed', completed: 'false' }),
    ]
    const md = sectionConvergence(rows, ['naive', 'greedy-speed'], 0.05)
    expect(md).toContain('no convergent triples')
  })
})
