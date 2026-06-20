/**
 * web-campaign-io.ts — Browser/GitHub-Pages campaign I/O.
 *
 * Save = the established Blob `<a download>` pattern (mirrors
 * `utils/render-config.ts#downloadRenderConfig`). Open = a transient
 * `<input type="file">`. No Tauri dependency, so this module is statically
 * imported by `campaign-io.ts` and the file-picker click stays inside the user
 * gesture (a dynamic import would risk dropping the activation).
 */

import type { CampaignIO, OpenResult, SaveResult } from './campaign-io'

export const webCampaignIO: CampaignIO = {
  async save(defaultName: string, json: string): Promise<SaveResult> {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = defaultName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    // The browser hands off to its download manager; there is no cancel signal.
    return { saved: true }
  },

  open(): Promise<OpenResult | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) {
          resolve(null)
          return
        }
        const json = await file.text()
        resolve({ json, name: file.name })
      }
      // Modern WebView/Chromium fire `cancel` when the picker is dismissed.
      input.oncancel = () => resolve(null)
      input.click()
    })
  },
}
