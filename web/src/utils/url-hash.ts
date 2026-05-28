/**
 * url-hash.ts — Viewport-aware URL hash serialization
 *
 * Format: #feature=<id>&hex=<label>&hexA=<label>&hexB=<label>&z=<zoom>&cx=<center-x>&cy=<center-y>
 * All params optional. cx/cy are in SVG coordinate space (0–1200, 0–800).
 *
 * `hex` selects a single hex (info panel). `hexA`/`hexB` describe the two
 * endpoints of a hex distance measurement; both must be present for the
 * App to enter measure mode on load. `hex` and `hexA`/`hexB` are mutually
 * exclusive at the App level (single bottom sheet rule).
 */

import { DEFAULT_SUPPLY } from './journey-supply'
import type { Season, RouteMode } from './journey-graph'

export interface ViewportState {
  featureId?: string
  hexLabel?: string
  hexNote?: string
  hexA?: string
  hexB?: string
  zoom?: number
  centerX?: number
  centerY?: number
  journeyFrom?: string
  journeyTo?: string
  /** Planner season — when omitted, planner shows "Any" (season-blind weights). */
  season?: Season
  /** Planner mode — default 'direct'; omitted from the hash when at default. */
  mode?: RouteMode
  share?: boolean
  partyPace?: 'slow' | 'normal' | 'fast'
  partyMount?: 'foot' | 'mounted'
  partySize?: 'small' | 'medium' | 'large'
  partyForce?: boolean
  supplyRations?: number
  supplyWater?: number
  supplyEnc?: 'light' | 'normal' | 'heavy'
  supplyPack?: 'none' | 'few' | 'caravan'
  /** Fog-of-war: when paired with share=1, recipient sees the dim treatment on initial load. */
  fog?: boolean
}

const SEASON_VALUES = ['spring', 'summer', 'autumn', 'winter'] as const
const MODE_VALUES = ['direct', 'fastest', 'safest', 'cheapest'] as const
const PARTY_PACE_VALUES = ['slow', 'normal', 'fast'] as const
const PARTY_MOUNT_VALUES = ['foot', 'mounted'] as const
const PARTY_SIZE_VALUES = ['small', 'medium', 'large'] as const
const SUPPLY_ENC_VALUES = ['light', 'normal', 'heavy'] as const
const SUPPLY_PACK_VALUES = ['none', 'few', 'caravan'] as const

// Spreadsheet-style hex labels: row letters (one or more) + 1-based column.
const HEX_LABEL_RE = /^[A-Z]+\d+$/

const SVG_WIDTH = 1200
const SVG_HEIGHT = 800

export function parseHash(hash: string): ViewportState {
  const result: ViewportState = {}
  if (!hash || hash.length < 2) return result

  const params = new URLSearchParams(hash.slice(1)) // remove leading '#'

  const featureId = params.get('feature')
  if (featureId) result.featureId = featureId

  const hexLabel = params.get('hex')
  if (hexLabel && HEX_LABEL_RE.test(hexLabel)) result.hexLabel = hexLabel

  const hexNote = params.get('hexNote')
  if (hexNote && HEX_LABEL_RE.test(hexNote)) result.hexNote = hexNote

  const hexA = params.get('hexA')
  if (hexA && HEX_LABEL_RE.test(hexA)) result.hexA = hexA

  const hexB = params.get('hexB')
  if (hexB && HEX_LABEL_RE.test(hexB)) result.hexB = hexB

  const journeyFrom = params.get('journeyFrom')
  if (journeyFrom) result.journeyFrom = journeyFrom

  const journeyTo = params.get('journeyTo')
  if (journeyTo) result.journeyTo = journeyTo

  const season = params.get('season')
  if (season && (SEASON_VALUES as readonly string[]).includes(season)) {
    result.season = season as Season
  }

  const mode = params.get('mode')
  if (mode && (MODE_VALUES as readonly string[]).includes(mode)) {
    result.mode = mode as RouteMode
  }

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
  if (params.get('fog') === '1') result.fog = true

  const partyPace = params.get('partyPace')
  if (partyPace && (PARTY_PACE_VALUES as readonly string[]).includes(partyPace)) {
    result.partyPace = partyPace as ViewportState['partyPace']
  }
  const partyMount = params.get('partyMount')
  if (partyMount && (PARTY_MOUNT_VALUES as readonly string[]).includes(partyMount)) {
    result.partyMount = partyMount as ViewportState['partyMount']
  }
  const partySize = params.get('partySize')
  if (partySize && (PARTY_SIZE_VALUES as readonly string[]).includes(partySize)) {
    result.partySize = partySize as ViewportState['partySize']
  }
  if (params.get('partyForce') === '1') result.partyForce = true

  const supplyRations = params.get('supplyRations')
  if (supplyRations !== null) {
    const n = parseFloat(supplyRations)
    if (!isNaN(n) && n >= 0 && n <= 99) result.supplyRations = n
  }
  const supplyWater = params.get('supplyWater')
  if (supplyWater !== null) {
    const n = parseFloat(supplyWater)
    if (!isNaN(n) && n >= 0 && n <= 99) result.supplyWater = n
  }
  const supplyEnc = params.get('supplyEnc')
  if (supplyEnc && (SUPPLY_ENC_VALUES as readonly string[]).includes(supplyEnc)) {
    result.supplyEnc = supplyEnc as ViewportState['supplyEnc']
  }
  const supplyPack = params.get('supplyPack')
  if (supplyPack && (SUPPLY_PACK_VALUES as readonly string[]).includes(supplyPack)) {
    result.supplyPack = supplyPack as ViewportState['supplyPack']
  }

  return result
}

