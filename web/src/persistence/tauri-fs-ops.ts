/**
 * tauri-fs-ops.ts — Concrete Tauri binding for the durable store.
 *
 * The auto-persistence store lives as one file in the app's local-data dir
 * (under `$HOME`, so the existing `$HOME/**` fs capability covers it once
 * `fs:allow-mkdir`/`fs:allow-rename` are granted). This is the ONE file the
 * Step-0 spike doesn't put at risk — only the user-chosen campaign path (which
 * can be on `D:\`) does. If the spike forces a Rust fallback, swap the three
 * `FsOps` calls below for `invoke(...)`; nothing else changes.
 *
 * Dynamically imported from `main.tsx` only on the Tauri branch — never bundled
 * for web.
 */

import { appLocalDataDir, join } from '@tauri-apps/api/path'
import { mkdir, readTextFile, writeTextFile, rename } from '@tauri-apps/plugin-fs'
import { TauriFsProvider, type FsOps } from './tauri-fs-provider'
import { reportSaveFailure, clearSaveFailure } from './save-status'

const STORE_FILE = 'veydria-store.json'
const TMP_FILE = 'veydria-store.json.tmp'

/** Build the disk-backed provider, ensuring its data dir exists. */
export async function createTauriFsProvider(): Promise<TauriFsProvider> {
  const dir = await appLocalDataDir()
  try {
    await mkdir(dir, { recursive: true })
  } catch {
    // Already exists (or a benign race) — recursive mkdir is meant to be idempotent.
  }
  const storePath = await join(dir, STORE_FILE)
  const tmpPath = await join(dir, TMP_FILE)

  const fs: FsOps = {
    readText: (p) => readTextFile(p),
    writeText: (p, c) => writeTextFile(p, c),
    rename: (from, to) => rename(from, to),
  }

  return new TauriFsProvider({
    fs,
    storePath,
    tmpPath,
    onWriteError: (err) => reportSaveFailure(err instanceof Error ? err.message : String(err)),
    onWriteSuccess: () => clearSaveFailure(),
  })
}
