/**
 * campaign-io.ts — How campaign bytes get to/from the user, abstracted over shell.
 *
 * Phase 5 baked file I/O straight into `CampaignMenu` (a Blob `<a download>` and a
 * hidden `<input type="file">`). Both are inert under WebView2 (no download manager,
 * no useful file input). This interface lets the menu acquire/write bytes the same
 * way regardless of shell; the confirm-modal + `importCampaign` flow above it is
 * unchanged. The Tauri implementation is dynamically imported so its plugin code
 * never enters the web bundle.
 */

import { isTauri } from './runtime'
import { webCampaignIO } from './web-campaign-io'

export interface SaveResult {
  /** False when the user cancelled the native save dialog (no file written). */
  saved: boolean
  /** Absolute path written, when known (Tauri). */
  path?: string
  /** Human-readable failure message; set means the write failed. */
  error?: string
}

export interface OpenResult {
  /** Raw file text — the caller `JSON.parse`s + validates it (shell-agnostic). */
  json: string
  /** A display label for the chosen file (basename). */
  name: string
}

export interface CampaignIO {
  /** Serialize+persist `json` under a suggested `defaultName`. */
  save(defaultName: string, json: string): Promise<SaveResult>
  /** Let the user pick a campaign file; resolves null if they cancel. */
  open(): Promise<OpenResult | null>
}

let cached: CampaignIO | null = null

/**
 * The active I/O for this shell. Web returns synchronously-available `webCampaignIO`
 * (so the file-input click stays inside the user gesture); Tauri lazy-loads its
 * dialog/fs-backed implementation on first use.
 */
export async function getCampaignIO(): Promise<CampaignIO> {
  if (cached) return cached
  cached = isTauri
    ? (await import('./tauri-campaign-io')).tauriCampaignIO
    : webCampaignIO
  return cached
}
