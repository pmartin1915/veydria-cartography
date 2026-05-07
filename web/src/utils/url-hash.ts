/**
 * url-hash.ts — Viewport-aware URL hash serialization
 *
 * Format: #feature=<id>&z=<zoom>&cx=<center-x>&cy=<center-y>
 * All params optional. cx/cy are in SVG coordinate space (0–1200, 0–800).
 */

export interface ViewportState {
  featureId?: string
  zoom?: number
  centerX?: number
  centerY?: number
  journeyFrom?: string
  journeyTo?: string
  share?: boolean
}

const SVG_WIDTH = 1200
const SVG_HEIGHT = 800

export function parseHash(hash: string): ViewportState {
  const result: ViewportState = {}
  if (!hash || hash.length < 2) return result

  const params = new URLSearchParams(hash.slice(1)) // remove leading '#'

  const featureId = params.get('feature')
  if (featureId) result.featureId = featureId

  const journeyFrom = params.get('journeyFrom')
  if (journeyFrom) result.journeyFrom = journeyFrom

  const journeyTo = params.get('journeyTo')
  if (journeyTo) result.journeyTo = journeyTo

  const z = params.get('z')
  if (z !== null) {
    const zoom = parseFloat(z)
    if (!isNaN(zoom)) result.zoom = zoom
  }

  const cx = params.get('cx')
  if (cx !== null) {
    const x = parseFloat(cx)
    if (!isNaN(x)) result.centerX = x
  }

  const cy = params.get('cy')
  if (cy !== null) {
    const y = parseFloat(cy)
    if (!isNaN(y)) result.centerY = y
  }

  if (params.get('share') === '1') result.share = true

  return result
}

export function buildHash(state: ViewportState): string {
  const params = new URLSearchParams()
  if (state.featureId) params.set('feature', state.featureId)
  if (state.journeyFrom) params.set('journeyFrom', state.journeyFrom)
  if (state.journeyTo) params.set('journeyTo', state.journeyTo)
  if (state.zoom !== undefined) params.set('z', state.zoom.toFixed(2))
  if (state.centerX !== undefined) params.set('cx', state.centerX.toFixed(1))
  if (state.centerY !== undefined) params.set('cy', state.centerY.toFixed(1))
  if (state.share) params.set('share', '1')

  const str = params.toString()
  return str ? `#${str}` : ''
}

/** Clamp zoom to valid map range */
export function clampZoom(z: number): number {
  return Math.max(-2, Math.min(4, z))
}

/** Clamp center to SVG bounds with some padding */
export function clampCenter(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(-200, Math.min(SVG_WIDTH + 200, x)),
    y: Math.max(-200, Math.min(SVG_HEIGHT + 200, y)),
  }
}
