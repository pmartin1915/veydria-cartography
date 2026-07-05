import { describe, expect, it } from 'vitest'
import {
  worldScale,
  svgToWorldKm,
  worldKmToSvg,
  svgDistanceKm,
  bearingDegrees,
  compass8,
  compass16,
} from './world-coords'

describe('world-coords', () => {
  describe('worldScale', () => {
    it('locks the canonical scale constants', () => {
      // measure.ts re-exports these; changing them recalibrates the whole map
      expect(worldScale.kmPerSvgUnit).toBe(2.5)
      expect(worldScale.leaguesPerKm).toBe(0.25)
      expect(worldScale.svgWidth).toBe(1200)
      expect(worldScale.svgHeight).toBe(800)
    })
  })

  describe('svgToWorldKm / worldKmToSvg', () => {
    it('maps the SW corner (SVG bottom-left) to the world origin', () => {
      expect(svgToWorldKm({ x: 0, y: 800 })).toEqual({ eastKm: 0, northKm: 0 })
    })

    it('maps the NE corner (SVG top-right) to the world extent', () => {
      expect(svgToWorldKm({ x: 1200, y: 0 })).toEqual({ eastKm: 3000, northKm: 2000 })
    })

    it('flips Y: smaller SVG y is further north', () => {
      const south = svgToWorldKm({ x: 600, y: 700 })
      const north = svgToWorldKm({ x: 600, y: 100 })
      expect(north.northKm).toBeGreaterThan(south.northKm)
    })

    it('round-trips corners and centre exactly', () => {
      const points = [
        { x: 0, y: 0 },
        { x: 1200, y: 0 },
        { x: 0, y: 800 },
        { x: 1200, y: 800 },
        { x: 600, y: 400 },
        { x: 123.4, y: 567.8 },
      ]
      for (const p of points) {
        const back = worldKmToSvg(svgToWorldKm(p))
        expect(back.x).toBeCloseTo(p.x, 9)
        expect(back.y).toBeCloseTo(p.y, 9)
      }
    })
  })

  describe('svgDistanceKm', () => {
    it('scales a horizontal segment by 2.5 km/unit', () => {
      expect(svgDistanceKm({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(250)
    })

    it('is symmetric and handles diagonals', () => {
      const a = { x: 0, y: 0 }
      const b = { x: 30, y: 40 } // 3-4-5 triangle → 50 SVG units → 125 km
      expect(svgDistanceKm(a, b)).toBe(125)
      expect(svgDistanceKm(b, a)).toBe(125)
    })
  })

  describe('bearingDegrees — Y-flip guard', () => {
    // SVG is Y-down: "up the screen" (decreasing y) must read as NORTH.
    // Get these four wrong and every direction in the app is mirrored.
    const o = { x: 100, y: 100 }

    it('cardinals', () => {
      expect(bearingDegrees(o, { x: 100, y: 90 })).toBe(0) // up → N
      expect(bearingDegrees(o, { x: 110, y: 100 })).toBe(90) // right → E
      expect(bearingDegrees(o, { x: 100, y: 110 })).toBe(180) // down → S
      expect(bearingDegrees(o, { x: 90, y: 100 })).toBe(270) // left → W
    })

    it('diagonals', () => {
      expect(bearingDegrees(o, { x: 110, y: 90 })).toBe(45) // NE
      expect(bearingDegrees(o, { x: 110, y: 110 })).toBe(135) // SE
      expect(bearingDegrees(o, { x: 90, y: 110 })).toBe(225) // SW
      expect(bearingDegrees(o, { x: 90, y: 90 })).toBe(315) // NW
    })

    it('returns 0 for coincident points', () => {
      expect(bearingDegrees(o, o)).toBe(0)
    })

    it('always lands in [0, 360)', () => {
      for (let deg = 0; deg < 360; deg += 15) {
        const rad = (deg * Math.PI) / 180
        // Construct a target at compass angle `deg` in SVG space (Y-down)
        const to = { x: o.x + Math.sin(rad), y: o.y - Math.cos(rad) }
        const b = bearingDegrees(o, to)
        expect(b).toBeGreaterThanOrEqual(0)
        expect(b).toBeLessThan(360)
        expect(b).toBeCloseTo(deg, 6)
      }
    })
  })

  describe('compass8 / compass16', () => {
    it('names the cardinals', () => {
      expect(compass8(0)).toBe('N')
      expect(compass8(90)).toBe('E')
      expect(compass8(180)).toBe('S')
      expect(compass8(270)).toBe('W')
      expect(compass16(0)).toBe('N')
      expect(compass16(90)).toBe('E')
    })

    it('handles the 0/360 wrap seam', () => {
      // 16-wind sectors are 22.5° wide, centred on the wind: N spans [348.75, 11.25)
      expect(compass16(348.75)).toBe('N')
      expect(compass16(11.24)).toBe('N')
      expect(compass16(11.26)).toBe('NNE')
      expect(compass16(359.999)).toBe('N')
      // 8-wind: N spans [337.5, 22.5)
      expect(compass8(337.5)).toBe('N')
      expect(compass8(22.4)).toBe('N')
      expect(compass8(22.6)).toBe('NE')
    })

    it('names all 16 winds at their exact headings', () => {
      const winds = [
        'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
        'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
      ]
      winds.forEach((wind, i) => {
        expect(compass16(i * 22.5)).toBe(wind)
      })
    })

    it('tolerates out-of-range input (negative / >360)', () => {
      expect(compass16(-11)).toBe('N')
      expect(compass16(450)).toBe('E')
      expect(compass8(-90)).toBe('W')
    })
  })
})
