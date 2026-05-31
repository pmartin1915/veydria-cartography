import { describe, expect, it, beforeEach } from 'vitest'
import {
  loadSavedJourneys,
  saveJourneys,
  addSavedJourney,
  deleteSavedJourney,
  renameSavedJourney,
  clearSavedJourneys,
  clearSavedJourneysForParty,
  listPartyNames,
  journeysForParty,
  sanitizePartyName,
  DEFAULT_PARTY_NAME,
  type SavedJourney,
} from './journey-saved'
import { DEFAULT_PARTY } from './journey-graph'
import { DEFAULT_SUPPLY } from './journey-supply'

// Minimal in-memory localStorage for the node test environment.
function installLocalStorageStub() {
  const store = new Map<string, string>()
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  }
  ;(globalThis as unknown as { localStorage: typeof stub }).localStorage = stub
  return stub
}

beforeEach(() => {
  installLocalStorageStub()
})

function makeJourney(overrides: Partial<SavedJourney> = {}): SavedJourney {
  return {
    id: 'j-1',
    savedAt: 1000,
    fromName: 'A',
    toName: 'B',
    waypoints: [],
    season: 'spring',
    mode: 'fastest',
    totalKm: 100,
    estimatedDays: 4,
    nodeIds: ['a', 'b'],
    edgeCount: 1,
    bottlenecks: [],
    seasonalWarnings: [],
    party: DEFAULT_PARTY,
    supply: DEFAULT_SUPPLY,
    partyName: DEFAULT_PARTY_NAME,
    ...overrides,
  }
}

