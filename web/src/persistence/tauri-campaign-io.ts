/**
 * tauri-campaign-io.ts — Desktop campaign I/O via native dialogs + fs.
 *
 * Dynamically imported by `campaign-io.ts` only when running under Tauri, so the
 * plugin imports never reach the web bundle.
 *
 * Dialog paths go through the `write_text_atomic`/`read_text` Rust commands (see
 * `src-tauri/src/lib.rs`), NOT the JS fs plugin: Tauri v2 does not auto-grant fs
 * scope to dialog results, so a user-chosen path OUTSIDE the capability scope
 * (e.g. `D:\Campaigns\...`) is rejected by the plugin. `std::fs` is not subject to
 * the fs-plugin scope, so it covers any volume. The interface and everything above
 * it stay identical.
 */

import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import type { CampaignIO, OpenResult, SaveResult } from './campaign-io'

const JSON_FILTER = [{ name: 'Campaign', extensions: ['json'] }]

function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export const tauriCampaignIO: CampaignIO = {
  async save(defaultName: string, json: string): Promise<SaveResult> {
    const path = await saveDialog({ defaultPath: defaultName, filters: JSON_FILTER })
    if (!path) return { saved: false } // user cancelled
    try {
      await invoke('write_text_atomic', { path, contents: json })
      return { saved: true, path }
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  async open(): Promise<OpenResult | null> {
    const selected = await openDialog({ multiple: false, filters: JSON_FILTER })
    if (!selected || typeof selected !== 'string') return null
    const json = await invoke<string>('read_text', { path: selected })
    return { json, name: basename(selected) }
  },
}
