import { describe, it, expect, beforeEach } from 'vitest'
import { StorageProvider } from './provider'
import {
  kvStore,
  LocalStorageBackend,
  CachedAsyncBackend,
} from './kv-store'
import {
  getStarredIds,
  toggleStarred,
  isStarred,
  clearStarred,
} from '../utils/feature-stars'

const STARS_KEY = 'veydria.stars.v1'

/** Minimal synchronous localStorage stub for the node test env. */
function installLocalStorageStub() {
  const store = new Map<string, string>()
  const stub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
  ;(globalThis as unknown as { localStorage: typeof stub }).localStorage = stub
  return stub
}
installLocalStorageStub()

/** In-memory async StorageProvider — the stand-in for a Tauri fs provider. */
class MemoryProvider implements StorageProvider {
  store = new Map<string, string>()
  async get(key: string) {
    return this.store.get(key) ?? null
  }
  async set(key: string, value: string) {
    this.store.set(key, value)
  }
  async remove(key: string) {
    this.store.delete(key)
  }
  async list() {
    return [...this.store.keys()].filter((k) => k.startsWith('veydria'))
  }
  async clear() {
    for (const k of await this.list()) this.store.delete(k)
  }
}

describe('LocalStorageBackend', () => {
  beforeEach(() => {
    localStorage.clear()
    kvStore.setBackend(new LocalStorageBackend())
  })

  it('round-trips strings through localStorage', () => {
    kvStore.setString('veydria.x', 'hello')
    expect(kvStore.getString('veydria.x')).toBe('hello')
  })

  it('lists only veydria-namespaced keys', () => {
    localStorage.setItem('veydria.a', '1')
    localStorage.setItem('other', '2')
    expect(kvStore.keys().sort()).toEqual(['veydria.a'])
  })

  it('removes keys', () => {
    kvStore.setString('veydria.x', '1')
    kvStore.remove('veydria.x')
    expect(kvStore.getString('veydria.x')).toBeNull()
  })

  it('stores opaque raw (non-JSON) strings unchanged', () => {
    kvStore.setString('veydria.timeOfDay.v1', 'dusk')
    expect(kvStore.getString('veydria.timeOfDay.v1')).toBe('dusk')
  })
})

describe('CachedAsyncBackend (Tauri-style provider)', () => {
  it('hydrates from the provider then serves sync reads', async () => {
    const provider = new MemoryProvider()
    await provider.set('veydria.x', 'persisted')
    const backend = new CachedAsyncBackend(provider)
    await backend.hydrate()
    expect(backend.getString('veydria.x')).toBe('persisted')
  })

  it('write-through persists to the async provider', async () => {
    const provider = new MemoryProvider()
    const backend = new CachedAsyncBackend(provider)
    await backend.hydrate()
    backend.setString('veydria.y', 'new')
    expect(backend.getString('veydria.y')).toBe('new') // cache is immediate
    await Promise.resolve() // let fire-and-forget settle
    expect(await provider.get('veydria.y')).toBe('new')
  })
})

// Keystone: the SAME feature util must behave identically whether kvStore sits
// over localStorage or over a hydrated async (Tauri-style) provider — with zero
// changes to feature-stars.ts. This is what de-risks the bulk refactor.
describe('feature-stars over CachedAsyncBackend (provider swap)', () => {
  let provider: MemoryProvider

  beforeEach(async () => {
    provider = new MemoryProvider()
    await provider.set(STARS_KEY, JSON.stringify(['seed-a', 'seed-b']))
    const backend = new CachedAsyncBackend(provider)
    await backend.hydrate()
    kvStore.setBackend(backend)
  })

  it('reads starred ids hydrated from the provider', () => {
    expect(getStarredIds()).toEqual(['seed-a', 'seed-b'])
    expect(isStarred('seed-b')).toBe(true)
  })

  it('toggling persists back to the async provider', async () => {
    expect(toggleStarred('seed-c')).toBe(true)
    expect(getStarredIds()).toEqual(['seed-c', 'seed-a', 'seed-b'])
    await Promise.resolve()
    expect(JSON.parse((await provider.get(STARS_KEY))!)).toEqual([
      'seed-c',
      'seed-a',
      'seed-b',
    ])
  })

  it('clearing removes the key from the provider', async () => {
    clearStarred()
    expect(getStarredIds()).toEqual([])
    await Promise.resolve()
    expect(await provider.get(STARS_KEY)).toBeNull()
  })
})

/** Provider that records flush() calls, for the close-handler drain path. */
class FlushSpyProvider implements StorageProvider {
  store = new Map<string, string>()
  flushed = 0
  async get(key: string) {
    return this.store.get(key) ?? null
  }
  async set(key: string, value: string) {
    this.store.set(key, value)
  }
  async remove(key: string) {
    this.store.delete(key)
  }
  async list() {
    return [...this.store.keys()].filter((k) => k.startsWith('veydria'))
  }
  async clear() {
    this.store.clear()
  }
  async flush() {
    this.flushed++
  }
}

describe('flush() delegation', () => {
  it('LocalStorageBackend.flush resolves (synchronous storage, nothing to drain)', async () => {
    kvStore.setBackend(new LocalStorageBackend())
    await expect(kvStore.flush()).resolves.toBeUndefined()
  })

  it('CachedAsyncBackend.flush drains the underlying provider', async () => {
    const provider = new FlushSpyProvider()
    const backend = new CachedAsyncBackend(provider)
    await backend.hydrate()
    kvStore.setBackend(backend)
    await kvStore.flush()
    expect(provider.flushed).toBe(1)
  })

  it('CachedAsyncBackend.flush is a no-op when the provider has no flush()', async () => {
    const backend = new CachedAsyncBackend(new MemoryProvider())
    await backend.hydrate()
    await expect(backend.flush()).resolves.toBeUndefined()
  })
})
