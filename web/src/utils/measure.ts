/**
 * measure.ts — Distance calculation utilities for CRS.Simple measurement mode
 *
 * Scale: 1200 SVG units ≈ 3000 km (per MAP-PROMPT.md continental extent).
 * The canonical scale config lives in world-coords.ts; these are re-exports
 * kept for existing consumers.
 */

import { worldScale } from './world-coords'

// Scale constants (canonical values in world-coords.ts worldScale)
export const KM_PER_SVG_UNIT = worldScale.kmPerSvgUnit // 2.5 km per SVG unit
export const LEAGUES_PER_KM = worldScale.leaguesPerKm // 1 league ≈ 4 km

// Freehand ruler segments have no route category, so travel-time.ts's
// estimateTravelTime (category-keyed speed table) can't apply; use the
// trade_route speed as the generic overland default.
export const DEFAULT_OVERLAND_KM_PER_DAY = 30

export function estimateMeasureDays(km: number): number {
  return km / DEFAULT_OVERLAND_KM_PER_DAY
}

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
