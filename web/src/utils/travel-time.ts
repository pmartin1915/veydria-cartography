/**
 * travel-time.ts — Estimate travel duration from GeoJSON feature geometry
 *
 * Scale: 1200 SVG units ≈ 3000 km (per MAP-PROMPT.md continental extent)
 * Speeds are grounded-fantasy averages, not modern transit.
 */

import { svgDistanceToKm } from './measure'

export interface TravelEstimate {
  km: number
  days: number
  speed: number
  method: string
}

// Speeds in km/day by broad terrain / transport mode
const SPEED_TABLE: Record<string, { speed: number; method: string }> = {
  trade_route: { speed: 30, method: 'mixed caravan & coastal shipping' },
  river: { speed: 50, method: 'riverboat (downstream)' },
  water: { speed: 80, method: 'fast coastal ship' },
}

function segmentLength(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return Math.sqrt(dx * dx + dy * dy)
}

function lineStringLengthKm(coords: number[][]): number {
  let svg = 0
  for (let i = 1; i < coords.length; i++) {
    svg += segmentLength(coords[i - 1] as [number, number], coords[i] as [number, number])
  }
  return svgDistanceToKm(svg)
}

function polygonPerimeterKm(rings: number[][][]): number {
  let svg = 0
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      svg += segmentLength(ring[i - 1] as [number, number], ring[i] as [number, number])
    }
  }
  return svgDistanceToKm(svg)
}

function featureLengthKm(feature: {
  geometry: { type: string; coordinates: unknown }
}): number {
  const type = feature.geometry.type
  const coords = feature.geometry.coordinates
  if (type === 'LineString') {
    return lineStringLengthKm(coords as number[][])
  }
  if (type === 'Polygon') {
    return polygonPerimeterKm(coords as number[][][])
  }
  if (type === 'MultiLineString') {
    let total = 0
    for (const line of coords as number[][][]) {
      total += lineStringLengthKm(line)
    }
    return total
  }
  return 0
}

/**
 * Estimate travel time for a GeoJSON feature.
 * Currently supported: trade_route, river, water (LineString/Polygon)
 */
export function estimateTravelTime(feature: {
  properties: Record<string, unknown>
  geometry: { type: string; coordinates: unknown }
}): TravelEstimate | null {
  const category = (feature.properties.category as string) || ''
  const config = SPEED_TABLE[category]
  if (!config) return null

  const km = featureLengthKm(feature)
  if (km <= 0) return null

  return {
    km,
    days: km / config.speed,
    speed: config.speed,
    method: config.method,
  }
}

export function formatTravelEstimate(est: TravelEstimate): string {
  const days = est.days
  if (days < 0.5) {
    const hours = Math.round(days * 24)
    return `~${hours} hour${hours !== 1 ? 's' : ''} by ${est.method} · ${Math.round(est.km)} km`
  }
  if (days < 2) {
    return `~${Math.round(days * 10) / 10} day by ${est.method} · ${Math.round(est.km)} km`
  }
  return `~${Math.round(days)} days by ${est.method} · ${Math.round(est.km)} km`
}
