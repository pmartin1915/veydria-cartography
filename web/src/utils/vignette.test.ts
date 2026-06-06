import { describe, it, expect } from 'vitest'
import { selectVignette } from './vignette'

describe('selectVignette', () => {
  it('maps each civ to its attested mode + backdrop', () => {
    const cases: Record<string, { mode: string; backdrop: string }> = {
      kheshkai: { mode: 'horse', backdrop: 'steppe-cliff' },
      irrah: { mode: 'camel', backdrop: 'desert-oasis' },
      qollari: { mode: 'llama', backdrop: 'cloud-forest-terrace' },
      ngaru_bon: { mode: 'porter', backdrop: 'plateau-savanna' },
      ndjadi: { mode: 'river-boat', backdrop: 'delta-mangrove' },
      oravan: { mode: 'sea-ship', backdrop: 'volcanic-reef' },
    }
    for (const [civ, want] of Object.entries(cases)) {
      const s = selectVignette({ fromCiv: civ, toCiv: civ })
      expect(s.mode).toBe(want.mode)
      expect(s.backdrop).toBe(want.backdrop)
    }
  })

  it('uses the named end when one endpoint is civ-less', () => {
    expect(selectVignette({ fromCiv: 'irrah', toCiv: undefined }).mode).toBe('camel')
    expect(selectVignette({ fromCiv: undefined, toCiv: 'kheshkai' }).mode).toBe('horse')
  })

  it('prefers the destination civ on a land crossing', () => {
    // kheshkai → qollari : entering Qollari → llama
    expect(selectVignette({ fromCiv: 'kheshkai', toCiv: 'qollari' }).mode).toBe('llama')
  })

  it('lets a water civ win the scene on a crossing (boat dominates)', () => {
    // Either direction across the Halkar strait reads as Oravan sea-ship.
    expect(selectVignette({ fromCiv: 'oravan', toCiv: 'irrah' }).mode).toBe('sea-ship')
    expect(selectVignette({ fromCiv: 'kheshkai', toCiv: 'oravan' }).mode).toBe('sea-ship')
    // Ndjadi delta crossing → river-boat regardless of the other end.
    expect(selectVignette({ fromCiv: 'kheshkai', toCiv: 'ndjadi' }).mode).toBe('river-boat')
  })

  it('infers the region from the midpoint biome when both ends are civ-less', () => {
    expect(selectVignette({ biome: 'Desert' }).mode).toBe('camel')
    expect(selectVignette({ biome: 'Cloud forest' }).mode).toBe('llama')
    expect(selectVignette({ biome: 'Coral reef' }).mode).toBe('sea-ship')
  })

  it('falls back to a neutral open-road scene for unknown regions', () => {
    const s = selectVignette({ biome: 'Sea' })
    expect(s.backdrop).toBe('open-road')
    expect(s.mode).toBe('porter')
    expect(s.regionLabel).toBe('Open road')
    expect(s.modeLabel).toBe('On foot')
  })

  it('prefers an authored civ over biome inference', () => {
    // A desert biome midpoint but the segment is authored kheshkai → horse wins.
    expect(selectVignette({ fromCiv: 'kheshkai', toCiv: 'kheshkai', biome: 'Desert' }).mode).toBe('horse')
  })
})
