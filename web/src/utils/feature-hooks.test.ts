import { describe, it, expect, beforeEach } from 'vitest'
import {
  generateFeatureHooks,
  loadFeatureHooks,
  saveFeatureHooks,
  getStoredHooks,
  storeHooks,
  clearAllFeatureHooks,
  type FeatureHook,
} from './feature-hooks'

const STORAGE_KEY = 'veydria.hooks.v1'

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

describe('generateFeatureHooks', () => {
  it('returns 3 hooks by default', () => {
    const hooks = generateFeatureHooks('lam-chen-pass', 'Lam Chen Pass', 'chokepoint')
    expect(hooks).toHaveLength(3)
    hooks.forEach((h) => {
      expect(h.text).toContain('Lam Chen Pass')
      expect(h.tags.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('is deterministic for the same feature', () => {
    const a = generateFeatureHooks('ki-mbuhari', 'Ki-Mbuhari', 'port')
    const b = generateFeatureHooks('ki-mbuhari', 'Ki-Mbuhari', 'port')
    expect(a).toEqual(b)
  })

  it('uses a different pool per category', () => {
    const port = generateFeatureHooks('x', 'X', 'port')
    const choke = generateFeatureHooks('x', 'X', 'chokepoint')
    expect(port[0].text).not.toBe(choke[0].text)
  })

  it('falls back to landmark pool for unknown categories', () => {
    const hooks = generateFeatureHooks('x', 'X', 'unknown_category')
    expect(hooks.length).toBeGreaterThan(0)
  })

  it('caps count between 1 and 5', () => {
    expect(generateFeatureHooks('x', 'X', 'port', { count: 0 })).toHaveLength(1)
    expect(generateFeatureHooks('x', 'X', 'port', { count: 99 })).toHaveLength(5)
  })

  it('accepts custom rng', () => {
    const rng = () => 0.5
    const hooks = generateFeatureHooks('x', 'X', 'port', { count: 2, rng })
    expect(hooks).toHaveLength(2)
  })

  it('substitutes {name} in every hook', () => {
    const hooks = generateFeatureHooks('aethelian-basin', 'Aethelian Basin', 'water')
    hooks.forEach((h) => {
      expect(h.text).not.toContain('{name}')
      expect(h.text).toContain('Aethelian Basin')
    })
  })

  it('includes category tag on every hook', () => {
    const hooks = generateFeatureHooks('lam-chen', 'Lam Chen', 'chokepoint')
    hooks.forEach((h) => {
      expect(h.tags).toContain('chokepoint')
    })
  })

  it('derives additional tags when keywords match', () => {
    // Use a custom rng to force predictable picks from the trade_route pool
    let call = 0
    const rng = () => [0.1, 0.3, 0.5][call++ % 3]
    const hooks = generateFeatureHooks('copper-road', 'Copper Road', 'trade_route', { count: 3, rng })
    // At least one should have trade or conflict tag since trade_route templates are rich
    const hasRelevantTag = hooks.some((h) =>
      h.tags.some((t) => t !== 'trade-route')
    )
    expect(hasRelevantTag).toBe(true)
  })

  it('does not repeat hooks when pool is large enough', () => {
    const hooks = generateFeatureHooks('x', 'X', 'civilization', { count: 3 })
    const texts = hooks.map((h) => h.text)
    expect(new Set(texts).size).toBe(texts.length)
  })
})

describe('persistence', () => {
  beforeEach(() => {
    clearAllFeatureHooks()
  })

  it('round-trips through localStorage', () => {
    const hooks: FeatureHook[] = [
      { text: 'Test hook one', tags: ['trade'] },
      { text: 'Test hook two', tags: ['conflict'] },
    ]
    storeHooks('feature-a', hooks)
    const loaded = getStoredHooks('feature-a')
    expect(loaded).toEqual(hooks)
  })

  it('returns null for missing feature', () => {
    expect(getStoredHooks('nonexistent')).toBeNull()
  })

  it('returns empty object when storage is empty', () => {
    expect(loadFeatureHooks()).toEqual({})
  })

  it('ignores corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')
    expect(loadFeatureHooks()).toEqual({})
  })

  it('filters entries with invalid shape', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      good: [{ text: 'ok', tags: ['a'] }],
      bad1: 'string',
      bad2: [{ text: 123, tags: [] }],
      bad3: [{ text: 'ok', tags: 'not-array' }],
    }))
    const all = loadFeatureHooks()
    expect(Object.keys(all)).toEqual(['good'])
  })

  it('stores multiple features independently', () => {
    storeHooks('f1', [{ text: 'One', tags: [] }])
    storeHooks('f2', [{ text: 'Two', tags: [] }])
    const all = loadFeatureHooks()
    expect(all['f1']).toEqual([{ text: 'One', tags: [] }])
    expect(all['f2']).toEqual([{ text: 'Two', tags: [] }])
  })

  it('update overwrites existing hooks for a feature', () => {
    storeHooks('f1', [{ text: 'Old', tags: [] }])
    storeHooks('f1', [{ text: 'New', tags: ['updated'] }])
    expect(getStoredHooks('f1')).toEqual([{ text: 'New', tags: ['updated'] }])
  })

  it('clearAllFeatureHooks removes everything', () => {
    storeHooks('f1', [{ text: 'One', tags: [] }])
    clearAllFeatureHooks()
    expect(getStoredHooks('f1')).toBeNull()
    expect(loadFeatureHooks()).toEqual({})
  })
})
