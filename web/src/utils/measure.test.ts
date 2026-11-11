import { describe, expect, it } from 'vitest'
import { formatDistance, svgDistanceToKm, KM_PER_SVG_UNIT, LEAGUES_PER_KM } from './measure'

describe('measure', () => {
  describe('constants', () => {
    it('KM_PER_SVG_UNIT equals 4', () => {
      expect(KM_PER_SVG_UNIT).toBe(4)
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
      expect(svgDistanceToKm(100)).toBe(400)
      expect(svgDistanceToKm(1)).toBe(4)
      expect(svgDistanceToKm(300)).toBe(1200)
    })

    it('returns negative km for negative svg distance (no guard)', () => {
      expect(svgDistanceToKm(-10)).toBe(-40)
    })

    it('handles fractional svg distance', () => {
      expect(svgDistanceToKm(0.25)).toBeCloseTo(1, 5)
    })
  })

  describe('formatDistance', () => {
    it('formats zero as meters', () => {
      expect(formatDistance(0)).toBe('0 m')
    })

    it('formats sub-km distances in meters', () => {
      // 0.1 svg units = 0.4 km → 400 m
      expect(formatDistance(0.1)).toBe('400 m')
      // 0.19 svg units = 0.76 km → 760 m (just under 1 km)
      expect(formatDistance(0.19)).toBe('760 m')
    })

    it('formats 1–10 km with one decimal for km and leagues', () => {
      // 0.25 svg units = 1.0 km, 0.25 leagues
      expect(formatDistance(0.25)).toBe('1.0 km / 0.3 leagues')
      // 2 svg units = 8.0 km, 2.0 leagues
      expect(formatDistance(2)).toBe('8.0 km / 2.0 leagues')
    })

    it('formats ≥10 km with zero decimals', () => {
      // 2.5 svg units = 10 km, 2.5 leagues → rounds to 3 leagues
      expect(formatDistance(2.5)).toBe('10 km / 3 leagues')
      // 8 svg units = 32 km, 8 leagues
      expect(formatDistance(8)).toBe('32 km / 8 leagues')
    })

    it('formats negative distances through the meter branch', () => {
      // -0.1 svg = -0.4 km → -400 m
      expect(formatDistance(-0.1)).toBe('-400 m')
    })
  })
})