describe('journey-saved', () => {
  describe('loadSavedJourneys', () => {
    it('returns empty array when storage is empty', () => {
      expect(loadSavedJourneys()).toEqual([])
    })

    it('returns empty array when storage holds invalid JSON', () => {
      localStorage.setItem('veydria.journeys.v1', '{not json')
      expect(loadSavedJourneys()).toEqual([])
    })

    it('returns empty array when storage holds a non-array', () => {
      localStorage.setItem('veydria.journeys.v1', JSON.stringify({ id: 'x' }))
      expect(loadSavedJourneys()).toEqual([])
    })

    it('returns parsed journeys when storage is valid', () => {
      const journeys = [makeJourney(), makeJourney({ id: 'j-2', fromName: 'C' })]
      localStorage.setItem('veydria.journeys.v1', JSON.stringify(journeys))
      expect(loadSavedJourneys()).toEqual(journeys)
    })

    it('migrates from legacy veydria-journey-history when v1 is absent', () => {
      const legacy = [
        {
          id: 'legacy-1',
          savedAt: 500,
          fromName: 'Old A',
          toName: 'Old B',
          waypoints: ['Mid'],
          season: 'winter',
          mode: 'safest',
          totalKm: 200,
          estimatedDays: 5,
          nodeIds: ['oa', 'om', 'ob'],
          edgeCount: 2,
          bottlenecks: ['Flooded pass'],
          seasonalWarnings: [],
        },
      ]
      localStorage.setItem('veydria-journey-history', JSON.stringify(legacy))
      const result = loadSavedJourneys()
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('legacy-1')
      expect(result[0].name).toBe('Old A → Mid → Old B')
      // v1 key should now be populated
      expect(localStorage.getItem('veydria.journeys.v1')).not.toBeNull()
    })

    it('prefers v1 over legacy when both exist', () => {
      const v1 = [makeJourney({ id: 'v1-only' })]
      const legacy = [makeJourney({ id: 'legacy-only' })]
      localStorage.setItem('veydria.journeys.v1', JSON.stringify(v1))
      localStorage.setItem('veydria-journey-history', JSON.stringify(legacy))
      const result = loadSavedJourneys()
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('v1-only')
    })

    it('migrates with defensive defaults for corrupt legacy fields', () => {
      const legacy = [
        {
          id: 123,
          savedAt: 'bad',
          nodeIds: ['a', 'b'],
          fromName: null,
          toName: undefined,
          waypoints: [1, 2],
          mode: 'unknown',
          season: 'bogus',
          totalKm: 'lots',
          estimatedDays: null,
          edgeCount: 'two',
          bottlenecks: 'one',
          seasonalWarnings: { x: 1 },
        },
      ]
      localStorage.setItem('veydria-journey-history', JSON.stringify(legacy))
      const result = loadSavedJourneys()
      expect(result).toHaveLength(1)
      expect(result[0].mode).toBe('direct')
      expect(result[0].season).toBeUndefined()
      expect(result[0].totalKm).toBe(0)
      expect(result[0].bottlenecks).toEqual([])
      expect(result[0].seasonalWarnings).toEqual([])
    })
  })

  describe('saveJourneys', () => {
    it('writes journeys to localStorage under v1 key', () => {
      saveJourneys([makeJourney()])
      expect(localStorage.getItem('veydria.journeys.v1')).not.toBeNull()
    })

    it('silently truncates to MAX_ENTRIES (20)', () => {
      const journeys = Array.from({ length: 25 }, (_, i) => makeJourney({ id: `j${i}` }))
      saveJourneys(journeys)
      const raw = localStorage.getItem('veydria.journeys.v1')
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw!) as SavedJourney[]
      expect(parsed).toHaveLength(20)
    })

    it('silently fails when setItem throws', () => {
      const stub = installLocalStorageStub()
      stub.setItem = () => { throw new Error('QuotaExceeded') }
      expect(() => saveJourneys([makeJourney()])).not.toThrow()
    })
  })

  describe('addSavedJourney', () => {
    it('prepends a new journey to an empty list', () => {
      const result = addSavedJourney(makeJourney())
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('j-1')
    })

    it('prepends a new journey to existing list', () => {
      addSavedJourney(makeJourney({ id: 'first', savedAt: 1, nodeIds: ['a', 'b'] }))
      const result = addSavedJourney(makeJourney({ id: 'second', savedAt: 2, nodeIds: ['c', 'd'] }))
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('second')
      expect(result[1].id).toBe('first')
    })

    it('detects duplicate by nodeIds + season + mode and moves it to front', () => {
      addSavedJourney(makeJourney({ id: 'orig', savedAt: 1, fromName: 'Old' }))
      const dup = makeJourney({ id: 'new', savedAt: 2, fromName: 'New' })
      const result = addSavedJourney(dup)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('orig')
      expect(result[0].savedAt).toBe(2)
    })

    it('updates name when duplicate is saved with a new name', () => {
      addSavedJourney(makeJourney({ id: 'orig', savedAt: 1 }))
      const dup = makeJourney({ id: 'new', savedAt: 2, name: 'Campaign Trip' })
      const result = addSavedJourney(dup)
      expect(result[0].name).toBe('Campaign Trip')
    })

    it('does not treat same nodeIds with different season as duplicate', () => {
      addSavedJourney(makeJourney({ id: 'a', savedAt: 1, season: 'spring' }))
      const result = addSavedJourney(makeJourney({ id: 'b', savedAt: 2, season: 'winter' }))
      expect(result).toHaveLength(2)
    })

    it('does not treat same nodeIds with different mode as duplicate', () => {
      addSavedJourney(makeJourney({ id: 'a', savedAt: 1, mode: 'fastest' }))
      const result = addSavedJourney(makeJourney({ id: 'b', savedAt: 2, mode: 'safest' }))
      expect(result).toHaveLength(2)
    })

    it('truncates to MAX_ENTRIES when adding many unique journeys', () => {
      for (let i = 0; i < 25; i++) {
        addSavedJourney(makeJourney({ id: `j${i}`, nodeIds: [`n${i}`, `n${i + 1}`] }))
      }
      const result = loadSavedJourneys()
      expect(result).toHaveLength(20)
    })
  })

  describe('deleteSavedJourney', () => {
    it('removes a journey by id', () => {
      addSavedJourney(makeJourney({ id: 'a', nodeIds: ['a', 'b'] }))
      addSavedJourney(makeJourney({ id: 'b', nodeIds: ['c', 'd'] }))
      const result = deleteSavedJourney('a')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('b')
    })

    it('returns unchanged list when id is not found', () => {
      addSavedJourney(makeJourney({ id: 'a' }))
      const result = deleteSavedJourney('z')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('a')
    })
  })

  describe('renameSavedJourney', () => {
    it('updates the name of a journey', () => {
      addSavedJourney(makeJourney({ id: 'a', name: 'Old' }))
      const result = renameSavedJourney('a', 'New Name')
      expect(result[0].name).toBe('New Name')
    })

    it('trims whitespace', () => {
      addSavedJourney(makeJourney({ id: 'a' }))
      const result = renameSavedJourney('a', '  Trimmed  ')
      expect(result[0].name).toBe('Trimmed')
    })

    it('clears name to undefined when given empty string', () => {
      addSavedJourney(makeJourney({ id: 'a', name: 'Exists' }))
      const result = renameSavedJourney('a', '   ')
      expect(result[0].name).toBeUndefined()
    })
  })

  describe('clearSavedJourneys', () => {
    it('removes all journeys and returns empty array', () => {
      addSavedJourney(makeJourney({ id: 'a' }))
      const result = clearSavedJourneys()
      expect(result).toEqual([])
      expect(loadSavedJourneys()).toEqual([])
    })
  })

  describe('clearSavedJourneysForParty', () => {
    it('removes only the named party, leaving other parties intact', () => {
      addSavedJourney(makeJourney({ id: 'm', partyName: 'Main party', nodeIds: ['a', 'b'] }))
      addSavedJourney(makeJourney({ id: 's', partyName: 'Scouts', nodeIds: ['c', 'd'] }))

      const remaining = clearSavedJourneysForParty('Scouts')

      expect(remaining).toHaveLength(1)
      expect(remaining[0].partyName).toBe('Main party')
      // Persisted, not just returned.
      expect(loadSavedJourneys().map(j => j.partyName)).toEqual(['Main party'])
    })

    it('clears untagged (legacy) entries when targeting the default party', () => {
      const legacy = makeJourney({ id: 'old', nodeIds: ['a', 'b'] })
      delete (legacy as Partial<SavedJourney>).partyName
      addSavedJourney(makeJourney({ id: 's', partyName: 'Scouts', nodeIds: ['c', 'd'] }))
      localStorage.setItem(
        'veydria.journeys.v1',
        JSON.stringify([legacy, ...loadSavedJourneys()]),
      )

      const remaining = clearSavedJourneysForParty(DEFAULT_PARTY_NAME)

      expect(remaining.every(j => sanitizePartyName(j.partyName) !== DEFAULT_PARTY_NAME)).toBe(true)
      expect(remaining.map(j => j.partyName)).toEqual(['Scouts'])
    })
  })

  describe('multi-party (Tier 2c)', () => {
    it('sanitizePartyName trims, caps length, and defaults blanks to "Main party"', () => {
      expect(sanitizePartyName(undefined)).toBe(DEFAULT_PARTY_NAME)
      expect(sanitizePartyName('')).toBe(DEFAULT_PARTY_NAME)
      expect(sanitizePartyName('   ')).toBe(DEFAULT_PARTY_NAME)
      expect(sanitizePartyName(42)).toBe(DEFAULT_PARTY_NAME)
      expect(sanitizePartyName('  Scouts  ')).toBe('Scouts')
      expect(sanitizePartyName('x'.repeat(80))).toHaveLength(60)
    })

    it('backfills partyName to "Main party" for entries written before the field existed', () => {
      const legacy = makeJourney({ id: 'old' })
      delete (legacy as Partial<SavedJourney>).partyName
      localStorage.setItem('veydria.journeys.v1', JSON.stringify([legacy]))
      expect(loadSavedJourneys()[0].partyName).toBe(DEFAULT_PARTY_NAME)
    })

    it('persists an explicit partyName through a save/load round-trip', () => {
      addSavedJourney(makeJourney({ id: 'a', partyName: 'Scouts' }))
      expect(loadSavedJourneys()[0].partyName).toBe('Scouts')
    })

    it('treats the same route under two party names as distinct entries', () => {
      addSavedJourney(makeJourney({ id: 'a', partyName: 'Main party' }))
      const after = addSavedJourney(makeJourney({ id: 'b', partyName: 'Scouts' }))
      expect(after).toHaveLength(2)
    })

    it('still de-dupes the same route under the same party name', () => {
      addSavedJourney(makeJourney({ id: 'a', partyName: 'Scouts' }))
      const after = addSavedJourney(makeJourney({ id: 'b', partyName: 'Scouts' }))
      expect(after).toHaveLength(1)
    })

    it('listPartyNames returns distinct names ordered by most-recent save', () => {
      const journeys = [
        makeJourney({ id: 'a', partyName: 'Scouts', savedAt: 3000, nodeIds: ['a', 'b'] }),
        makeJourney({ id: 'b', partyName: 'Baggage', savedAt: 1000, nodeIds: ['c', 'd'] }),
        makeJourney({ id: 'c', partyName: 'Scouts', savedAt: 2000, nodeIds: ['e', 'f'] }),
      ]
      expect(listPartyNames(journeys)).toEqual(['Scouts', 'Baggage'])
    })

    it('listPartyNames folds untagged entries into "Main party"', () => {
      const j = makeJourney({ id: 'a' })
      delete (j as Partial<SavedJourney>).partyName
      expect(listPartyNames([j])).toEqual([DEFAULT_PARTY_NAME])
    })

    it('journeysForParty filters by name, coalescing the default', () => {
      const tagged = makeJourney({ id: 'a', partyName: 'Scouts', nodeIds: ['a', 'b'] })
      const untagged = makeJourney({ id: 'b', nodeIds: ['c', 'd'] })
      delete (untagged as Partial<SavedJourney>).partyName
      const all = [tagged, untagged]
      expect(journeysForParty(all, 'Scouts').map(j => j.id)).toEqual(['a'])
      expect(journeysForParty(all, DEFAULT_PARTY_NAME).map(j => j.id)).toEqual(['b'])
    })
  })
})
