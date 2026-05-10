import { describe, it, expect, beforeEach } from 'vitest'
import { loadRecentItems, pushRecentItem, clearRecentItems, type RecentItem } from './search-recent'

const STORAGE_KEY = 'veydria.search.recent.v1'

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

function setStored(items: RecentItem[] | string | unknown) {
  if (typeof items === 'string') {
    localStorage.setItem(STORAGE_KEY, items)
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }
}

function getStored(): unknown {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

describe('search-recent', () => {
  beforeEach(() => {
    installLocalStorageStub()
  })

  it('returns empty array when nothing stored', () => {
    expect(loadRecentItems()).toEqual([])
  })

  it('round-trips an item', () => {
    pushRecentItem('f1', 'Oravan', 'port')
    const items = loadRecentItems()
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('f1')
    expect(items[0].name).toBe('Oravan')
    expect(items[0].category).toBe('port')
    expect(typeof items[0].timestamp).toBe('number')
  })

  it('moves duplicate to front and dedupes', () => {
    pushRecentItem('f1', 'Oravan', 'port')
    pushRecentItem('f2', 'Keth', 'port')
    pushRecentItem('f1', 'Oravan', 'port')
    const items = loadRecentItems()
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe('f1')
    expect(items[1].id).toBe('f2')
  })

  it('evicts oldest beyond max of 5', () => {
    for (let i = 1; i <= 6; i++) {
      pushRecentItem(`f${i}`, `Name ${i}`, 'landmark')
    }
    const items = loadRecentItems()
    expect(items).toHaveLength(5)
    expect(items.map((i) => i.id)).toEqual(['f6', 'f5', 'f4', 'f3', 'f2'])
  })

  it('ignores corrupt JSON', () => {
    setStored('not-json')
    expect(loadRecentItems()).toEqual([])
  })

  it('ignores non-array payload', () => {
    setStored({ foo: 'bar' })
    expect(loadRecentItems()).toEqual([])
  })

  it('filters out invalid items in an array', () => {
    setStored([
      { id: 'f1', name: 'Good', category: 'port', timestamp: 1 },
      { id: '', name: 'Bad id', category: 'port', timestamp: 2 },
      { id: 'f3', name: '', category: 'port', timestamp: 3 },
      { id: 'f4', name: 'Bad ts', category: 'port', timestamp: 'nope' },
      null,
      'string',
    ])
    const items = loadRecentItems()
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('f1')
  })

  it('clear removes the key', () => {
    pushRecentItem('f1', 'Oravan', 'port')
    clearRecentItems()
    expect(loadRecentItems()).toEqual([])
    expect(getStored()).toBeNull()
  })

  it('preserves order across multiple pushes', () => {
    pushRecentItem('a', 'A', 'civ')
    pushRecentItem('b', 'B', 'civ')
    pushRecentItem('c', 'C', 'civ')
    pushRecentItem('b', 'B', 'civ') // move b to front
    pushRecentItem('d', 'D', 'civ')
    const items = loadRecentItems()
    expect(items.map((i) => i.id)).toEqual(['d', 'b', 'c', 'a'])
  })
})
