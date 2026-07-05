// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { graticuleLines, STEP_SVG } from './graticule-overlay'

describe('graticuleLines', () => {
  it('produces 13 vertical lines and 9 horizontal lines for the 1200×800 map', () => {
    const { verticals, horizontals } = graticuleLines()
    expect(verticals).toHaveLength(13)
    expect(horizontals).toHaveLength(9)
  })

  it('spans the full SVG extent', () => {
    const { verticals, horizontals } = graticuleLines()
    expect(verticals[0].x1).toBe(0)
    expect(verticals[verticals.length - 1].x1).toBe(1200)
    expect(horizontals[0].y1).toBe(0)
    expect(horizontals[horizontals.length - 1].y1).toBe(800)
  })

  it('steps by 100 SVG units (250 km)', () => {
    const { verticals, horizontals } = graticuleLines()
    for (let i = 1; i < verticals.length; i++) {
      expect(verticals[i].x1 - verticals[i - 1].x1).toBe(STEP_SVG)
    }
    for (let i = 1; i < horizontals.length; i++) {
      expect(horizontals[i].y1 - horizontals[i - 1].y1).toBe(STEP_SVG)
    }
  })

  it('labels verticals with easting kilometres', () => {
    const { verticals } = graticuleLines()
    expect(verticals[0].label).toBe('0')
    expect(verticals[verticals.length - 1].label).toBe('3000')
    expect(verticals.find((l) => l.x1 === 600)?.label).toBe('1500')
  })

  it('labels horizontals with northing kilometres, flipped for SVG Y-down', () => {
    const { horizontals } = graticuleLines()
    expect(horizontals[0].label).toBe('2000')
    expect(horizontals[horizontals.length - 1].label).toBe('0')
    expect(horizontals.find((l) => l.y1 === 400)?.label).toBe('1000')
  })
})
