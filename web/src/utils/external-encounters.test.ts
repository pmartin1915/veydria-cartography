import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  setExternalEncounters,
  getExternalEncounters,
  externalBeatsFor,
  augmentPoolWithWeighted,
  loadExternalEncounters,
  type ExternalEncounterFile,
} from './external-encounters'
import { generateEncounters, type Beat } from './encounters'
import type { JourneyRoute } from './journey-graph'

const FIXTURE: ExternalEncounterFile = {
  schema_version: 1,
  controlled_vocabularies: { frequency_weight: { common: 3, uncommon: 2, rare: 1 } },
  encounters: [
    // Oravan, region-wide (no biome)
    { key: 'oravan.a', civ: 'oravan', prose_label: 'A', type: 'social', severity: 'mild', frequency: 'common' },
    { key: 'oravan.b', civ: 'oravan', prose_label: 'B', type: 'environmental', severity: 'moderate', frequency: 'uncommon', time: 'dusk' },
    { key: 'oravan.c', civ: 'oravan', prose_label: 'C', type: 'combat', severity: 'severe', frequency: 'rare', sensory_hook: 'hook' },
    // Oravan, biome-specific
    { key: 'oravan.v', civ: 'oravan', prose_label: 'V', type: 'environmental', severity: 'moderate', frequency: 'uncommon', biome: 'Volcanic archipelago' },
    // Different civ — must never match an oravan segment
    { key: 'ndjadi.x', civ: 'ndjadi', prose_label: 'X', type: 'social', severity: 'mild', frequency: 'common' },
  ],
}

const BASE_POOL: Beat[] = [{ text: 'base', type: 'social', severity: 'mild' }]

beforeEach(() => setExternalEncounters(null))
afterEach(() => setExternalEncounters(null))

describe('external-encounters — dormancy (byte-identity guard)', () => {
  it('augmentPoolWithWeighted returns the SAME pool when no external data is loaded', () => {
    expect(augmentPoolWithWeighted(BASE_POOL, ['oravan'], 'trade_route')).toBe(BASE_POOL)
  })

  it('returns the same pool when no encounter matches the civ', () => {
    setExternalEncounters(FIXTURE)
    expect(augmentPoolWithWeighted(BASE_POOL, ['kheshkai'], 'trade_route')).toBe(BASE_POOL)
  })

  it('never augments chokepoint edges (sim-authored per ADR-0022 D5)', () => {
    setExternalEncounters(FIXTURE)
    expect(augmentPoolWithWeighted(BASE_POOL, ['oravan'], 'chokepoint')).toBe(BASE_POOL)
  })

  it('does not mutate the input pool', () => {
    setExternalEncounters(FIXTURE)
    const before = BASE_POOL.length
    augmentPoolWithWeighted(BASE_POOL, ['oravan'], 'trade_route')
    expect(BASE_POOL.length).toBe(before)
  })
})

describe('external-encounters — frequency weighting & filters', () => {
  beforeEach(() => setExternalEncounters(FIXTURE))

  it('replicates region-wide beats by weight (common=3, uncommon=2, rare=1)', () => {
    // No segment biome → region-wide only: a(3) + b(2) + c(1) = 6.
    const extra = externalBeatsFor(['oravan'], 'trade_route')
    expect(extra.length).toBe(6)
  })

  it('includes a biome-specific beat only when the segment biome matches', () => {
    // Volcanic archipelago → region-wide (6) + v(2) = 8.
    expect(externalBeatsFor(['oravan'], 'trade_route', 'Volcanic archipelago').length).toBe(8)
    // A non-matching biome → only region-wide (6).
    expect(externalBeatsFor(['oravan'], 'trade_route', 'Desert').length).toBe(6)
  })

  it('matches on any endpoint civ and excludes other civs', () => {
    const extra = externalBeatsFor(['ndjadi', 'oravan'], 'intra_civ')
    // oravan region-wide (6) + ndjadi region-wide common x.x (3) = 9; never the unrelated nothing.
    expect(extra.length).toBe(9)
  })

  it('carries type/severity through and composes text from prose_label + sensory_hook', () => {
    const extra = externalBeatsFor(['oravan'], 'trade_route')
    const combat = extra.find(b => b.type === 'combat')!
    expect(combat.severity).toBe('severe')
    expect(combat.text).toBe('C — hook')
  })

  it('appends to the base pool, preserving the base entries', () => {
    const out = augmentPoolWithWeighted(BASE_POOL, ['oravan'], 'trade_route')
    expect(out.length).toBe(BASE_POOL.length + 6)
    expect(out[0]).toBe(BASE_POOL[0])
  })
})

function oravanRoute(): JourneyRoute {
  return {
    nodes: [
      { id: 'or', name: 'Oravan', category: 'civilization', x: 0, y: 0, civ: 'oravan' },
      { id: 'or2', name: 'Oravan2', category: 'port', x: 100, y: 0, civ: 'oravan' },
    ],
    edges: [{ from: 'or', to: 'or2', distanceSvg: 100, type: 'intra_civ', name: 'leg', segmentDays: 2 }],
    totalDistanceSvg: 100,
    totalKm: 100,
    estimatedDays: 2,
    bottlenecks: [],
    seasonalWarnings: [],
  }
}

describe('external-encounters — generateEncounters integration', () => {
  it('default (no external) is deterministic and unchanged after arm→disarm', () => {
    const r = oravanRoute()
    const baseline = generateEncounters(r, 'spring', 'direct')
    setExternalEncounters(FIXTURE)
    generateEncounters(r, 'spring', 'direct') // armed — may differ
    setExternalEncounters(null)
    expect(generateEncounters(r, 'spring', 'direct')).toEqual(baseline)
  })

  it('stays deterministic with external data armed', () => {
    setExternalEncounters(FIXTURE)
    const r = oravanRoute()
    expect(generateEncounters(r, 'spring', 'direct')).toEqual(generateEncounters(r, 'spring', 'direct'))
  })
})

describe('external-encounters — loader', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('arms augmentation from a fetched file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => FIXTURE })))
    await loadExternalEncounters()
    expect(getExternalEncounters()).not.toBeNull()
    expect(externalBeatsFor(['oravan'], 'trade_route').length).toBe(6)
  })

  it('degrades silently to default pools on a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => null })))
    await loadExternalEncounters()
    expect(getExternalEncounters()).toBeNull()
  })

  it('never throws when fetch rejects (offline)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(loadExternalEncounters()).resolves.toBeUndefined()
    expect(getExternalEncounters()).toBeNull()
  })
})
