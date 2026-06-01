import { describe, it, expect } from 'vitest'
import { computeRecommendedMode } from './journey-mode-recommend'
import { DEFAULT_SUPPLY, type SupplyConfig } from './journey-supply'
import type { Encounter } from './encounters'

function supplyWith(pack: SupplyConfig['packAnimals']): SupplyConfig {
  return { ...DEFAULT_SUPPLY, packAnimals: pack }
}

function enc(severity: Encounter['severity']): Encounter {
  return {
    segmentIdx: 0,
    beat: '',
    type: 'combat',
    severity,
    narrative: '',
    supplyCost: { rations: 0, water: 0 },
    timeOfDay: 'day',
  }
}

function severe(n: number): Encounter[] {
  return Array.from({ length: n }, () => enc('severe'))
}

describe('computeRecommendedMode', () => {
  it('recommends safest for direct + caravan (mode-risk path)', () => {
    const r = computeRecommendedMode('direct', supplyWith('caravan'), [])
    expect(r).not.toBeNull()
    expect(r!.mode).toBe('safest')
    expect(r!.reason).toMatch(/caravan/i)
  })

  it('recommends safest for cheapest + 2 severe encounters (density path)', () => {
    const r = computeRecommendedMode('cheapest', supplyWith('few'), severe(2))
    expect(r).not.toBeNull()
    expect(r!.mode).toBe('safest')
    expect(r!.reason).toMatch(/2 severe/)
  })

  it('returns null on safest mode even with many severe encounters', () => {
    expect(computeRecommendedMode('safest', supplyWith('caravan'), severe(5))).toBeNull()
  })

  it('returns null on fastest mode with 1 severe (below density threshold)', () => {
    expect(computeRecommendedMode('fastest', supplyWith('few'), severe(1))).toBeNull()
  })

  it('returns null on cheapest mode with zero severe encounters', () => {
    expect(computeRecommendedMode('cheapest', supplyWith('few'), [enc('mild'), enc('moderate')])).toBeNull()
  })

  it('returns one recommendation when both predicates fire (no duplication)', () => {
    const r = computeRecommendedMode('direct', supplyWith('caravan'), severe(3))
    expect(r).not.toBeNull()
    expect(r!.mode).toBe('safest')
    // Mode-risk rule fires first; reason mentions caravan, not encounter count.
    expect(r!.reason).toMatch(/caravan/i)
  })

  it('returns null when current mode equals safest and no risk predicate fires', () => {
    expect(computeRecommendedMode('safest', supplyWith('few'), [])).toBeNull()
  })

  it('recommends safest for direct mode with low rations (burn-aware path)', () => {
    const r = computeRecommendedMode('direct', { ...DEFAULT_SUPPLY, rationsPerPerson: 4 }, [])
    expect(r).not.toBeNull()
    expect(r!.mode).toBe('safest')
    expect(r!.reason).toMatch(/burns extra rations/i)
  })

  it('recommends safest for fastest mode with low rations', () => {
    const r = computeRecommendedMode('fastest', { ...DEFAULT_SUPPLY, rationsPerPerson: 5 }, [])
    expect(r).not.toBeNull()
    expect(r!.mode).toBe('safest')
    expect(r!.reason).toMatch(/Fastest/)
  })

  it('does not fire the burn-aware path at default rations (12)', () => {
    expect(computeRecommendedMode('direct', { ...DEFAULT_SUPPLY, packAnimals: 'few' }, [])).toBeNull()
  })

  it('does not fire the burn-aware path for cheapest (a low-burn mode)', () => {
    expect(computeRecommendedMode('cheapest', { ...DEFAULT_SUPPLY, rationsPerPerson: 3 }, [])).toBeNull()
  })
})
