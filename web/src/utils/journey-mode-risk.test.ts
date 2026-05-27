import { describe, it, expect } from 'vitest'
import { computeModeRiskWarning } from './journey-mode-risk'
import { DEFAULT_SUPPLY, type SupplyConfig } from './journey-supply'

function supplyWith(pack: SupplyConfig['packAnimals']): SupplyConfig {
  return { ...DEFAULT_SUPPLY, packAnimals: pack }
}

describe('computeModeRiskWarning', () => {
  it('returns a warning string for direct + caravan', () => {
    const w = computeModeRiskWarning('direct', supplyWith('caravan'))
    expect(w).not.toBeNull()
    expect(w).toMatch(/2×/)
    expect(w).toMatch(/caravan/i)
  })

  it('returns null for direct + few', () => {
    expect(computeModeRiskWarning('direct', supplyWith('few'))).toBeNull()
  })

  it('returns null for direct + none', () => {
    expect(computeModeRiskWarning('direct', supplyWith('none'))).toBeNull()
  })

  it('returns null for fastest + caravan', () => {
    expect(computeModeRiskWarning('fastest', supplyWith('caravan'))).toBeNull()
  })

  it('returns null for safest + caravan', () => {
    expect(computeModeRiskWarning('safest', supplyWith('caravan'))).toBeNull()
  })

  it('returns null for cheapest + caravan', () => {
    expect(computeModeRiskWarning('cheapest', supplyWith('caravan'))).toBeNull()
  })
})
