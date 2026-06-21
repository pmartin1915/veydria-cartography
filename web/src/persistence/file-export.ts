/**
 * file-export.ts — Runtime-selected "save a generated file" for one-way exports
 * (snapshot PNG, campaign log, render config, prep list, coordinate patches).
 *
 * Web/GitHub-Pages: Blob + `<a download>` (inline here — no Tauri deps, so this
 * module stays in the web bundle). Desktop: native save dialog + the Rust
 * `write_text_atomic`/`write_bytes_b64` commands (dynamically imported from
 * `tauri-file-export.ts`, code-split out of the web bundle). Mirrors
 * `campaign-io.ts`. The `<a download>` path is inert in WebView2, which is why
 * desktop must route through the dialog + std::fs instead.
 */

import { isTauri } from './runtime'

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface FileExportResult {
  /** True iff bytes were delivered (web) or written to disk (desktop). */
  saved: boolean
  /** Absolute path written, when known (desktop only). */
  path?: string
  /** Present only on a real failure (NOT on user cancel, where saved=false). */
  error?: string
}

function webDownload(defaultName: string, href: string, revoke: boolean): FileExportResult {
  const a = document.createElement('a')
  a.href = href
  a.download = defaultName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  if (revoke) URL.revokeObjectURL(href)
  // The browser hands off to its download manager; there is no cancel signal.
  return { saved: true }
}

/** Save a text file (markdown, JSON, YAML, …). */
export async function saveTextFile(
  defaultName: string,
  contents: string,
  mime: string,
  filter: FileFilter,
): Promise<FileExportResult> {
  if (isTauri) {
    const { tauriSaveText } = await import('./tauri-file-export')
    return tauriSaveText(defaultName, contents, filter)
  }
  const url = URL.createObjectURL(new Blob([contents], { type: mime }))
  return webDownload(defaultName, url, true)
}

/** Save a PNG from a `data:image/png;base64,…` URL (the snapshot capture format). */
export async function savePngDataUrl(
  defaultName: string,
  dataUrl: string,
): Promise<FileExportResult> {
  if (isTauri) {
    const { tauriSavePngDataUrl } = await import('./tauri-file-export')
    return tauriSavePngDataUrl(defaultName, dataUrl)
  }
  // Web: anchor straight from the data URL — no object URL to revoke.
  return webDownload(defaultName, dataUrl, false)
}
