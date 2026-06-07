// @vitest-environment happy-dom
// (the module imports leaflet, which touches `window` at import time; under
// happy-dom import.meta.url is an http URL, so import the canon JSON directly)
import { describe, it, expect } from 'vitest'
import { selectMarginaliaFigures } from './marginalia-overlay'
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
})
