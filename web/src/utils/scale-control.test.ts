// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { niceScaleStep } from './scale-control'

describe('niceScaleStep', () => {
  it('returns 100 km when 1 km/px fits in 120 px', () => {
    expect(niceScaleStep(1, 120)).toBe(100)
  })

  it('returns 200 km when 2.5 km/px fits in 120 px', () => {
    expect(niceScaleStep(2.5, 120)).toBe(200)
  })

  it('is monotonic: coarser resolution never produces a smaller step', () => {
    const steps = [0.1, 0.5, 1, 2.5, 5, 10].map((kmPerPx) => niceScaleStep(kmPerPx, 120))
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1])
    }
  })

  it('always returns a 1/2/5×10ⁿ value', () => {
    const candidates = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100]
    for (const kmPerPx of candidates) {
      const step = niceScaleStep(kmPerPx, 120)
      const exponent = Math.floor(Math.log10(step))
      const mantissa = step / 10 ** exponent
      expect([1, 2, 5].map(String)).toContain(String(Number(mantissa.toFixed(6))))
    }
  })

  it('returns 0 for invalid input', () => {
    expect(niceScaleStep(0, 120)).toBe(0)
    expect(niceScaleStep(-1, 120)).toBe(0)
    expect(niceScaleStep(1, 0)).toBe(0)
    expect(niceScaleStep(Number.NaN, 120)).toBe(0)
  })
})
