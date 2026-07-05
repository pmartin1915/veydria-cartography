/**
 * tauri-file-export.ts — Desktop one-way file saves via native dialog + std::fs.
 *
 * Dynamically imported by `file-export.ts` only under Tauri, so the plugin imports
 * never reach the web bundle. Paths go through the `write_text_atomic` /
 * `write_bytes_b64` Rust commands (see `src-tauri/src/lib.rs`), NOT the JS fs
 * plugin: Tauri v2 does not auto-grant fs scope to dialog results, so a
 * user-chosen path outside the capability scope (e.g. `D:\`) would be rejected.
 */

import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import type { FileExportResult, FileFilter } from './file-export'
import { reportSaveFailure } from './save-status'

/**
 * Surface a desktop export failure on the always-visible badge. Success toasts
 * (and thus failure toasts) are swallowed by WebView2, so a failed export would
 * otherwise be silent on the one platform where the badge exists. We never clear
 * on export success — that would mask a prior autosave failure. (Same rationale
 * as Campaign Save routing here; see save-status.ts.)
 */
function reportExportFailure(defaultName: string, error: string): void {
  reportSaveFailure(`${defaultName}: ${error}`)
}

export async function tauriSaveText(
  defaultName: string,
  contents: string,
  filter: FileFilter,
): Promise<FileExportResult> {
  const path = await saveDialog({ defaultPath: defaultName, filters: [filter] })
  if (!path) return { saved: false } // user cancelled
  try {
    await invoke('write_text_atomic', { path, contents })
    return { saved: true, path }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    reportExportFailure(defaultName, error)
    return { saved: false, error }
  }
}

export async function tauriSavePngDataUrl(
  defaultName: string,
  dataUrl: string,
): Promise<FileExportResult> {
  const path = await saveDialog({
    defaultPath: defaultName,
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  })
  if (!path) return { saved: false } // user cancelled
  // Strip the `data:image/png;base64,` prefix — the payload is already base64.
  const data = dataUrl.slice(dataUrl.indexOf(',') + 1)
  try {
    await invoke('write_bytes_b64', { path, data })
    return { saved: true, path }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    reportExportFailure(defaultName, error)
    return { saved: false, error }
  }
}
