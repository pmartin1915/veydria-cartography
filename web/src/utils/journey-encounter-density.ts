/**
 * journey-encounter-density.ts — Encounter-density warning for the journey planner.
 *
 * Sibling to journey-mode-risk: when the active route happens to carry several
 * severe encounters, surface a nudge toward "safest" mode (which routes through
 * less dangerous biomes by construction). Suppressed when the user is already
 * on safest — can't recommend what's already chosen.
 *
 * Severe-count is the GM-meaningful unit. Threshold is a fresh judgment call
 * (no codebase precedent linking density to mode preference); exported as a
 * constant so it can be retuned in one place.
 *
 * Pure module — no DOM, no React, no I/O.
 */

import type { RouteMode } from './journey-graph'
import type { Encounter } from './encounters'

export const ENCOUNTER_DENSITY_SEVERE_THRESHOLD = 2

export function computeEncounterDensityWarning(
  mode: RouteMode,
  encounters: Encounter[],
): string | null {
  if (mode === 'safest') return null
  const severeCount = encounters.filter(e => e.severity === 'severe').length
  if (severeCount < ENCOUNTER_DENSITY_SEVERE_THRESHOLD) return null
  return `This route includes ${severeCount} severe encounters. Consider 'safest' mode to route through less dangerous biomes.`
}
