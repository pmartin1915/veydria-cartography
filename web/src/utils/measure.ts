/**
 * measure.ts — Distance calculation utilities for CRS.Simple measurement mode
 *
 * Scale: 1200 SVG units ≈ 3000 km (per MAP-PROMPT.md continental extent)
 */

// Scale constants
export const KM_PER_SVG_UNIT = 3000 / 1200 // ≈ 2.5 km per SVG unit
export const LEAGUES_PER_KM = 1 / 4 // 1 league ≈ 4 km

export function formatDistance(svgDistance: number): string {
  const km = svgDistance * KM_PER_SVG_UNIT
  const leagues = km * LEAGUES_PER_KM
  if (km < 1) return `${(km * 1000).toFixed(0)} m`
  if (km < 10) return `${km.toFixed(1)} km / ${leagues.toFixed(1)} leagues`
  return `${km.toFixed(0)} km / ${leagues.toFixed(0)} leagues`
}

export function svgDistanceToKm(svgDistance: number): number {
  return svgDistance * KM_PER_SVG_UNIT
}

export interface MeasureStats {
  pointCount: number
  totalDistance: number
  segments: number[]
}