export function buildHash(state: ViewportState): string {
  const params = new URLSearchParams()
  if (state.featureId) params.set('feature', state.featureId)
  if (state.hexLabel) params.set('hex', state.hexLabel)
  if (state.hexNote) params.set('hexNote', state.hexNote)
  if (state.hexA) params.set('hexA', state.hexA)
  if (state.hexB) params.set('hexB', state.hexB)
  if (state.journeyFrom) params.set('journeyFrom', state.journeyFrom)
  if (state.journeyTo) params.set('journeyTo', state.journeyTo)
  if (state.season) params.set('season', state.season)
  // Mode default 'direct' is omitted to keep URLs short
  if (state.mode && state.mode !== 'direct') params.set('mode', state.mode)
  if (state.zoom !== undefined) params.set('z', state.zoom.toFixed(2))
  if (state.centerX !== undefined) params.set('cx', state.centerX.toFixed(1))
  if (state.centerY !== undefined) params.set('cy', state.centerY.toFixed(1))
  if (state.share) params.set('share', '1')
  if (state.fog) params.set('fog', '1')

  // Party config — omit defaults to keep URLs short
  if (state.partyPace && state.partyPace !== 'normal') params.set('partyPace', state.partyPace)
  if (state.partyMount && state.partyMount !== 'foot') params.set('partyMount', state.partyMount)
  if (state.partySize && state.partySize !== 'medium') params.set('partySize', state.partySize)
  if (state.partyForce) params.set('partyForce', '1')

  // Supply config — omit defaults (sourced from DEFAULT_SUPPLY)
  if (state.supplyRations !== undefined && state.supplyRations !== DEFAULT_SUPPLY.rationsPerPerson) {
    params.set('supplyRations', state.supplyRations.toString())
  }
  if (state.supplyWater !== undefined && state.supplyWater !== DEFAULT_SUPPLY.waterPerPerson) {
    params.set('supplyWater', state.supplyWater.toString())
  }
  if (state.supplyEnc && state.supplyEnc !== 'normal') params.set('supplyEnc', state.supplyEnc)
  if (state.supplyPack && state.supplyPack !== 'none') params.set('supplyPack', state.supplyPack)

  const str = params.toString()
  return str ? `#${str}` : ''
}

/**
 * Build a full shareable URL from the current viewport state.
 * @param state — viewport state to serialize
 * @param baseUrl — optional base URL; defaults to `window.location.origin + window.location.pathname + window.location.search` in browser, otherwise `''`
 */
export function buildShareUrl(state: ViewportState, baseUrl?: string): string {
  const hash = buildHash(state)
  const base = baseUrl ?? (typeof window !== 'undefined'
    ? window.location.origin + window.location.pathname + window.location.search
    : '')
  return base + hash
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
