import { describe, it, expect } from 'vitest'
import { rollOneOff } from './encounter-roller'
import {
  TRADE_ROUTE_BEATS,
  CHOKEPOINT_BEATS,
  INTRA_CIV_BEATS,
} from './encounters'

describe('encounter-roller', () => {
  it('returns an Encounter with all required keys and correct types', () => {
    const e = rollOneOff({ edgeType: 'trade_route' })
    expect(e).not.toBeNull()
    if (!e) return
    expect(typeof e.segmentIdx).toBe('number')
    expect(e.segmentIdx).toBe(-1)
    expect(typeof e.beat).toBe('string')
    expect(e.beat.length).toBeGreaterThan(0)
    expect(['social', 'environmental', 'combat', 'opportunity']).toContain(e.type)
    expect(['mild', 'moderate', 'severe']).toContain(e.severity)
    expect(typeof e.narrative).toBe('string')
    expect(e.narrative).toBe(e.beat)
  })

  it('pool membership: 50 trade_route rolls all come from TRADE_ROUTE_BEATS', () => {
    const tradeTexts = new Set(TRADE_ROUTE_BEATS.map(b => b.text))
    const chokeTexts = new Set(CHOKEPOINT_BEATS.map(b => b.text))
    const intraTexts = new Set(INTRA_CIV_BEATS.map(b => b.text))
    for (let i = 0; i < 50; i++) {
      const e = rollOneOff({ edgeType: 'trade_route' })
      expect(e).not.toBeNull()
      if (!e) continue
      expect(tradeTexts.has(e.beat)).toBe(true)
      expect(chokeTexts.has(e.beat)).toBe(false)
      expect(intraTexts.has(e.beat)).toBe(false)
    }
  })

  it('severity filter: 30 severe rolls all have severity severe', () => {
    for (let i = 0; i < 30; i++) {
      const e = rollOneOff({ edgeType: 'chokepoint', severity: 'severe' })
      // chokepoint pool contains severe beats, so this should never be null
      expect(e).not.toBeNull()
      if (!e) continue
      expect(e.severity).toBe('severe')
    }
  })

  it('season filter: winter rolls never include summer-only or winter-excluded beats', () => {
    // Compute the set of beat texts that are *forbidden* in winter across
    // every pool: anything tagged seasons:['summer'] (no winter) or any
    // excludeSeasons containing 'winter'.
    const forbidden = new Set<string>()
    for (const pool of [TRADE_ROUTE_BEATS, CHOKEPOINT_BEATS, INTRA_CIV_BEATS]) {
      for (const b of pool) {
        if (b.seasons && !b.seasons.includes('winter')) forbidden.add(b.text)
        if (b.excludeSeasons && b.excludeSeasons.includes('winter')) forbidden.add(b.text)
      }
    }
    expect(forbidden.size).toBeGreaterThan(0) // sanity: filter is real

    const edgeTypes: Array<'trade_route' | 'chokepoint' | 'intra_civ'> = [
      'trade_route', 'chokepoint', 'intra_civ',
    ]
    for (let i = 0; i < 30; i++) {
      const edgeType = edgeTypes[i % edgeTypes.length]
      const e = rollOneOff({ edgeType, season: 'winter' })
      expect(e).not.toBeNull()
      if (!e) continue
      expect(forbidden.has(e.beat)).toBe(false)
    }
  })

  it('determinism: stubbed rng of () => 0 always returns the same beat', () => {
    const stub = () => 0
    const a = rollOneOff({ edgeType: 'trade_route', rng: stub })
    const b = rollOneOff({ edgeType: 'trade_route', rng: stub })
    const c = rollOneOff({ edgeType: 'trade_route', rng: stub })
    expect(a).toEqual(b)
    expect(b).toEqual(c)

    // And likewise with a non-zero stub
    const stub42 = () => 0.42
    const x = rollOneOff({ edgeType: 'chokepoint', rng: stub42 })
    const y = rollOneOff({ edgeType: 'chokepoint', rng: stub42 })
    expect(x).toEqual(y)
  })

  it('empty pool case returns null', () => {
    // We can't inject a pool into rollOneOff; instead, scan every (edge,
    // season, severity) triple and validate that any empty combination
    // produces a null return. If the pools grow to cover every cell, the
    // test still passes — it asserts "wherever empty exists, null is
    // returned", not "an empty cell exists in current data".
    const edgeTypes = ['trade_route', 'chokepoint', 'intra_civ'] as const
    const seasons = ['spring', 'summer', 'autumn', 'winter'] as const
    const severities = ['mild', 'moderate', 'severe'] as const
    const poolByType = {
      trade_route: TRADE_ROUTE_BEATS,
      chokepoint: CHOKEPOINT_BEATS,
      intra_civ: INTRA_CIV_BEATS,
    }
    for (const edgeType of edgeTypes) {
      for (const season of seasons) {
        for (const severity of severities) {
          const baseline = poolByType[edgeType]
          // Mirror filterBySeason + severity filter so we know the truth
          // about whether the pool is empty for this triple.
          const general = baseline.filter(b => !b.seasons && !b.excludeSeasons)
          const specific = baseline.filter(b => {
            if (b.seasons && !b.seasons.includes(season)) return false
            if (b.excludeSeasons && b.excludeSeasons.includes(season)) return false
            return true
          })
          const seasoned = specific.length > 0 ? [...specific, ...general] : general
          const filtered = seasoned.filter(b => b.severity === severity)
          const result = rollOneOff({ edgeType, season, severity })
          if (filtered.length === 0) {
            expect(result).toBeNull()
          } else {
            expect(result).not.toBeNull()
          }
        }
      }
    }
  })
})
