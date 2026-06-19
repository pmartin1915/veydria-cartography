/**
 * kv-store.ts — Synchronous facade over a swappable storage backend.
 *
 * Feature utils (annotations, journeys, stars, …) read and write persisted state
 * *synchronously during render* (e.g. `isStarred()`, `loadTimeOfDay()` inside a
 * `useState` initializer). An async `StorageProvider` cannot serve those call
 * sites directly without rewriting every consumer into effects/state. `kvStore`
 * resolves this: a synchronous in-memory view that feature code talks to, sitting
 * over one of two backends —
 *
 *   • LocalStorageBackend  — direct synchronous passthrough to localStorage.
 *                            The DEFAULT, so the web build and unit tests work
 *                            with zero setup (no hydrate step needed).
 *   • CachedAsyncBackend   — a Map cache hydrated once at boot from an async
 *                            `StorageProvider` (Tauri disk files); reads hit the
 *                            cache, writes update the cache then persist
 *                            fire-and-forget.
 *
 * Swapping the backend is how the localStorage→disk move happens WITHOUT touching
 * any feature util. Values are opaque strings — JSON parsing stays in each util.
 */

import { StorageProvider, isVeydriaKey } from './provider'

export interface SyncBackend {
  getString(key: string): string | null
  setString(key: string, value: string): void
  remove(key: string): void
  keys(): string[]
}

/** Default backend: synchronous, zero-setup, backed by localStorage. */
export class LocalStorageBackend implements SyncBackend {
  private ls(): Storage | null {
    try {
      return globalThis.localStorage ?? null
    } catch {
      return null
    }
  }

  getString(key: string): string | null {
    return this.ls()?.getItem(key) ?? null
  }

  setString(key: string, value: string): void {
    try {
      this.ls()?.setItem(key, value)
    } catch {
      // Quota exceeded / private mode — degrade silently, as the utils always have.
    }
  }

  remove(key: string): void {
    try {
      this.ls()?.removeItem(key)
    } catch {
      // ignore
    }
  }

  keys(): string[] {
    const store = this.ls()
    if (!store) return []
    const out: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k && isVeydriaKey(k)) out.push(k)
    }
    return out
  }
}

/**
 * Cache backend for async providers (Tauri fs). Must be `hydrate()`d once before
 * any synchronous read; the desktop shell does this at boot before `createRoot`.
 * Writes are applied to the cache immediately and persisted fire-and-forget so the
 * sync API stays sync.
 */
export class CachedAsyncBackend implements SyncBackend {
  private cache = new Map<string, string>()

  constructor(private provider: StorageProvider) {}

  async hydrate(): Promise<void> {
    const keys = await this.provider.list()
    const entries = await Promise.all(
      keys.map(async (k) => [k, await this.provider.get(k)] as const),
    )
    this.cache.clear()
    for (const [k, v] of entries) {
      if (v !== null) this.cache.set(k, v)
    }
  }

  getString(key: string): string | null {
    return this.cache.has(key) ? this.cache.get(key)! : null
  }

  setString(key: string, value: string): void {
    this.cache.set(key, value)
    void this.provider.set(key, value)
  }

  remove(key: string): void {
    this.cache.delete(key)
    void this.provider.remove(key)
  }

  keys(): string[] {
    return [...this.cache.keys()].filter(isVeydriaKey)
  }
}

/** Singleton facade the feature utils import. */
class KvStore {
  private backend: SyncBackend = new LocalStorageBackend()

  /** Replace the active backend (e.g. install a hydrated Tauri-backed cache). */
  setBackend(backend: SyncBackend): void {
    this.backend = backend
  }

  /**
   * Convenience for the desktop boot path: build a cache backend over `provider`,
   * hydrate it from disk, and install it. Call once, awaited, before rendering.
   */
  async hydrate(provider: StorageProvider): Promise<void> {
    const backend = new CachedAsyncBackend(provider)
    await backend.hydrate()
    this.backend = backend
  }

  getString(key: string): string | null {
    return this.backend.getString(key)
  }

  setString(key: string, value: string): void {
    this.backend.setString(key, value)
  }

  remove(key: string): void {
    this.backend.remove(key)
  }

  keys(): string[] {
    return this.backend.keys()
  }
}

export const kvStore = new KvStore()
