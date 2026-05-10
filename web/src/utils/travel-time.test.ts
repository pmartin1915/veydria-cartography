import { describe, expect, it } from 'vitest'
import { estimateTravelTime, formatTravelEstimate, type TravelEstimate } from './travel-time'

function makeFeature(
  category: string,
  geometryType: string,
  coordinates: unknown,
) {
  return {
    properties: { category },
    geometry: { type: geometryType, coordinates },
  }
}

describe('travel-time', () => {
  describe('estimateTravelTime', () => {
    it('returns null for unsupported category', () => {
      const f = makeFeature('mountain', 'LineString', [[0, 0], [10, 0]])
      expect(estimateTravelTime(f)).toBeNull()
    })

    it('returns null when category is missing', () => {
      const f = { properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [10, 0]] } }
      expect(estimateTravelTime(f)).toBeNull()
    })

    it('returns null for zero-length LineString', () => {
      const f = makeFeature('trade_route', 'LineString', [[0, 0], [0, 0]])
      expect(estimateTravelTime(f)).toBeNull()
    })

    it('returns null for unsupported geometry type (Point)', () => {
      const f = makeFeature('trade_route', 'Point', [0, 0])
      expect(estimateTravelTime(f)).toBeNull()
    })

    it('estimates a trade_route LineString', () => {
      // 40 svg units = 100 km; at 30 km/day → 3.33 days
      const f = makeFeature('trade_route', 'LineString', [[0, 0], [40, 0]])
      const est = estimateTravelTime(f)
      expect(est).not.toBeNull()
      expect(est!.km).toBeCloseTo(100, 5)
      expect(est!.speed).toBe(30)
      expect(est!.method).toBe('mixed caravan & coastal shipping')
      expect(est!.days).toBeCloseTo(100 / 30, 5)
    })

    it('estimates a river LineString', () => {
      // 100 km at 50 km/day → 2 days
      const f = makeFeature('river', 'LineString', [[0, 0], [40, 0]])
      const est = estimateTravelTime(f)
      expect(est).not.toBeNull()
      expect(est!.km).toBeCloseTo(100, 5)
      expect(est!.speed).toBe(50)
      expect(est!.days).toBeCloseTo(2, 5)
    })

    it('estimates a water Polygon (perimeter)', () => {
      // Square 10×10 svg → perimeter 40 svg = 100 km; at 80 km/day → 1.25 days
      const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
      const f = makeFeature('water', 'Polygon', [ring])
      const est = estimateTravelTime(f)
      expect(est).not.toBeNull()
      expect(est!.km).toBeCloseTo(100, 5)
      expect(est!.speed).toBe(80)
      expect(est!.days).toBeCloseTo(1.25, 5)
    })

    it('estimates a MultiLineString by summing all lines', () => {
      // Two segments: 40 svg + 30 svg = 70 svg = 175 km; at 50 km/day → 3.5 days
      const f = makeFeature('river', 'MultiLineString', [
        [[0, 0], [40, 0]],
        [[0, 0], [30, 0]],
      ])
      const est = estimateTravelTime(f)
      expect(est).not.toBeNull()
      expect(est!.km).toBeCloseTo(175, 5)
      expect(est!.days).toBeCloseTo(3.5, 5)
    })

    it('returns null for Polygon with degenerate zero-perimeter ring', () => {
      const ring = [[0, 0], [0, 0], [0, 0], [0, 0]]
      const f = makeFeature('water', 'Polygon', [ring])
      expect(estimateTravelTime(f)).toBeNull()
    })
  })

  describe('formatTravelEstimate', () => {
    it('formats <0.5 days as hours', () => {
      const est: TravelEstimate = { km: 10, days: 0.125, speed: 80, method: 'fast coastal ship' }
      expect(formatTravelEstimate(est)).toBe('~3 hours by fast coastal ship · 10 km')
    })

    it('formats exactly 1 hour without plural s', () => {
      const est: TravelEstimate = { km: 5, days: 1 / 24, speed: 80, method: 'fast coastal ship' }
      expect(formatTravelEstimate(est)).toBe('~1 hour by fast coastal ship · 5 km')
    })

    it('formats 0.5–2 days as fractional day', () => {
      const est: TravelEstimate = { km: 50, days: 0.625, speed: 80, method: 'fast coastal ship' }
      // Math.round(0.625 * 10) / 10 = 0.6
      expect(formatTravelEstimate(est)).toBe('~0.6 day by fast coastal ship · 50 km')
    })

    it('formats exactly 1 day without plural', () => {
      // days = 1 falls in < 2 branch
      const est: TravelEstimate = { km: 80, days: 1, speed: 80, method: 'fast coastal ship' }
      expect(formatTravelEstimate(est)).toBe('~1 day by fast coastal ship · 80 km')
    })

    it('formats ≥2 days as rounded whole days', () => {
      const est: TravelEstimate = { km: 200, days: 2.5, speed: 80, method: 'fast coastal ship' }
      expect(formatTravelEstimate(est)).toBe('~3 days by fast coastal ship · 200 km')
    })

    it('rounds km to nearest integer', () => {
      const est: TravelEstimate = { km: 12.4, days: 0.155, speed: 80, method: 'fast coastal ship' }
      expect(formatTravelEstimate(est)).toBe('~4 hours by fast coastal ship · 12 km')
    })
  })
})
