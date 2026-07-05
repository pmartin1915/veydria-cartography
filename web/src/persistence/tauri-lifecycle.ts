/**
 * tauri-lifecycle.ts — Desktop window lifecycle wiring.
 *
 * Pending disk writes are debounced, so a quit can race ahead of the last write.
 * We intercept the close, drain `kvStore.flush()`, THEN destroy the window.
 *
 * Critical: flush in `try`, destroy in `finally`. If flush rejects (disk full, USB
 * ejected) we must still let the user quit — never trap them in an app that won't
 * close. The failure is surfaced through the save-status badge instead.
 *
 * Dynamically imported from `main.tsx` only under Tauri — never bundled for web.
 */

import { getCurrentWindow } from '@tauri-apps/api/window'
import { kvStore } from './kv-store'
import { reportSaveFailure } from './save-status'

export async function installCloseFlush(): Promise<void> {
  const win = getCurrentWindow()
  await win.onCloseRequested(async (event) => {
    event.preventDefault()
    try {
      await kvStore.flush()
    } catch (err) {
      reportSaveFailure(err instanceof Error ? err.message : String(err))
    } finally {
      await win.destroy()
    }
  })
}
