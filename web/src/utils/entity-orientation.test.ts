import { describe, it, expect } from 'vitest'
import { generateEntityOrientation } from './entity-orientation'
import type { CanonEntity } from '../components/compendium/types'

// Build a CanonEntity test fixture. The interface carries a structural index
// signature plus a few required-ish fields; cast keeps fixtures terse.
function mkEntity(overrides: Partial<CanonEntity> & { id: string }): CanonEntity {
  return { family: 'factions', ...overrides } as CanonEntity
}

describe('generateEntityOrientation', () => {
  it('restates the lede verbatim', () => {
    const lede = 'Oravan is "Fragmented (tolerant)" in the institutional typology, with three Havrana lineages that do not agree.'
    const e = mkEntity({ id: 'factions.civ.oravan', name: 'Oravan', scope: 'civ', civilization: 'oravan', lede })
    const out = generateEntityOrientation(e, [e])
    expect(out).toContain(lede)
  })

  it('slugifies the id into a readable name when name is null', () => {
    const e = mkEntity({ id: 'factions.civ.oravan', name: null, scope: 'civ', civilization: 'oravan' })
    const out = generateEntityOrientation(e, [e])
    expect(out).toMatch(/^Oravan is /)
    expect(out).not.toContain('factions.civ.oravan')
  })

  it('never emits markdown-link syntax', () => {
    const e = mkEntity({
      id: 'factions.civ.oravan',
      name: 'Oravan',
      scope: 'civ',
      civilization: 'oravan',
      lede: 'A clean lede with no link syntax at all.',
      tags: ['harbor-politics', 'wave-council'],
    })
    const out = generateEntityOrientation(e, [e])
    expect(out).not.toContain('](')
    expect(out).not.toContain('../')
  })

  describe('scope framing', () => {
    it('frames a per-civ faction grouping', () => {
      const e = mkEntity({ id: 'factions.civ.oravan', name: 'Oravan', scope: 'civ', civilization: 'oravan' })
      expect(generateEntityOrientation(e, [e])).toContain('one of the faction groupings within the Oravan civilization')
    })

    it('frames a trans-civ crisis', () => {
      const e = mkEntity({ id: 'factions.crisis.calendar_schism', name: 'The Calendar Schism', scope: 'trans-civ', entity_type: 'trans_civ_crisis' })
      expect(generateEntityOrientation(e, [e])).toContain('a basin-wide crisis that cuts across the civilizations')
    })

    it('frames a cross-civ relationship from civ_pair', () => {
      const e = mkEntity({
        id: 'factions.cross_civ.oravan_qollari',
        name: 'Oravan ↔ Qollari',
        scope: 'trans-civ',
        entity_type: 'cross_civ_relationship_matrix',
        civ_pair: ['oravan', 'qollari'],
      })
      expect(generateEntityOrientation(e, [e])).toContain('the relationship between the Oravan and Qollari civilizations')
    })

    it('frames a basin-wide grouping', () => {
      const e = mkEntity({ id: 'factions.civ.basin', name: 'The Aethelian Basin', scope: 'basin', entity_type: 'place_as_actor_faction_ecology' })
      // entity_type contains no special keyword → falls through to basin scope.
      expect(generateEntityOrientation(e, [e])).toContain('a basin-wide faction grouping')
    })
  })

  it('falls back gracefully when only name and type are recorded', () => {
    const e = mkEntity({ id: 'factions.civ.oravan', name: 'Oravan', scope: 'civ', civilization: 'oravan' })
    const out = generateEntityOrientation(e, [e])
    expect(out).toContain('little plain-language detail is recorded about Oravan yet')
  })

  describe('cross_refs resolution', () => {
    it('resolves known refs to their display name', () => {
      const target = mkEntity({ id: 'magic.system.oravan_tavamala', name: 'Oravan Tavamala' })
      const e = mkEntity({ id: 'factions.civ.oravan', name: 'Oravan', scope: 'civ', civilization: 'oravan', cross_refs: ['magic.system.oravan_tavamala'] })
      const out = generateEntityOrientation(e, [e, target])
      expect(out).toContain('Connected to: Oravan Tavamala.')
    })

    it('slugifies unknown refs without crashing', () => {
      const e = mkEntity({ id: 'factions.civ.oravan', name: 'Oravan', scope: 'civ', civilization: 'oravan', cross_refs: ['religion.deity_figure.maawara'] })
      const out = generateEntityOrientation(e, [e])
      expect(out).toContain('Connected to: Maawara.')
    })
  })

  it('includes themes from tags', () => {
    const e = mkEntity({ id: 'factions.civ.oravan', name: 'Oravan', scope: 'civ', civilization: 'oravan', tags: ['harbor-politics', 'wave-council'] })
    const out = generateEntityOrientation(e, [e])
    expect(out).toContain('Themes: harbor politics, wave council.')
  })
})
