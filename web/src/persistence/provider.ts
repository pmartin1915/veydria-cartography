/**
 * provider.ts — Swappable async storage backend.
 *
 * A `StorageProvider` is the persistence boundary the app can swap without
 * touching feature code: `LocalStorageProvider` for the web/GitHub-Pages build,
 * `TauriFsProvider` (added with the desktop shell) for on-disk files. It deals in
 * OPAQUE strings only — several stores persist raw strings rather than JSON
 * (`veydria.timeOfDay.v1`, `veydria.hexSize`, `veydria.sessionActive.v1`), so the
 * provider must never parse or assume structure.
 *
 * All methods are async so a file-backed provider drops in unchanged. The
 * synchronous render-time call sites that the feature utils depend on are served
 * by the `kvStore` cache layer (see kv-store.ts), not by this interface directly.
 */

/** Keys the persistence layer owns. Everything under this prefix round-trips. */
export const VEYDRIA_KEY_PREFIX = 'veydria'

export function isVeydriaKey(key: string): boolean {
  return key.startsWith(VEYDRIA_KEY_PREFIX)
}

export interface StorageProvider {
  /** Read a value, or null if absent. */
  get(key: string): Promise<string | null>
  /** Write a value (overwrites). */
  set(key: string, value: string): Promise<void>
  /** Delete a key (no-op if absent). */
  remove(key: string): Promise<void>
  /** All keys currently held under the veydria namespace. */
  list(): Promise<string[]>
  /** Remove every veydria-namespaced key. */
  clear(): Promise<void>
  /**
   * Drain any pending/buffered writes to durable storage. Optional: providers
   * that persist synchronously (localStorage) need not implement it. A disk-backed
   * provider that debounces writes MUST, so the shell can await it on quit.
   * Rejects if a buffered write could not be persisted.
   */
  flush?(): Promise<void>
}
