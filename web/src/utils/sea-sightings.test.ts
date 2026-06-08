import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { SIGHTING_FAUNA, resolveSighting } from './sea-sightings'
import { FAUNA_SHAPES } from './fauna-shapes'

const __dirname = dirname(fileURLToPath(import.meta.url))
const read = (p: string) => JSON.parse(readFileSync(resolve(__dirname, p), 'utf-8'))

const encounters = read('../../public/encounters.json') as { encounters: { key?: string }[] }
const asterisms = read('../../public/asterisms.json') as { asterisms: { id: string; prose_label: string }[] }

// Cross-file canon-drift guard: the sighting map ties three independently-synced
// files together (encounters.json keys, fauna-shapes silhouettes, asterisms names).
// If any drifts out from under the map, one of these fails.
describe('sea-sightings — canon guard', () => {
  it('has exactly the 5 iconic megafauna sightings', () => {
    expect(Object.keys(SIGHTING_FAUNA)).toHaveLength(5)
  })

  it('every key is a real encounter in encounters.json', () => {
    const keys = new Set(encounters.encounters.map((e) => e.key))
    for (const k of Object.keys(SIGHTING_FAUNA)) expect(keys.has(k)).toBe(true)
  })

  it('every faunaId has a hand-authored silhouette in fauna-shapes', () => {
    for (const s of Object.values(SIGHTING_FAUNA)) expect(s.faunaId in FAUNA_SHAPES).toBe(true)
  })

  it('every display name matches the asterism prose_label verbatim', () => {
    const labelById = new Map(asterisms.asterisms.map((a) => [a.id, a.prose_label]))
    for (const s of Object.values(SIGHTING_FAUNA)) expect(s.name).toBe(labelById.get(s.faunaId))
  })

  it('every display name is em-dash-free (VOICE-SPEC Option B)', () => {
    for (const s of Object.values(SIGHTING_FAUNA)) expect(s.name).not.toContain('—')
  })
})

describe('resolveSighting', () => {
  it('resolves a megafauna sighting key', () => {
    expect(resolveSighting({ key: 'oravan.sperm_whale_deep_strait' })?.faunaId).toBe('ecology.fauna.oravan.sperm_whale')
  })

  it('returns null for a keyless beat or a non-sighting key', () => {
    expect(resolveSighting({})).toBeNull()
    expect(resolveSighting({ key: 'oravan.outrigger_village_wakeup' })).toBeNull()
  })
})
