/**
 * tauri-fs-provider.ts — Durable disk-backed `StorageProvider` for the desktop build.
 *
 * The whole `veydria*` keyspace is mirrored as ONE JSON blob (`Record<string,string>`)
 * written to a single file under the app's data dir. A single-blob layout is only
 * safe BECAUSE every write is atomic (temp file + rename): a partial write of a
 * single blob would otherwise lose everything, where per-key files would lose one
 * key. The two decisions are coupled.
 *
 * Durability contract (the reason this is hand-rolled rather than tauri-plugin-store):
 *   • Coalesce + order — a debounce gathers rapid writes; a single in-flight writer
 *     drains them, so the latest value always lands and writes never reorder. With
 *     a single blob this is automatic: the pending `record` IS the next file.
 *   • Atomic — write to `<file>.tmp`, then rename over `<file>`. A crash mid-write
 *     cannot corrupt the live file.
 *   • Surface errors — a failed disk write does NOT silently succeed. The value
 *     stays pending (so the next flush retries it — never clear-then-write) and
 *     `onWriteError` fires so the UI can show a real "last save failed" state
 *     (toasts don't render under WebView2, so the caller must surface it in the DOM).
 *   • Flush on quit — `flush()` cancels the debounce, drains immediately, and only
 *     resolves once the bytes are on disk (rejecting if they could not be), so the
 *     shell's `onCloseRequested` can await it before destroying the window.
 *
 * The actual filesystem calls are injected as `FsOps` so the durability logic is
 * unit-tested against a fake in-memory fs (incl. simulated write failures) instead
 * of through a GUI. The concrete Tauri binding lives in `tauri-fs-ops.ts`.
 */

import { StorageProvider, isVeydriaKey } from './provider'

/** The minimal filesystem surface the provider needs. Injected for testability. */
export interface FsOps {
  /** Read the file's text. Rejects if it does not exist. */
  readText(path: string): Promise<string>
  /** Overwrite `path` with `contents`. */
  writeText(path: string, contents: string): Promise<void>
  /** Rename `from` → `to`, replacing `to` if it exists (atomic on the same volume). */
  rename(from: string, to: string): Promise<void>
}

export interface TauriFsProviderOptions {
  fs: FsOps
  /** Absolute path of the live store file. */
  storePath: string
  /** Absolute path of the temp file written before the atomic rename. */
  tmpPath: string
  /** Called when a disk write fails; the data remains pending for the next flush. */
  onWriteError?: (err: unknown) => void
  /** Called after a drain lands the store cleanly (lets the UI clear a failed state). */
  onWriteSuccess?: () => void
  /** Debounce window (ms) before a buffered write is drained. Default 250. */
  debounceMs?: number
}

export class TauriFsProvider implements StorageProvider {
  private readonly fs: FsOps
  private readonly storePath: string
  private readonly tmpPath: string
  private readonly onWriteError?: (err: unknown) => void
  private readonly onWriteSuccess?: () => void
  private readonly debounceMs: number

  /** Canonical in-memory mirror of the store file (the source for the next write). */
  private readonly record = new Map<string, string>()
  private loaded = false
  /** There are unpersisted changes in `record`. */
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  /** The in-flight drain, if any — guarantees a single writer. */
  private writing: Promise<void> | null = null

  constructor(opts: TauriFsProviderOptions) {
    this.fs = opts.fs
    this.storePath = opts.storePath
    this.tmpPath = opts.tmpPath
    this.onWriteError = opts.onWriteError
    this.onWriteSuccess = opts.onWriteSuccess
    this.debounceMs = opts.debounceMs ?? 250
  }

  /**
   * Load the store file into `record` once. A missing or corrupt file degrades to
   * an empty store (never throws) — a launch must not white-screen on a bad file.
   */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    try {
      const text = await this.fs.readText(this.storePath)
      const obj = JSON.parse(text) as unknown
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (typeof v === 'string') this.record.set(k, v)
        }
      }
    } catch {
      // No store yet, or unreadable/corrupt — start empty. The caller (boot path)
      // surfaces this through the same save-status channel if it matters.
    }
    this.loaded = true
  }

  async get(key: string): Promise<string | null> {
    await this.ensureLoaded()
    return this.record.get(key) ?? null
  }

  async set(key: string, value: string): Promise<void> {
    await this.ensureLoaded()
    this.record.set(key, value)
    this.scheduleWrite()
  }

  async remove(key: string): Promise<void> {
    await this.ensureLoaded()
    this.record.delete(key)
    this.scheduleWrite()
  }

  async list(): Promise<string[]> {
    await this.ensureLoaded()
    return [...this.record.keys()].filter(isVeydriaKey)
  }

  async clear(): Promise<void> {
    await this.ensureLoaded()
    for (const k of [...this.record.keys()]) {
      if (isVeydriaKey(k)) this.record.delete(k)
    }
    this.scheduleWrite()
  }

  /** Mark dirty and arm the debounce timer (idempotent while one is pending). */
  private scheduleWrite(): void {
    this.dirty = true
    if (this.timer != null) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.drain()
    }, this.debounceMs)
  }

  /**
   * Persist the current `record` atomically. Single in-flight writer: concurrent
   * callers await the same drain. Writes that arrive mid-drain are picked up by the
   * loop (coalescing). On failure the data stays `dirty` so the next flush retries.
   */
  private drain(): Promise<void> {
    if (this.writing) return this.writing
    if (!this.dirty) return Promise.resolve()
    this.writing = (async () => {
      try {
        while (this.dirty) {
          this.dirty = false
          const snapshot = JSON.stringify(Object.fromEntries(this.record))
          try {
            await this.fs.writeText(this.tmpPath, snapshot)
            await this.fs.rename(this.tmpPath, this.storePath)
          } catch (err) {
            this.dirty = true // keep pending → retry on next flush; never drop data
            this.onWriteError?.(err)
            return
          }
        }
        this.onWriteSuccess?.()
      } finally {
        this.writing = null
      }
    })()
    return this.writing
  }

  /**
   * Drain immediately and resolve only once the store is on disk. Rejects if a
   * buffered write could not be persisted, so the close handler can surface it.
   */
  async flush(): Promise<void> {
    if (this.timer != null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.drain()
    if (this.dirty) {
      throw new Error('Pending campaign writes could not be persisted to disk.')
    }
  }
}
