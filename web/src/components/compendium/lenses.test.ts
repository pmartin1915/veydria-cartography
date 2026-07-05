import { describe, it, expect } from 'vitest'
import { LENSES, type CanonEntity } from './types'

/**
 * Mirror the switch block in CompendiumPanel.tsx so the test exercises the
 * same filtering rule the UI uses. Keep this in sync with the switch.
 */
function filterEntitiesForLens(entities: CanonEntity[], lens: string): CanonEntity[] {
  switch (lens) {
    case 'cross-civ':
      return entities.filter((e) => e.family === 'cross_civ_relationship')
    case 'crises':
      return entities.filter((e) => e.family === 'crisis' || e.family === 'cold_war')
    case 'magic':
      return entities.filter((e) => e.family === 'magic')
    case 'traditions':
      return entities.filter((e) => e.entity_type === 'tradition')
    case 'resources':
      return entities.filter((e) => e.family === 'resource_governance')
    case 'institutions':
      return entities.filter((e) => e.entity_type === 'institution')
    case 'figures':
      return entities.filter((e) => e.entity_type === 'deity_figure')
    case 'characters':
      return entities.filter((e) => e.entity_type === 'character')
    case 'record-keeping':
      return entities.filter((e) => e.entity_type === 'record_medium')
    case 'underclass':
      return entities.filter((e) => e.entity_type === 'underclass_life')
    case 'funerary':
      return entities.filter((e) => e.entity_type === 'funerary_practice')
    default:
      return []
  }
}

describe('compendium lenses', () => {
  const fixture: CanonEntity[] = [
    { id: 'a', name: 'A', entity_type: 'character', schema_version: '0.1.0', type: 'entity' },
    { id: 'b', name: 'B', entity_type: 'record_medium', schema_version: '0.1.0', type: 'entity' },
    { id: 'c', name: 'C', entity_type: 'underclass_life', schema_version: '0.1.0', type: 'entity' },
    { id: 'd', name: 'D', entity_type: 'funerary_practice', schema_version: '0.1.0', type: 'entity' },
    { id: 'e', name: 'E', entity_type: 'deity_figure', schema_version: '0.1.0', type: 'entity' },
    { id: 'f', name: 'F', entity_type: 'institution', schema_version: '0.1.0', type: 'entity' },
    { id: 'g', name: 'G', entity_type: 'tradition', schema_version: '0.1.0', type: 'entity' },
  ]

  it('lists the four new lenses after "Named Figures" in order', () => {
    const keys = LENSES.map((l) => l.key)
    const figuresIndex = keys.indexOf('figures')
    expect(figuresIndex).toBeGreaterThanOrEqual(0)
    expect(keys.slice(figuresIndex + 1, figuresIndex + 5)).toEqual([
      'characters',
      'record-keeping',
      'underclass',
      'funerary',
    ])
  })

  it('characters lens filters to entity_type === "character"', () => {
    const result = filterEntitiesForLens(fixture, 'characters')
    expect(result.map((e) => e.id)).toEqual(['a'])
  })

  it('record-keeping lens filters to entity_type === "record_medium"', () => {
    const result = filterEntitiesForLens(fixture, 'record-keeping')
    expect(result.map((e) => e.id)).toEqual(['b'])
  })

  it('underclass lens filters to entity_type === "underclass_life"', () => {
    const result = filterEntitiesForLens(fixture, 'underclass')
    expect(result.map((e) => e.id)).toEqual(['c'])
  })

  it('funerary lens filters to entity_type === "funerary_practice"', () => {
    const result = filterEntitiesForLens(fixture, 'funerary')
    expect(result.map((e) => e.id)).toEqual(['d'])
  })

  it('leaves existing lens filters unchanged', () => {
    expect(filterEntitiesForLens(fixture, 'figures').map((e) => e.id)).toEqual(['e'])
    expect(filterEntitiesForLens(fixture, 'institutions').map((e) => e.id)).toEqual(['f'])
    expect(filterEntitiesForLens(fixture, 'traditions').map((e) => e.id)).toEqual(['g'])
  })
})
