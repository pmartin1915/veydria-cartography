import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { parseAsterisms, type Asterism } from './asterisms'

function row(over: Partial<Asterism> = {}): Asterism {
  return {
    id: 'religion.tradition.star_register.serakar',
    civ: 'oravan',
    kind: 'asterism',
    placement: 'sky',
    prose_label: 'Serakar — the Crown Star',
    gloss: 'The fixed pole.',
    etymology: 'sera + kar',
    illustration_ref: null,
    ...over,
  }
}

describe('parseAsterisms', () => {
  it('parses well-formed entries into typed rows', () => {
    const out = parseAsterisms({ asterisms: [row(), row({ id: 'x.y.z', prose_label: 'Vanasera' })] })
    expect(out).toHaveLength(2)
    expect(out[0].kind).toBe('asterism')
    expect(out[0].placement).toBe('sky')
    expect(out[1].prose_label).toBe('Vanasera')
  })

  it('accepts a string illustration_ref as well as null', () => {
    const out = parseAsterisms({ asterisms: [row({ illustration_ref: 'art/serakar.svg' })] })
    expect(out[0].illustration_ref).toBe('art/serakar.svg')
  })

  it('drops a row missing a required field', () => {
    const bad = { ...row() } as Record<string, unknown>
    delete bad.gloss
    expect(parseAsterisms({ asterisms: [row(), bad] })).toHaveLength(1)
  })

  it('drops a row with an out-of-enum kind or placement', () => {
    const out = parseAsterisms({
      asterisms: [
        row({ kind: 'constellation' as Asterism['kind'] }),
        row({ placement: 'land' as Asterism['placement'] }),
        row(),
      ],
    })
    expect(out).toHaveLength(1)
  })

  it('tolerates a non-array / null / missing payload → []', () => {
    expect(parseAsterisms(null)).toEqual([])
    expect(parseAsterisms({})).toEqual([])
    expect(parseAsterisms({ asterisms: 'nope' })).toEqual([])
    expect(parseAsterisms({ asterisms: null })).toEqual([])
  })
})

describe('asterisms.json (the generated extract)', () => {
  // Canon guard: pins the committed extract to the ratified star-register so a
  // future canon change to the figures is caught here.
  const file = JSON.parse(
    readFileSync(new URL('../../public/asterisms.json', import.meta.url), 'utf8'),
  )
  const entries = parseAsterisms(file)

  it('holds the six ratified Oravan star-figures', () => {
    expect(entries).toHaveLength(6)
    expect(entries.every((e) => e.civ === 'oravan')).toBe(true)
    expect(entries.every((e) => e.kind === 'asterism')).toBe(true)
    expect(entries.every((e) => e.placement === 'sky')).toBe(true)
    expect(entries.every((e) => e.illustration_ref === null)).toBe(true)
  })

  it('carries the expected ids and prose labels in register order', () => {
    expect(entries.map((e) => e.id)).toEqual([
      'religion.tradition.star_register.serakar',
      'religion.tradition.star_register.vanasera',
      'religion.tradition.star_register.murasera',
      'religion.tradition.star_register.measera',
      'religion.tradition.star_register.serama',
      'religion.tradition.star_register.seraili',
    ])
    expect(entries.map((e) => e.prose_label)).toEqual([
      'Serakar — the Crown Star',
      'Vanasera — the Landfall Star',
      'Murasera — the Storm-Star',
      'Measera — the Dawn-Star',
      'Serama — the Star-River',
      'Seraili — the Remembered Stars',
    ])
  })
})
