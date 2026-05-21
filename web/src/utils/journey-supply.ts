/**
 * journey-supply.ts — Per-day rations & water consumption for a journey
 *
 * Layered on top of `buildDailyBreakdown`: takes the JourneyDay[] the planner
 * already has, applies a per-person consumption model, and emits a parallel
 * SupplyDay[] timeline. Pure module — no DOM, no React, no I/O.
 *
 * The model is intentionally GM-friendly: per-person, decimal-precise,
 * negative-after-zero so the GM can see how many days of foraging or
 * turnaround pressure the party owes.
 */

import type { JourneyDay } from './journey-days'
import type { JourneyEdge, PartyConfig, Season } from './journey-graph'

export type Encumbrance = 'light' | 'normal' | 'heavy'
export type PackAnimals = 'none' | 'few' | 'caravan'

export interface SupplyConfig {
  /** Days of rations carried at depart (per traveller) */
  rationsPerPerson: number
  /** Days of water carried at depart (per traveller) */
  waterPerPerson: number
  encumbrance: Encumbrance
  packAnimals: PackAnimals
}

export const DEFAULT_SUPPLY: SupplyConfig = {
  rationsPerPerson: 7,
  waterPerPerson: 3,
  encumbrance: 'normal',
  packAnimals: 'none',
}

export function isDefaultSupply(s: SupplyConfig): boolean {
  return (
    s.rationsPerPerson === DEFAULT_SUPPLY.rationsPerPerson &&
    s.waterPerPerson === DEFAULT_SUPPLY.waterPerPerson &&
    s.encumbrance === DEFAULT_SUPPLY.encumbrance &&
    s.packAnimals === DEFAULT_SUPPLY.packAnimals
  )
}

export type SupplyWarning = 'rations-low' | 'water-low' | 'rations-out' | 'water-out'

export interface SupplyDay {
  dayNum: number
  /** Float, per-person. Display floors at 0 but raw value can be negative. */
  rationsLeft: number
  waterLeft: number
  rationsBurnedToday: number
  waterBurnedToday: number
  /** Highest-priority warning on this day, if any. Priority: water-out > rations-out > water-low > rations-low. */
  warning?: SupplyWarning
}

/** Biomes that increase water consumption (water × 1.5 on any day touching one). */
const ARID_BIOMES = new Set(['Desert', 'Sabkha', 'Steppe', 'Escarpment'])

/**
 * Compute the per-day supply timeline.
 *
 * @param days          Output of `buildDailyBreakdown` (1-indexed by dayNum)
 * @param party         Party config — forcedMarch increases burn rates
 * @param supply        Supply config — starting capacities + modifiers
 * @param biomeForEdge  Optional resolver: given a JourneyEdge, return the biome
 *                      name at its midpoint (or undefined). Caller typically
 *                      passes `(e) => edgeBiomes[route.edges.indexOf(e)]`.
 * @param season        Winter bumps ration consumption (the world is tropical;
 *                      no biome is reliably cold).
 */
export function computeSupplyTimeline(
  days: JourneyDay[],
  party: PartyConfig,
  supply: SupplyConfig,
  biomeForEdge?: (edge: JourneyEdge) => string | undefined,
  season?: Season,
): SupplyDay[] {
  if (days.length === 0) return []

  const encMult = supply.encumbrance === 'light' ? 0.9
    : supply.encumbrance === 'heavy' ? 1.1
    : 1.0

  const packBonus = supply.packAnimals === 'few' ? 3
    : supply.packAnimals === 'caravan' ? 7
    : 0

  const forcedRationsMult = party.forcedMarch ? 2.0 : 1.0
  const forcedWaterMult = party.forcedMarch ? 1.5 : 1.0
  const seasonRationsMult = season === 'winter' ? 1.25 : 1.0

  let rationsLeft = supply.rationsPerPerson + packBonus
  let waterLeft = supply.waterPerPerson + packBonus

  const out: SupplyDay[] = []

  for (const day of days) {
    let arid = false
    if (biomeForEdge) {
      for (const { edge } of day.edgesTraversed) {
        const b = biomeForEdge(edge)
        if (b && ARID_BIOMES.has(b)) { arid = true; break }
      }
    }

    const biomeWaterMult = arid ? 1.5 : 1.0

    const rationsBurned = encMult * forcedRationsMult * seasonRationsMult
    const waterBurned = encMult * forcedWaterMult * biomeWaterMult

    rationsLeft -= rationsBurned
    waterLeft -= waterBurned

    let warning: SupplyWarning | undefined
    if (waterLeft <= 0) warning = 'water-out'
    else if (rationsLeft <= 0) warning = 'rations-out'
    else if (waterLeft <= 2) warning = 'water-low'
    else if (rationsLeft <= 2) warning = 'rations-low'

    out.push({
      dayNum: day.dayNum,
      rationsLeft,
      waterLeft,
      rationsBurnedToday: rationsBurned,
      waterBurnedToday: waterBurned,
      warning,
    })
  }

  return out
}

export interface SupplyPressureSummary {
  rationsLowDay: number | null
  waterLowDay: number | null
  rationsOutDay: number | null
  waterOutDay: number | null
}

/**
 * Find the first day each threshold is crossed. Returns null for thresholds
 * never reached. Used by the markdown export's "Supply pressure" section.
 */
export function summarizeSupplyPressure(timeline: SupplyDay[]): SupplyPressureSummary {
  let rationsLowDay: number | null = null
  let waterLowDay: number | null = null
  let rationsOutDay: number | null = null
  let waterOutDay: number | null = null

  for (const d of timeline) {
    if (rationsLowDay === null && d.rationsLeft <= 2 && d.rationsLeft > 0) rationsLowDay = d.dayNum
    if (waterLowDay === null && d.waterLeft <= 2 && d.waterLeft > 0) waterLowDay = d.dayNum
    if (rationsOutDay === null && d.rationsLeft <= 0) rationsOutDay = d.dayNum
    if (waterOutDay === null && d.waterLeft <= 0) waterOutDay = d.dayNum
  }

  return { rationsLowDay, waterLowDay, rationsOutDay, waterOutDay }
}
