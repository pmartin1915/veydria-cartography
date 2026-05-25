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

/** Softer-pressure tier (water × 1.25). Arid takes priority when both are present. */
const SEMI_ARID_BIOMES = new Set(['Savanna', 'Scrubland'])

/** Tier of supply restored at a day's camp. See `getResupplyTier` (scripts/sim/run-journey.ts). */
export type ResupplyTier = 'full' | 'rations' | 'water' | 'none'

/**
 * Per-day burn modifiers an action can impose (Phase 3 sim policies).
 *
 * `continue` => {1, 1}, `rest` => {0, 1}, `force-march` => {2, 1.5},
 * `ration` => {0.5, 1}. Apply on top of the encumbrance/season/forced-march
 * multipliers already baked into the party/supply config so a party-level
 * forcedMarch *plus* a per-day force-march action would (deliberately) compound.
 */
export interface BurnModifiers {
  rations: number
  water: number
}

const DEFAULT_BURN_MODS: BurnModifiers = { rations: 1, water: 1 }

/**
 * Tier-1 supply constants derived once from a SupplyConfig. Held in JourneyState
 * so `applyDailyBurn` can restore to start+packBonus without re-deriving every day.
 */
export interface SupplyConstants {
  encMult: number
  packBonus: number
  startingRations: number
  startingWater: number
}

export function deriveSupplyConstants(supply: SupplyConfig): SupplyConstants {
  const encMult = supply.encumbrance === 'light' ? 0.9
    : supply.encumbrance === 'heavy' ? 1.1
    : 1.0
  const packBonus = supply.packAnimals === 'few' ? 3
    : supply.packAnimals === 'caravan' ? 7
    : 0
  return {
    encMult,
    packBonus,
    startingRations: supply.rationsPerPerson + packBonus,
    startingWater: supply.waterPerPerson + packBonus,
  }
}

export type AridityLevel = 'none' | 'semi-arid' | 'arid'

export function classifyAridity(
  edgesInDay: { edge: JourneyEdge; portion: number }[],
  biomeForEdge?: (edge: JourneyEdge) => string | undefined,
): AridityLevel {
  if (!biomeForEdge) return 'none'
  let semi: boolean = false
  for (const { edge } of edgesInDay) {
    const b = biomeForEdge(edge)
    if (b && ARID_BIOMES.has(b)) return 'arid'
    if (b && SEMI_ARID_BIOMES.has(b)) semi = true
  }
  return semi ? 'semi-arid' : 'none'
}

export interface BurnResult {
  rationsLeft: number
  waterLeft: number
  rationsBurnedToday: number
  waterBurnedToday: number
  warning?: SupplyWarning
}

/**
 * Apply one day's supply burn + optional resupply tier. Pure: takes
 * pre-day rations/water and returns post-day values. Both
 * `computeSupplyTimeline` (UI path) and `nextDay` (Phase 3 sim path) call
 * this so the burn formula has exactly one home.
 *
 * Restore happens AFTER burn but BEFORE warning computation, so a day that
 * camps at a civilization with rations-out from in-transit burn does not
 * flag rations-out for that day.
 */
export function applyDailyBurn(
  rationsLeft: number,
  waterLeft: number,
  constants: SupplyConstants,
  party: PartyConfig,
  season: Season | undefined,
  aridity: AridityLevel,
  resupplyTier: ResupplyTier,
  actionMods: BurnModifiers = DEFAULT_BURN_MODS,
): BurnResult {
  const { encMult, startingRations, startingWater } = constants
  const forcedRationsMult = party.forcedMarch ? 2.0 : 1.0
  const forcedWaterMult = party.forcedMarch ? 1.5 : 1.0
  const seasonRationsMult = season === 'winter' ? 1.25 : season === 'summer' ? 0.95 : 1.0
  const biomeWaterMult = aridity === 'arid' ? 1.5 : aridity === 'semi-arid' ? 1.25 : 1.0

  const rationsBurned = encMult * forcedRationsMult * seasonRationsMult * actionMods.rations
  const waterBurned = encMult * forcedWaterMult * biomeWaterMult * actionMods.water

  let nextRations = rationsLeft - rationsBurned
  let nextWater = waterLeft - waterBurned

  if (resupplyTier === 'full') {
    nextRations = startingRations
    nextWater = startingWater
  } else if (resupplyTier === 'water') {
    nextWater = startingWater
  } else if (resupplyTier === 'rations') {
    nextRations = startingRations
  }

  let warning: SupplyWarning | undefined
  if (nextWater <= 0) warning = 'water-out'
  else if (nextRations <= 0) warning = 'rations-out'
  else if (nextWater <= 2) warning = 'water-low'
  else if (nextRations <= 2) warning = 'rations-low'

  return {
    rationsLeft: nextRations,
    waterLeft: nextWater,
    rationsBurnedToday: rationsBurned,
    waterBurnedToday: waterBurned,
    warning,
  }
}

/**
 * Compute the per-day supply timeline.
 *
 * @param days          Output of `buildDailyBreakdown` (1-indexed by dayNum)
 * @param party         Party config — forcedMarch increases burn rates
 * @param supply        Supply config — starting capacities + modifiers
 * @param biomeForEdge  Optional resolver: given a JourneyEdge, return the biome
 *                      name at its midpoint (or undefined). Caller typically
 *                      passes `(e) => edgeBiomes[route.edges.indexOf(e)]`.
 * @param season        Winter bumps ration consumption, summer eases it 5%
 *                      (the world is tropical; no biome is reliably cold).
 * @param resupplyAtDay Optional predicate: given a 1-indexed `dayNum`, return
 *                      the tier of resupply this day's camp grants. `full`
 *                      restores both rations and water to start+packBonus,
 *                      `water` restores water only, `none` is no-op. Restore
 *                      happens after burn but before warning computation, so a
 *                      day camping at a civilization will not flag water-out
 *                      from in-transit consumption.
 */
export function computeSupplyTimeline(
  days: JourneyDay[],
  party: PartyConfig,
  supply: SupplyConfig,
  biomeForEdge?: (edge: JourneyEdge) => string | undefined,
  season?: Season,
  resupplyAtDay?: (dayNum: number) => ResupplyTier,
): SupplyDay[] {
  if (days.length === 0) return []

  const constants = deriveSupplyConstants(supply)
  let rationsLeft = constants.startingRations
  let waterLeft = constants.startingWater

  const out: SupplyDay[] = []

  for (const day of days) {
    const aridity = classifyAridity(day.edgesTraversed, biomeForEdge)
    const tier = resupplyAtDay?.(day.dayNum) ?? 'none'
    const result = applyDailyBurn(rationsLeft, waterLeft, constants, party, season, aridity, tier)
    rationsLeft = result.rationsLeft
    waterLeft = result.waterLeft
    out.push({
      dayNum: day.dayNum,
      rationsLeft: result.rationsLeft,
      waterLeft: result.waterLeft,
      rationsBurnedToday: result.rationsBurnedToday,
      waterBurnedToday: result.waterBurnedToday,
      warning: result.warning,
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
