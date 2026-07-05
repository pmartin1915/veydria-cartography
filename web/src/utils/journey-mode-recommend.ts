/**
 * journey-mode-recommend.ts — Mode-selector recommendation for the journey planner.
 *
 * Sibling to journey-mode-risk and journey-encounter-density: when one of those
 * categorical warnings fires, the planner should also surface a concrete next
 * step — "switch to safest" — directly on the mode selector. This module owns
 * the predicate that decides which mode (if any) to badge as recommended.
 *
 * The rules mirror the two categorical warning predicates 1:1, plus a third
 * supply-aware rule: the high-burn modes (`direct`/`fastest`) now consume more
 * rations/day by construction (see modeBurnMultipliers), so when rations are
 * scarce the planner nudges toward the low-burn `safest` mode. Keeping `mode`
 * in the return shape future-proofs against later rules.
 *
 * Pure module — no DOM, no React, no I/O.
 */

import type { RouteMode } from './journey-graph'
import type { SupplyConfig } from './journey-supply'
import type { Encounter } from './encounters'
import { ENCOUNTER_DENSITY_SEVERE_THRESHOLD } from './journey-encounter-density'

/** Below this many rations/person, the per-mode daily-burn delta matters enough
 *  that a high-burn mode (direct/fastest) is worth flagging. Set just below the
 *  default supply (6) so the default config does NOT perpetually nag, while the
 *  tight preset (3) and any user-scarcer load still trip it. */
export const LOW_RATIONS_THRESHOLD = 5

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
  if ((currentMode === 'direct' || currentMode === 'fastest') && supply.rationsPerPerson <= LOW_RATIONS_THRESHOLD) {
    const label = currentMode === 'direct' ? 'Direct' : 'Fastest'
    return { mode: 'safest', reason: `${label} mode burns extra rations/day — low supply favours safest` }
  }
  return null
}
