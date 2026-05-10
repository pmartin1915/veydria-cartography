import { describe, it, expect, vi } from 'vitest'
import { captureMapPng, suggestSnapshotFilename } from './map-snapshot'

// Capture the options passed to html-to-image so we can inspect ratio math.
let lastToPngCall: { target: HTMLElement; options: Record<string, unknown> } | null = null

vi.mock('html-to-image', () => ({
  toPng: vi.fn(async (target: HTMLElement, options: Record<string, unknown>) => {
    lastToPngCall = { target, options }
    return 'data:image/png;base64,MOCK='
  }),
}))

function makeTarget(width: number, height: number): HTMLElement {
  return {
    getBoundingClientRect: () => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => {},
    }),
  } as unknown as HTMLElement
}

describe('suggestSnapshotFilename', () => {
  it('starts with veydria- and ends with .png', () => {
    const name = suggestSnapshotFilename()
    expect(name.startsWith('veydria-')).toBe(true)
    expect(name.endsWith('.png')).toBe(true)
  })

  it('includes current date components', () => {
    const d = new Date()
    const name = suggestSnapshotFilename()
    const pad = (n: number) => String(n).padStart(2, '0')
    const expectedPrefix = `veydria-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-`
    expect(name.startsWith(expectedPrefix)).toBe(true)
  })

  it('includes current time components', () => {
    const d = new Date()
    const name = suggestSnapshotFilename()
    const pad = (n: number) => String(n).padStart(2, '0')
    const expectedTime = `${pad(d.getHours())}${pad(d.getMinutes())}`
    expect(name.includes(expectedTime)).toBe(true)
  })

  it('formats single-digit month/day/hour/minute with leading zero', () => {
    // We can't easily mock Date() without replacing the global constructor,
    // but we can verify the pattern matches YYYYMMDD-HHMM.
    const name = suggestSnapshotFilename()
    expect(/^veydria-\d{8}-\d{4}\.png$/.test(name)).toBe(true)
  })
})

describe('captureMapPng', () => {
  it('passes through pixelRatio 2 for a small target', async () => {
    const target = makeTarget(400, 300)
    await captureMapPng({ target })
    expect(lastToPngCall).not.toBeNull()
    expect(lastToPngCall!.options.pixelRatio).toBe(2)
  })

  it('uses custom pixelRatio when under the cap', async () => {
    const target = makeTarget(400, 300)
    await captureMapPng({ target, pixelRatio: 3 })
    expect(lastToPngCall!.options.pixelRatio).toBe(3)
  })

  it('caps pixelRatio when requested output exceeds 6 MP', async () => {
    // 2000x1500 at ratio 2 = 2000*1500*4 = 12_000_000 pixels (> 6M)
    const target = makeTarget(2000, 1500)
    await captureMapPng({ target, pixelRatio: 2 })
    const ratio = lastToPngCall!.options.pixelRatio as number
    expect(ratio).toBeLessThan(2)
    // 6_000_000 / (2000 * 1500) = 2.0, sqrt = ~1.414
    expect(ratio).toBeCloseTo(Math.sqrt(6_000_000 / (2000 * 1500)), 5)
  })

  it('caps at exactly the threshold for a very large viewport', async () => {
    // 3840x2160 (4K) at ratio 2 = 3840*2160*4 ≈ 33.1 MP
    const target = makeTarget(3840, 2160)
    await captureMapPng({ target, pixelRatio: 2 })
    const ratio = lastToPngCall!.options.pixelRatio as number
    const outputPixels = 3840 * 2160 * ratio * ratio
    expect(outputPixels).toBeLessThanOrEqual(6_000_000 + 1) // +1 for float rounding
  })

  it('does not cap when output is exactly at the limit', async () => {
    // Find dimensions where 2x exactly equals 6 MP: w*h = 1_500_000
    const target = makeTarget(1500, 1000)
    await captureMapPng({ target, pixelRatio: 2 })
    expect(lastToPngCall!.options.pixelRatio).toBe(2)
  })

  it('sets cacheBust to true', async () => {
    const target = makeTarget(100, 100)
    await captureMapPng({ target })
    expect(lastToPngCall!.options.cacheBust).toBe(true)
  })

  it('passes the same target element to toPng', async () => {
    const target = makeTarget(100, 100)
    await captureMapPng({ target })
    expect(lastToPngCall!.target).toBe(target)
  })

  it('default pixelRatio is 2 when not specified', async () => {
    const target = makeTarget(100, 100)
    await captureMapPng({ target })
    expect(lastToPngCall!.options.pixelRatio).toBe(2)
  })
})
