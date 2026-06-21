/**
 * local-storage-provider.ts — `StorageProvider` backed by browser localStorage.
 *
 * The default provider for the web build. localStorage is synchronous, so these
 * async methods resolve immediately; the async signature exists only so a
 * file-backed provider (Tauri) is a drop-in replacement.
 *
 * Reads `globalThis.localStorage` dynamically on each call (never captured at
 * construction) so test harnesses that swap in a stub after module load — see
 * feature-stars.test.ts — still hit the stub.
 */

import { StorageProvider, isVeydriaKey } from './provider'

function ls(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    // Accessing localStorage can throw in some sandboxed/private contexts.
    return null
  }
}

export class LocalStorageProvider implements StorageProvider {
  async get(key: string): Promise<string | null> {
    return ls()?.getItem(key) ?? null
  }

  async set(key: string, value: string): Promise<void> {
    try {
      ls()?.setItem(key, value)
    } catch {
      // Quota exceeded / private mode — match existing fire-and-forget behavior.
    }
  }

  async remove(key: string): Promise<void> {
    try {
      ls()?.removeItem(key)
    } catch {
      // ignore
    }
  }

  async list(): Promise<string[]> {
    const store = ls()
    if (!store) return []
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k && isVeydriaKey(k)) keys.push(k)
    }
    return keys
  }

  async clear(): Promise<void> {
    const store = ls()
    if (!store) return
    for (const k of await this.list()) {
      store.removeItem(k)
    }
  }
}
