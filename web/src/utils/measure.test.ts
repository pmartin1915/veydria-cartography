import { describe, expect, it } from 'vitest'
import { formatDistance, svgDistanceToKm, KM_PER_SVG_UNIT, LEAGUES_PER_KM } from './measure'

describe('measure', () => {
  describe('constants', () => {
    it('KM_PER_SVG_UNIT equals 2.5', () => {
      expect(KM_PER_SVG_UNIT).toBe(2.5)
    })

    it('LEAGUES_PER_KM equals 0.25', () => {
      expect(LEAGUES_PER_KM).toBe(0.25)
    })
  })

  describe('svgDistanceToKm', () => {
    it('returns 0 for 0 svg distance', () => {
      expect(svgDistanceToKm(0)).toBe(0)
    })

    it('scales positive svg distance correctly', () => {
      expect(svgDistanceToKm(100)).toBe(250)
      expect(svgDistanceToKm(1)).toBe(2.5)
      expect(svgDistanceToKm(480)).toBe(1200)
    })

    it('returns negative km for negative svg distance (no guard)', () => {
      expect(svgDistanceToKm(-10)).toBe(-25)
    })

    it('handles fractional svg distance', () => {
      expect(svgDistanceToKm(0.4)).toBeCloseTo(1, 5)
    })
  })

  describe('formatDistance', () => {
    it('formats zero as meters', () => {
      expect(formatDistance(0)).toBe('0 m')
    })

    it('formats sub-km distances in meters', () => {
      // 0.1 svg units = 0.25 km → 250 m
      expect(formatDistance(0.1)).toBe('250 m')
      // 0.39 svg units = 0.975 km → 975 m (just under 1 km)
      expect(formatDistance(0.39)).toBe('975 m')
    })

    it('formats 1–10 km with one decimal for km and leagues', () => {
      // 0.4 svg units = 1.0 km, 0.25 leagues
      expect(formatDistance(0.4)).toBe('1.0 km / 0.3 leagues')
      // 2 svg units = 5.0 km, 1.25 leagues
      expect(formatDistance(2)).toBe('5.0 km / 1.3 leagues')
    })

    it('formats ≥10 km with zero decimals', () => {
      // 4 svg units = 10 km, 2.5 leagues → rounds to 3 leagues
      expect(formatDistance(4)).toBe('10 km / 3 leagues')
      // 8 svg units = 20 km, 5 leagues
      expect(formatDistance(8)).toBe('20 km / 5 leagues')
    })

    it('formats negative distances through the meter branch', () => {
      // -0.1 svg = -0.25 km → -250 m
      expect(formatDistance(-0.1)).toBe('-250 m')
    })
  })
})
