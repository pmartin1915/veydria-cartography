import { describe, it, expect, vi } from 'vitest'
import { TauriFsProvider, type FsOps } from './tauri-fs-provider'

const STORE = '/app/veydria-store.json'
const TMP = '/app/veydria-store.json.tmp'

/**
 * In-memory fake filesystem that records calls and can simulate write failures —
 * the whole point of the FsOps seam is to test durability here, not in a GUI.
 */
class FakeFs implements FsOps {
  files = new Map<string, string>()
  failWrites = false
  writeCount = 0
  renameCount = 0
  lastWritePath: string | null = null

  async readText(path: string): Promise<string> {
    const v = this.files.get(path)
    if (v === undefined) throw new Error(`ENOENT: ${path}`)
    return v
  }
  async writeText(path: string, contents: string): Promise<void> {
    if (this.failWrites) throw new Error('disk full')
    this.writeCount++
    this.lastWritePath = path
    this.files.set(path, contents)
  }
  async rename(from: string, to: string): Promise<void> {
    const v = this.files.get(from)
    if (v === undefined) throw new Error(`ENOENT rename: ${from}`)
    this.renameCount++
    this.files.set(to, v) // replaces existing `to` — the atomic-overwrite contract
    this.files.delete(from)
  }
}

function makeProvider(fs: FakeFs, extra: Partial<ConstructorParameters<typeof TauriFsProvider>[0]> = {}) {
  return new TauriFsProvider({ fs, storePath: STORE, tmpPath: TMP, debounceMs: 5, ...extra })
}

/** The store file as a parsed object (null if never written). */
function storeContent(fs: FakeFs): Record<string, string> | null {
  const raw = fs.files.get(STORE)
  return raw ? (JSON.parse(raw) as Record<string, string>) : null
}

describe('TauriFsProvider — coalescing', () => {
  it('collapses many rapid writes to one key into a single atomic write', async () => {
    const fs = new FakeFs()
    const p = makeProvider(fs)
    await p.set('veydria.note', 'a')
    await p.set('veydria.note', 'b')
    await p.set('veydria.note', 'c')
    await p.flush()
    expect(fs.writeCount).toBe(1)
    expect(fs.renameCount).toBe(1)
    expect(storeContent(fs)).toEqual({ 'veydria.note': 'c' }) // last value wins
  })

  it('debounce timer also coalesces without an explicit flush', async () => {
    const fs = new FakeFs()
    makeProvider(fs).set('veydria.x', '1') // fire-and-forget like the real call site
    const p = makeProvider(fs)
    await p.set('veydria.y', '1')
    await p.set('veydria.y', '2')
    await new Promise((r) => setTimeout(r, 20)) // let the 5ms debounce fire
    expect(fs.writeCount).toBeGreaterThanOrEqual(1)
    expect(storeContent(fs)!['veydria.y']).toBe('2')
  })
})

describe('TauriFsProvider — ordering across keys', () => {
  it('the final blob holds the latest value of every key', async () => {
    const fs = new FakeFs()
    const p = makeProvider(fs)
    await p.set('veydria.a', '1')
    await p.set('veydria.b', '2')
    await p.set('veydria.a', '3')
    await p.remove('veydria.b')
    await p.set('veydria.b', '9')
    await p.flush()
    expect(storeContent(fs)).toEqual({ 'veydria.a': '3', 'veydria.b': '9' })
  })
})

describe('TauriFsProvider — atomicity', () => {
  it('writes to the temp path then renames onto the live file (no partial live file)', async () => {
    const fs = new FakeFs()
    const p = makeProvider(fs)
    await p.set('veydria.k', 'v')
    await p.flush()
    expect(fs.lastWritePath).toBe(TMP) // bytes never go straight to the live file
    expect(fs.files.has(TMP)).toBe(false) // temp consumed by the rename
    expect(storeContent(fs)).toEqual({ 'veydria.k': 'v' })
  })

  it('a second save atomically overwrites the existing live file', async () => {
    const fs = new FakeFs()
    const p = makeProvider(fs)
    await p.set('veydria.k', 'first')
    await p.flush()
    await p.set('veydria.k', 'second')
    await p.flush()
    expect(storeContent(fs)).toEqual({ 'veydria.k': 'second' })
    expect(fs.renameCount).toBe(2)
  })
})

describe('TauriFsProvider — flush durability', () => {
  it('flush resolves only after the bytes are on disk', async () => {
    const fs = new FakeFs()
    const p = makeProvider(fs, { debounceMs: 10_000 }) // long debounce: only flush can land it
    await p.set('veydria.k', 'v')
    expect(storeContent(fs)).toBeNull() // not yet
    await p.flush()
    expect(storeContent(fs)).toEqual({ 'veydria.k': 'v' })
  })

  it('calls onWriteSuccess after a clean drain', async () => {
    const fs = new FakeFs()
    const onWriteSuccess = vi.fn()
    const p = makeProvider(fs, { onWriteSuccess })
    await p.set('veydria.k', 'v')
    await p.flush()
    expect(onWriteSuccess).toHaveBeenCalledTimes(1)
  })
})

describe('TauriFsProvider — error keeps data pending and retries', () => {
  it('surfaces the error, retains the value, and persists it on the next flush', async () => {
    const fs = new FakeFs()
    const onWriteError = vi.fn()
    const p = makeProvider(fs, { onWriteError })
    fs.failWrites = true
    await p.set('veydria.k', 'v')
    await expect(p.flush()).rejects.toThrow() // flush reports the failure
    expect(onWriteError).toHaveBeenCalledTimes(1)
    expect(storeContent(fs)).toBeNull() // nothing persisted — data NOT silently dropped

    fs.failWrites = false
    await p.flush() // retry now succeeds (value was kept pending)
    expect(storeContent(fs)).toEqual({ 'veydria.k': 'v' })
    expect(onWriteError).toHaveBeenCalledTimes(1) // no new error on the good write
  })
})

describe('TauriFsProvider — hydrate degradation', () => {
  it('reads an existing store file', async () => {
    const fs = new FakeFs()
    fs.files.set(STORE, JSON.stringify({ 'veydria.x': 'persisted' }))
    const p = makeProvider(fs)
    expect(await p.get('veydria.x')).toBe('persisted')
    expect(await p.list()).toEqual(['veydria.x'])
  })

  it('degrades a corrupt store file to an empty store without throwing', async () => {
    const fs = new FakeFs()
    fs.files.set(STORE, '{ this is not valid json')
    const p = makeProvider(fs)
    expect(await p.get('veydria.x')).toBeNull()
    expect(await p.list()).toEqual([])
  })

  it('treats a missing store file as empty', async () => {
    const fs = new FakeFs()
    const p = makeProvider(fs)
    expect(await p.get('veydria.x')).toBeNull()
    expect(await p.list()).toEqual([])
  })
})
