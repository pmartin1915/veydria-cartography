import { describe, expect, it, beforeEach } from 'vitest'
import {
  loadHistory,
  saveHistory,
  addHistoryEntry,
  deleteHistoryEntry,
  clearHistory,
  type HistoryEntry,
} from './journey-history'

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

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 'entry-1',
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
    ...overrides,
  }
}

describe('journey-history', () => {
  describe('loadHistory', () => {
    it('returns empty array when storage is empty', () => {
      expect(loadHistory()).toEqual([])
    })

    it('returns empty array when storage holds invalid JSON', () => {
      localStorage.setItem('veydria-journey-history', '{not json')
      expect(loadHistory()).toEqual([])
    })

    it('returns empty array when storage holds a non-array', () => {
      localStorage.setItem('veydria-journey-history', JSON.stringify({ id: 'x' }))
      expect(loadHistory()).toEqual([])
    })

    it('returns parsed entries when storage is valid', () => {
      const entries = [makeEntry(), makeEntry({ id: 'entry-2', fromName: 'C' })]
      localStorage.setItem('veydria-journey-history', JSON.stringify(entries))
      expect(loadHistory()).toEqual(entries)
    })
  })

  describe('saveHistory', () => {
    it('writes entries to localStorage', () => {
      const entries = [makeEntry()]
      saveHistory(entries)
      expect(localStorage.getItem('veydria-journey-history')).not.toBeNull()
    })

    it('silently truncates to MAX_ENTRIES (20)', () => {
      const entries = Array.from({ length: 25 }, (_, i) => makeEntry({ id: `e${i}` }))
      saveHistory(entries)
      const raw = localStorage.getItem('veydria-journey-history')
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw!) as HistoryEntry[]
      expect(parsed).toHaveLength(20)
      expect(parsed[0].id).toBe('e0')
      expect(parsed[19].id).toBe('e19')
    })

    it('silently fails when setItem throws (e.g. storage full)', () => {
      const stub = installLocalStorageStub()
      stub.setItem = () => { throw new Error('QuotaExceeded') }
      // Should not throw.
      expect(() => saveHistory([makeEntry()])).not.toThrow()
    })
  })

  describe('addHistoryEntry', () => {
    it('prepends a new entry to an empty history', () => {
      const entry = makeEntry()
      const result = addHistoryEntry(entry)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('entry-1')
    })

    it('prepends a new entry to existing history', () => {
      addHistoryEntry(makeEntry({ id: 'first', savedAt: 1, nodeIds: ['a', 'b'] }))
      const result = addHistoryEntry(makeEntry({ id: 'second', savedAt: 2, nodeIds: ['c', 'd'] }))
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('second')
      expect(result[1].id).toBe('first')
    })

    it('detects duplicate by nodeIds + season + mode and moves it to front', () => {
      addHistoryEntry(makeEntry({ id: 'orig', savedAt: 1, fromName: 'Old' }))
      const dup = makeEntry({ id: 'new', savedAt: 2, fromName: 'New' })
      const result = addHistoryEntry(dup)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('orig')
      expect(result[0].savedAt).toBe(2)
    })

    it('does not treat same nodeIds with different season as duplicate', () => {
      addHistoryEntry(makeEntry({ id: 'a', savedAt: 1, season: 'spring' }))
      const result = addHistoryEntry(makeEntry({ id: 'b', savedAt: 2, season: 'winter' }))
      expect(result).toHaveLength(2)
    })

    it('does not treat same nodeIds with different mode as duplicate', () => {
      addHistoryEntry(makeEntry({ id: 'a', savedAt: 1, mode: 'fastest' }))
      const result = addHistoryEntry(makeEntry({ id: 'b', savedAt: 2, mode: 'safest' }))
      expect(result).toHaveLength(2)
    })

    it('truncates to MAX_ENTRIES when adding many unique entries', () => {
      for (let i = 0; i < 25; i++) {
        addHistoryEntry(makeEntry({ id: `e${i}`, nodeIds: [`n${i}`, `n${i + 1}`] }))
      }
      const result = loadHistory()
      expect(result).toHaveLength(20)
    })
  })

  describe('deleteHistoryEntry', () => {
    it('removes an entry by id', () => {
      addHistoryEntry(makeEntry({ id: 'a', nodeIds: ['a', 'b'] }))
      addHistoryEntry(makeEntry({ id: 'b', nodeIds: ['c', 'd'] }))
      const result = deleteHistoryEntry('a')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('b')
    })

    it('returns unchanged list when id is not found', () => {
      addHistoryEntry(makeEntry({ id: 'a' }))
      const result = deleteHistoryEntry('z')
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('a')
    })
  })

  describe('clearHistory', () => {
    it('removes all entries and returns empty array', () => {
      addHistoryEntry(makeEntry({ id: 'a' }))
      const result = clearHistory()
      expect(result).toEqual([])
      expect(loadHistory()).toEqual([])
    })
  })
})
