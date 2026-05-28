/**
 * journey-mode-recommend.ts — Mode-selector recommendation for the journey planner.
 *
 * Sibling to journey-mode-risk and journey-encounter-density: when one of those
 * categorical warnings fires, the planner should also surface a concrete next
 * step — "switch to safest" — directly on the mode selector. This module owns
 * the predicate that decides which mode (if any) to badge as recommended.
 *
 * The rules deliberately mirror the two existing warning predicates 1:1, so a
 * recommendation appears exactly when one or both warnings do. Keeping `mode`
 * in the return shape future-proofs against later rules that might recommend
 * `cheapest` or `fastest` without restructuring callers.
 *
 * Pure module — no DOM, no React, no I/O.
 */

import type { RouteMode } from './journey-graph'
import type { SupplyConfig } from './journey-supply'
import type { Encounter } from './encounters'
import { ENCOUNTER_DENSITY_SEVERE_THRESHOLD } from './journey-encounter-density'

export interface ModeRecommendation {
  mode: RouteMode
  reason: string
}

export function computeRecommendedMode(
  currentMode: RouteMode,
  supply: SupplyConfig,
  encounters: Encounter[],
): ModeRecommendation | null {
  if (currentMode === 'direct' && supply.packAnimals === 'caravan') {
    return { mode: 'safest', reason: 'Direct + caravan has ~2× the failure rate in simulation' }
  }
  if (currentMode !== 'safest') {
    const severeCount = encounters.filter(e => e.severity === 'severe').length
    if (severeCount >= ENCOUNTER_DENSITY_SEVERE_THRESHOLD) {
      return { mode: 'safest', reason: `${severeCount} severe encounters on this route` }
    }
  }
  return null
}
