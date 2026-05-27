import { describe, it, expect } from 'vitest'
import { computeEncounterDensityWarning, ENCOUNTER_DENSITY_SEVERE_THRESHOLD } from './journey-encounter-density'
import type { Encounter } from './encounters'

function enc(severity: Encounter['severity']): Encounter {
  return {
    segmentIdx: 0,
    beat: '',
    type: 'combat',
    severity,
    narrative: '',
    supplyCost: { rations: 0, water: 0 },
  }
}

function severeRoute(n: number): Encounter[] {
  return [
    ...Array.from({ length: n }, () => enc('severe')),
    enc('mild'),
    enc('moderate'),
  ]
}

describe('computeEncounterDensityWarning', () => {
  it('returns null on safest mode even with many severe encounters', () => {
    expect(computeEncounterDensityWarning('safest', severeRoute(3))).toBeNull()
  })

  it('returns null on direct mode with zero severe', () => {
    expect(computeEncounterDensityWarning('direct', [enc('mild'), enc('moderate')])).toBeNull()
  })

  it('returns null on direct mode with one severe (below threshold)', () => {
    expect(computeEncounterDensityWarning('direct', severeRoute(1))).toBeNull()
  })

  it('returns warning on direct mode at threshold (2 severe)', () => {
    const w = computeEncounterDensityWarning('direct', severeRoute(2))
    expect(w).not.toBeNull()
    expect(w).toMatch(/2 severe encounters/)
    expect(w).toMatch(/safest/i)
  })

  it('returns warning on direct mode well above threshold (4 severe)', () => {
    const w = computeEncounterDensityWarning('direct', severeRoute(4))
    expect(w).not.toBeNull()
    expect(w).toMatch(/4 severe encounters/)
  })

  it('returns warning on fastest mode with 3 severe', () => {
    expect(computeEncounterDensityWarning('fastest', severeRoute(3))).not.toBeNull()
  })

  it('returns warning on cheapest mode at threshold', () => {
    expect(computeEncounterDensityWarning('cheapest', severeRoute(ENCOUNTER_DENSITY_SEVERE_THRESHOLD))).not.toBeNull()
  })
})
