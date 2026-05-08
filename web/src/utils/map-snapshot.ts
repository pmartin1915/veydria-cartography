/**
 * map-snapshot.ts — capture the current map viewport as a PNG.
 *
 * Uses html-to-image to rasterise the Leaflet container, including all
 * layers (canvas terrain, SVG vectors, image overlay, markers). Returns
 * a data URL that can be downloaded or written to the clipboard.
 */

import { toPng } from 'html-to-image'

interface SnapshotOptions {
  /** Pixel ratio multiplier (1 = native, 2 = retina). Default 2. */
  pixelRatio?: number
  /** CSS selector or HTMLElement of the map container. */
  target: HTMLElement
}

// Cap output at ~6 MP. Above this, clipboard writes start to silently fail
// in some browsers, and the resulting file (~5–10 MB at 6 MP) is already
// big enough to hurt anyone trying to drop the image into chat. On a 4K
// window with pixelRatio: 2 we'd otherwise hit ~16 MP / 30 MB.
const MAX_OUTPUT_MEGAPIXELS = 6

export async function captureMapPng(opts: SnapshotOptions): Promise<string> {
  const rect = opts.target.getBoundingClientRect()
  const requestedRatio = opts.pixelRatio ?? 2
  const requestedPixels = rect.width * rect.height * requestedRatio * requestedRatio
  const cap = MAX_OUTPUT_MEGAPIXELS * 1_000_000
  const ratio = requestedPixels > cap && rect.width > 0 && rect.height > 0
    ? Math.sqrt(cap / (rect.width * rect.height))
    : requestedRatio

  return toPng(opts.target, {
    pixelRatio: ratio,
    cacheBust: true,
    filter: (node) => {
      if (!(node instanceof HTMLElement)) return true
      const cls = node.className?.toString() || ''
      // Strip Leaflet's UI chrome from the snapshot.
      if (cls.includes('leaflet-control-zoom')) return false
      if (cls.includes('leaflet-control-attribution')) return false
      return true
    },
  })
}

export function downloadPng(dataUrl: string, filename = 'veydria-map.png'): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

export async function copyPngToClipboard(dataUrl: string): Promise<boolean> {
  try {
    if (!('clipboard' in navigator) || !('write' in navigator.clipboard)) return false
    const blob = await (await fetch(dataUrl)).blob()
    const item = new ClipboardItem({ 'image/png': blob })
    await navigator.clipboard.write([item])
    return true
  } catch {
    return false
  }
}

export function suggestSnapshotFilename(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `veydria-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.png`
}
