/**
 * world-coords.ts — Planar Cartesian world-coordinate model for the Veydria map
 *
 * Canonical scale config + SVG↔world transforms + bearing/compass math.
 * Custom math only (no GIS libraries) — the world is a flat plane by design;
 * see research/veydria-coordinates.agent.final.md (planar Cartesian, graph-authoritative).
 *
 * Conventions (load-bearing — do not change silently):
 * - SVG space: 1200×800 viewBox, origin top-left, Y-DOWN. This is how every
 *   feature/marker position in the app is stored.
 * - World space: kilometres, origin bottom-left (SW corner), Y-UP (northKm
 *   increases northward). Display-only convention for readouts and labels.
 * - Scale is UNIFORM at the E-W calibration (1200 units = 4800 km → 4 km/unit).
 *   MAP-PROMPT.md states ~3200 km N-S over 800 units (also 4 km/unit), so the
 *   calibration is uniform in both axes. A non-uniform scale would make
 *   bearings direction-dependent and break every existing Euclidean consumer
 *   (journey-graph.ts, travel-time.ts, measure.ts).
 */

/**
 * Canonical map-layout tag for persisted data (pins, saved journeys, share
 * URLs, campaign exports, edit-mode patches). Bumped whenever the feature
 * geometry changes incompatibly; consumers compare against it to decide
 * whether persisted coordinates are still trustworthy. See
 * persistence/map-layout-migration.ts for the one-time local migration.
 */
export const MAP_LAYOUT = 'canon-2026-09-29'

export const worldScale = {
  svgWidth: 1200,
  svgHeight: 800,
  kmPerSvgUnit: 4800 / 1200, // 4 — E-W calibrated (1200 units = 4800 km), applied uniformly
  leaguesPerKm: 1 / 4, // 1 league ≈ 4 km
  canonSource: 'data/MAP-PROMPT.md',
} as const

export interface WorldPoint {
  x: number // SVG units, Y-down
  y: number
}

export interface WorldKm {
  eastKm: number // km east of the map's SW corner
  northKm: number // km north of the map's SW corner
}

/** SVG (Y-down, origin top-left) → world km (Y-up, origin bottom-left). */
export function svgToWorldKm(p: WorldPoint): WorldKm {
  return {
    eastKm: p.x * worldScale.kmPerSvgUnit,
    northKm: (worldScale.svgHeight - p.y) * worldScale.kmPerSvgUnit,
  }
}

/** World km → SVG. Inverse of svgToWorldKm. */
export function worldKmToSvg(w: WorldKm): WorldPoint {
  return {
    x: w.eastKm / worldScale.kmPerSvgUnit,
    y: worldScale.svgHeight - w.northKm / worldScale.kmPerSvgUnit,
  }
}

/** Straight-line ("as the crow flies") distance between two SVG points, in km. */
export function svgDistanceKm(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y) * worldScale.kmPerSvgUnit
}

/**
 * Compass bearing from `from` to `to`: 0° = north, clockwise, [0, 360).
 * SVG is Y-down, so "north on the map" is decreasing y — hence atan2(dx, -dy).
 * Returns 0 for coincident points (no meaningful bearing).
 */
export function bearingDegrees(from: WorldPoint, to: WorldPoint): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return 0
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI
  return (deg + 360) % 360
}

const WINDS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

const WINDS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const

/** 8-wind compass name for a bearing in degrees (sector width 45°). */
export function compass8(bearing: number): string {
  return WINDS_8[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]
}

/** 16-wind compass name for a bearing in degrees (sector width 22.5°). */
export function compass16(bearing: number): string {
  return WINDS_16[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16]
}
