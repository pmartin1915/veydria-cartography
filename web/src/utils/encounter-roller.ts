/**
 * encounter-roller.ts — On-demand, NON-deterministic encounter roller
 *
 * Companion to encounters.ts. Where encounters.ts produces a reproducible
 * encounter set keyed off the route signature (so a saved route reproduces
 * the same beats), this module is the GM "panic button": click Roll, get
 * one fresh, unrelated beat from the appropriate pool.
 *
 * Each call returns an independent random pick. Pass `rng: () => 0.42` for
 * deterministic testing.
 */

import {
  poolForEdgeType,
  filterBySeason,
  type Beat,
  type Encounter,
} from './encounters'
import type { Season } from './journey-graph'

export interface RollOneOffOpts {
  edgeType: 'trade_route' | 'chokepoint' | 'intra_civ'
  season?: Season
  severity?: 'mild' | 'moderate' | 'severe'
  /** Optional RNG override; defaults to Math.random. Useful for tests. */
  rng?: () => number
}

/**
 * Roll a single one-off encounter.
 *
 * Returns `null` when the filtered pool is empty (e.g. asking for a severity
 * level that doesn't appear in the chosen pool/season combination). Callers
 * should widen filters or surface a "no beats matched" message to the GM.
 *
 * The returned Encounter has `segmentIdx: -1` as a sentinel meaning
 * "not bound to a route segment" — this is an impromptu mid-session roll.
 */
export function rollOneOff(opts: RollOneOffOpts): Encounter | null {
  const rng = opts.rng ?? Math.random

  const basePool = poolForEdgeType(opts.edgeType)
  const seasonFiltered = filterBySeason(basePool, opts.season)
  const pool: Beat[] = opts.severity
    ? seasonFiltered.filter(b => b.severity === opts.severity)
    : seasonFiltered

  if (pool.length === 0) return null

  const idx = Math.floor(rng() * pool.length)
  // Guard against rng returning exactly 1 (Math.random is [0, 1) but a stub
  // might not be) — clamp to last index.
  const safeIdx = Math.min(idx, pool.length - 1)
  const beat = pool[safeIdx]

  return {
    segmentIdx: -1,
    beat: beat.text,
    type: beat.type,
    severity: beat.severity,
    narrative: beat.text,
  }
}
