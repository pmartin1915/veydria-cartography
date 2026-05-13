import { describe, it, expect, beforeEach } from 'vitest'
import {
  getStarredIds,
  isStarred,
  toggleStarred,
  removeStarred,
  clearStarred,
  resolveStarredFeatures,
} from './feature-stars'

const STORAGE_KEY = 'veydria.stars.v1'

function mockFeature(id: string, name: string) {
  return {
    type: 'Feature' as const,
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { id, name },
  }
}

// Minimal in-memory localStorage for the node test environment.
function installLocalStorageStub() {
  const store = new Map<string, string>()
  const stub = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() { return store.size },
  }
  ;(globalThis as unknown as { localStorage: typeof stub }).localStorage = stub
  return stub
}
installLocalStorageStub()

beforeEach(() => {
  localStorage.clear()
})

describe('getStarredIds', () => {
  it('returns empty array when nothing stored', () => {
    expect(getStarredIds()).toEqual([])
  })

  it('returns parsed array from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 'b', 'c']))
    expect(getStarredIds()).toEqual(['a', 'b', 'c'])
  })

  it('returns empty array for invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')
    expect(getStarredIds()).toEqual([])
  })

  it('returns empty array for non-array parsed value', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }))
    expect(getStarredIds()).toEqual([])
  })

  it('returns empty array when array contains non-strings', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 1, 'b']))
    expect(getStarredIds()).toEqual([])
  })
})

describe('isStarred', () => {
  it('returns false when feature is not starred', () => {
    expect(isStarred('missing')).toBe(false)
  })

  it('returns true when feature is starred', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['foo', 'bar']))
    expect(isStarred('bar')).toBe(true)
  })
})

describe('toggleStarred', () => {
  it('adds a new feature and returns true', () => {
    expect(toggleStarred('a')).toBe(true)
    expect(getStarredIds()).toEqual(['a'])
  })

  it('removes an existing feature and returns false', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 'b']))
    expect(toggleStarred('a')).toBe(false)
    expect(getStarredIds()).toEqual(['b'])
  })

  it('adds to the front of the list (most recent first)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['b', 'c']))
    toggleStarred('a')
    expect(getStarredIds()).toEqual(['a', 'b', 'c'])
  })

  it('caps the list at 50 items', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `id-${i}`)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
    toggleStarred('new-id')
    const result = getStarredIds()
    expect(result.length).toBe(50)
    expect(result[0]).toBe('new-id')
    expect(result).not.toContain('id-49')
  })
})

describe('removeStarred', () => {
  it('removes a starred feature', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 'b', 'c']))
    removeStarred('b')
    expect(getStarredIds()).toEqual(['a', 'c'])
  })

  it('is a no-op when feature is not starred', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 'b']))
    removeStarred('missing')
    expect(getStarredIds()).toEqual(['a', 'b'])
  })
})

describe('clearStarred', () => {
  it('removes all starred features', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['a', 'b']))
    clearStarred()
    expect(getStarredIds()).toEqual([])
  })
})

describe('resolveStarredFeatures', () => {
  it('returns starred features in order', () => {
    const features = [mockFeature('a', 'Alpha'), mockFeature('b', 'Beta'), mockFeature('c', 'Gamma')]
    const result = resolveStarredFeatures(['b', 'a'], features)
    expect(result.map((r) => r.id)).toEqual(['b', 'a'])
    expect(result.map((r) => r.feature.properties.name)).toEqual(['Beta', 'Alpha'])
  })

  it('skips missing features', () => {
    const features = [mockFeature('a', 'Alpha')]
    const result = resolveStarredFeatures(['a', 'missing'], features)
    expect(result.map((r) => r.id)).toEqual(['a'])
  })

  it('returns empty array for empty ids', () => {
    expect(resolveStarredFeatures([], [mockFeature('a', 'Alpha')])).toEqual([])
  })

  it('matches on top-level id when properties.id is absent', () => {
    const feature = { type: 'Feature' as const, id: 'top-id', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Top' } }
    const result = resolveStarredFeatures(['top-id'], [feature])
    expect(result.map((r) => r.id)).toEqual(['top-id'])
  })
})
