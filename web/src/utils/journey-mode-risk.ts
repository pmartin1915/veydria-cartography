/**
 * journey-mode-risk.ts — Categorical mode-risk warning for the journey planner.
 *
 * Six cycles of regret-modeling research established that the "direct" route
 * mode paired with the caravan supply preset has ~2× the regret (failure rate)
 * of other modes across the simulated grid, but the magnitude is not per-cell
 * predictable from any feature class tried. Rather than show a magnitude the
 * data can't justify, the planner surfaces a categorical risk warning when
 * that specific combination is selected.
 *
 * Pure module — no DOM, no React, no I/O. Easy to extend if future mode
 * redesign work makes the trigger preset-aware in a more nuanced way.
 */

import type { RouteMode } from './journey-graph'
import type { SupplyConfig } from './journey-supply'

export function computeModeRiskWarning(
  mode: RouteMode,
  supply: SupplyConfig,
): string | null {
  if (mode === 'direct' && supply.packAnimals === 'caravan') {
    return 'Direct mode with a caravan pack has shown ~2× the failure rate of other modes in simulation. Consider "fastest" or "safest" with a caravan, or "direct" with a lighter pack.'
  }
  return null
}
