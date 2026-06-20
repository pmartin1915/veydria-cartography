/**
 * tauri-campaign-io.ts — Desktop campaign I/O via native dialogs + fs.
 *
 * Dynamically imported by `campaign-io.ts` only when running under Tauri, so the
 * plugin imports never reach the web bundle.
 *
 * ⚠ Step-0 spike seam: this writes/reads the dialog-chosen path with the JS fs
 * plugin. A path OUTSIDE the capability scope (e.g. `D:\Campaigns\...`) may be
 * rejected even though the user picked it in the native dialog — Tauri v2 does not
 * auto-grant fs scope to dialog results. If the `D:\` save fails in `tauri dev`,
 * swap the two `writeTextFile`/`readTextFile` calls for `invoke('write_text_atomic'|'read_text', …)`
 * Rust commands (std::fs is not subject to the fs-plugin scope). The interface and
 * everything above it stay identical.
 */

import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog'
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs'
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
      await writeTextFile(path, json)
      return { saved: true, path }
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  async open(): Promise<OpenResult | null> {
    const selected = await openDialog({ multiple: false, filters: JSON_FILTER })
    if (!selected || typeof selected !== 'string') return null
    const json = await readTextFile(selected)
    return { json, name: basename(selected) }
  },
}
