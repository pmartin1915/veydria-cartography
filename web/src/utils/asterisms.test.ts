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
  // The six register star-figures and the abstract cartouche device are pinned
  // separately: the cartouche (kind: cartouche) is NOT one of the six ratified
  // figures, so it must never leak into the figures count / register-order pins.
  const figures = entries.filter((e) => e.kind === 'asterism')
  const cartouches = entries.filter((e) => e.kind === 'cartouche')
  const fauna = entries.filter((e) => e.kind === 'fauna')

  it('holds exactly the fourteen extract rows (six figures + one cartouche + seven fauna)', () => {
    expect(entries).toHaveLength(14)
    expect(figures).toHaveLength(6)
    expect(cartouches).toHaveLength(1)
    expect(fauna).toHaveLength(7)
    // Stars + cartouche are Oravan sky-marginalia; the picture is always app art.
    expect(figures.concat(cartouches).every((e) => e.civ === 'oravan')).toBe(true)
    expect(figures.concat(cartouches).every((e) => e.placement === 'sky')).toBe(true)
    expect(entries.every((e) => e.illustration_ref === null)).toBe(true)
  })

  it('holds the seven attested ocean-fauna engravings (layer B, open water)', () => {
    expect(fauna).toHaveLength(7)
    expect(fauna.every((e) => e.kind === 'fauna')).toBe(true)
    expect(fauna.every((e) => e.placement === 'open_water')).toBe(true)
    // Region-aware: each fauna's civ is the home region whose waters it lives in.
    expect(fauna.every((e) => e.civ === 'oravan' || e.civ === 'aethelian')).toBe(true)
    expect(fauna.map((e) => e.id)).toEqual([
      'ecology.fauna.oravan.sea_snake',
      'ecology.fauna.oravan.saltwater_crocodile',
      'ecology.fauna.oravan.reef_grouper',
      'ecology.fauna.aethelian.bluefin_tuna',
      'ecology.fauna.aethelian.bottlenose_dolphin',
      'ecology.fauna.aethelian.monk_seal',
      'ecology.fauna.aethelian.loggerhead_turtle',
    ])
  })

  it('holds the six ratified Oravan star-figures', () => {
    expect(figures).toHaveLength(6)
    expect(figures.every((e) => e.kind === 'asterism')).toBe(true)
    expect(figures.every((e) => e.placement === 'sky')).toBe(true)
  })

  it('carries the expected figure ids and prose labels in register order', () => {
    expect(figures.map((e) => e.id)).toEqual([
      'religion.tradition.star_register.serakar',
      'religion.tradition.star_register.vanasera',
      'religion.tradition.star_register.murasera',
      'religion.tradition.star_register.measera',
      'religion.tradition.star_register.serama',
      'religion.tradition.star_register.seraili',
    ])
    expect(figures.map((e) => e.prose_label)).toEqual([
      'Serakar — the Crown Star',
      'Vanasera — the Landfall Star',
      'Murasera — the Storm-Star',
      'Measera — the Dawn-Star',
      'Serama — the Star-River',
      'Seraili — the Remembered Stars',
    ])
  })

  it('carries exactly one abstract cartouche device (the Serakar oath)', () => {
    expect(cartouches).toHaveLength(1)
    const c = cartouches[0]
    expect(c.id).toBe('religion.tradition.star_register.serakar_oath')
    expect(c.kind).toBe('cartouche')
    expect(c.prose_label).toBe('By the star that watches')
    expect(c.illustration_ref).toBeNull()
  })
})
