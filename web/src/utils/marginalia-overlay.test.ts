// @vitest-environment happy-dom
// (the module imports leaflet, which touches `window` at import time; under
// happy-dom import.meta.url is an http URL, so import the canon JSON directly)
import { describe, it, expect } from 'vitest'
import { selectMarginaliaFigures, selectFaunaEngravings } from './marginalia-overlay'
import { parseAsterisms, type Asterism } from './asterisms'
import canonFile from '../../public/asterisms.json'

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

describe('selectMarginaliaFigures', () => {
  it('draws the six register star-figures from the canon extract', () => {
    const drawn = selectMarginaliaFigures(parseAsterisms(canonFile))
    expect(drawn).toHaveLength(6)
    expect(drawn.every((a) => a.kind === 'asterism')).toBe(true)
  })

  it('excludes the abstract cartouche (it is the corner device, not a margin figure)', () => {
    const out = selectMarginaliaFigures([
      row(),
      row({ id: 'religion.tradition.star_register.serakar_oath', kind: 'cartouche' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('asterism')
  })

  it('skips a figure that has no placed layout entry (forward-compat)', () => {
    const out = selectMarginaliaFigures([
      row(),
      row({ id: 'religion.tradition.star_register.unplaced_future_star' }),
    ])
    expect(out.map((a) => a.id)).toEqual(['religion.tradition.star_register.serakar'])
  })

  it('excludes ocean-fauna engravings (they are the layer-B set, not star-figures)', () => {
    const out = selectMarginaliaFigures([
      row(),
      row({ id: 'ecology.fauna.oravan.sea_snake', kind: 'fauna', placement: 'open_water' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('asterism')
  })
})

function faunaRow(over: Partial<Asterism> = {}): Asterism {
  return row({
    id: 'ecology.fauna.oravan.sea_snake',
    civ: 'oravan',
    kind: 'fauna',
    placement: 'open_water',
    prose_label: 'the sea-serpent',
    ...over,
  })
}

describe('selectFaunaEngravings', () => {
  it('draws the seven attested fauna engravings from the canon extract', () => {
    const drawn = selectFaunaEngravings(parseAsterisms(canonFile))
    expect(drawn).toHaveLength(7)
    expect(drawn.every((a) => a.kind === 'fauna')).toBe(true)
    expect(drawn.every((a) => a.placement === 'open_water')).toBe(true)
  })

  it('excludes star-figures and the cartouche', () => {
    const out = selectFaunaEngravings([
      faunaRow(),
      row(), // a star-figure
      row({ id: 'religion.tradition.star_register.serakar_oath', kind: 'cartouche' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('fauna')
  })

  it('skips a fauna row that has no placed silhouette (forward-compat)', () => {
    const out = selectFaunaEngravings([
      faunaRow(),
      faunaRow({ id: 'ecology.fauna.oravan.unplaced_future_beast' }),
    ])
    expect(out.map((a) => a.id)).toEqual(['ecology.fauna.oravan.sea_snake'])
  })
})
