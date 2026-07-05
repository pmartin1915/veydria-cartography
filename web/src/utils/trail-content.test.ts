import { describe, it, expect } from 'vitest'
import {
  AILMENTS,
  pickAilment,
  normalizeCivSlug,
  RANK_SLOTS,
  RANK_TABLES,
  GENERIC_RANKS,
  rankLabel,
  type AilmentContext,
} from './trail-content'
import { HUNT_ODDS } from './trail'
import { CIVS } from '../components/compendium/types'

const CALM: AilmentContext = { arid: false, supplyStress: 0 }

describe('normalizeCivSlug', () => {
  it('maps roster underscore slugs to canonical CivSlug form', () => {
    expect(normalizeCivSlug('ngaru_bon')).toBe('ngaru-bon')
    expect(normalizeCivSlug('aethelian_basin')).toBe('basin')
    expect(normalizeCivSlug('irrah')).toBe('irrah')
  })

  it('returns undefined for unknown or missing slugs', () => {
    expect(normalizeCivSlug('atlantis')).toBeUndefined()
    expect(normalizeCivSlug(undefined)).toBeUndefined()
    expect(normalizeCivSlug('')).toBeUndefined()
  })
})

describe('AILMENTS table', () => {
  it('only gates on biomes in the HUNT_ODDS vocabulary (drift guard)', () => {
    const known = new Set(Object.keys(HUNT_ODDS))
    for (const a of AILMENTS) {
      for (const b of a.biomes ?? []) {
        expect(known.has(b), `${a.id} gates on unknown biome ${b}`).toBe(true)
      }
    }
  })

  it('always has ungated entries so the candidate set is never empty', () => {
    const anytime = AILMENTS.filter(a => !a.aridOnly && !a.biomes)
    expect(anytime.length).toBeGreaterThan(0)
  })
})

describe('pickAilment', () => {
  it('is deterministic: same seed + context → same name', () => {
    const ctx: AilmentContext = { biome: 'Desert', arid: true, supplyStress: 1, civ: 'irrah' }
    for (const seed of [0, 1, 42, 0xdeadbeef]) {
      expect(pickAilment(seed, ctx)).toBe(pickAilment(seed, ctx))
    }
  })

  it('yields several distinct names across seeds for one context', () => {
    const names = new Set<string>()
    for (let seed = 0; seed < 200; seed++) names.add(pickAilment(seed, { ...CALM, arid: true }))
    expect(names.size).toBeGreaterThan(3)
  })

  it('never yields arid- or biome-gated names outside their context', () => {
    const gatedNames = new Set(
      AILMENTS.filter(a => a.aridOnly || a.biomes).map(a => a.name),
    )
    for (let seed = 0; seed < 300; seed++) {
      const name = pickAilment(seed, CALM) // no biome, not arid
      expect(gatedNames.has(name), `${name} leaked outside its gate`).toBe(false)
    }
  })

  it('can yield sabkha sickness on Sabkha days', () => {
    const names = new Set<string>()
    for (let seed = 0; seed < 300; seed++) {
      names.add(pickAilment(seed, { biome: 'Sabkha', arid: true, supplyStress: 0 }))
    }
    expect(names.has('sabkha sickness')).toBe(true)
  })

  it('returns a valid candidate for every biome × aridity combination', () => {
    const biomes = [...Object.keys(HUNT_ODDS), undefined]
    const allNames = new Set(AILMENTS.map(a => a.name))
    for (const biome of biomes) {
      for (const arid of [true, false]) {
        const name = pickAilment(7, { biome, arid, supplyStress: 0 })
        expect(allNames.has(name)).toBe(true)
      }
    }
  })

  it('biases sandpox toward Oravan members', () => {
    let oravan = 0
    let other = 0
    for (let seed = 0; seed < 500; seed++) {
      if (pickAilment(seed, { ...CALM, civ: 'oravan' }) === 'sandpox') oravan++
      if (pickAilment(seed, { ...CALM, civ: 'kheshkai' }) === 'sandpox') other++
    }
    expect(oravan).toBeGreaterThan(other)
  })
})

describe('rank ladders', () => {
  it('defines a non-empty label for all 7 civs × 7 slots', () => {
    for (const civ of CIVS) {
      for (const slot of RANK_SLOTS) {
        const label = RANK_TABLES[civ][slot]
        expect(typeof label).toBe('string')
        expect(label.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps the former provisional labels as the generic fallback', () => {
    expect(GENERIC_RANKS.flawless).toBe('Trail Warden')
    expect(GENERIC_RANKS.perished).toBe('Lost to the Road')
    expect(rankLabel('atlantis', 'aborted')).toBe('Turn-Back')
    expect(rankLabel(undefined, 'party-wiped')).toBe('Bones in the Sand')
  })

  it('resolves roster underscore slugs to their civ ladder', () => {
    expect(rankLabel('ngaru_bon', 'flawless')).toBe(RANK_TABLES['ngaru-bon'].flawless)
    expect(rankLabel('aethelian_basin', 'few')).toBe(RANK_TABLES.basin.few)
  })
})
