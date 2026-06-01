import { describe, it, expect } from 'vitest'
import { buildDailyBreakdown } from './journey-days'
import { DEFAULT_PARTY, type JourneyRoute, type PartyConfig, type JourneyEdge } from './journey-graph'
import {
  applyDailyBurn,
  computeSupplyTimeline,
  deriveSupplyConstants,
  DEFAULT_SUPPLY,
  isDefaultSupply,
  modeBurnMultipliers,
  summarizeSupplyPressure,
  type SupplyConfig,
} from './journey-supply'

function makeRoute(opts: { edgeDays: number[]; totalKm: number }): JourneyRoute {
  const nodes = opts.edgeDays.map((_, i) => ({
    id: `n${i}`,
    name: `Node ${i}`,
    category: 'civilization',
    x: i * 100,
    y: 0,
  }))
  nodes.push({
    id: `n${opts.edgeDays.length}`,
    name: `Node ${opts.edgeDays.length}`,
    category: 'oasis',
    x: opts.edgeDays.length * 100,
    y: 0,
  })

  const edges: JourneyEdge[] = opts.edgeDays.map((d, i) => ({
    from: nodes[i].id,
    to: nodes[i + 1].id,
    distanceSvg: d * 100,
    type: (i % 2 === 0 ? 'trade_route' : 'intra_civ') as 'trade_route' | 'intra_civ',
    name: `Leg ${i}`,
    segmentDays: d,
  }))
  const totalRawSvg = edges.reduce((s, e) => s + e.distanceSvg, 0)
  const estimatedDays = opts.edgeDays.reduce((s, d) => s + d, 0)

  return {
    nodes,
    edges,
    totalDistanceSvg: totalRawSvg,
    totalKm: opts.totalKm,
    estimatedDays,
    bottlenecks: [],
    seasonalWarnings: [],
  }
}

describe('journey-supply: baseline consumption', () => {
  it('default party + default supply over a 5-day route burns 1/day each', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1], totalKm: 100 })
    const days = buildDailyBreakdown(route)
    const timeline = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY)

    expect(timeline.length).toBe(5)
    // Rations start at 12, burn 1/day → end at 7
    expect(timeline[4].rationsLeft).toBeCloseTo(7, 5)
    // Water starts at 6, burn 1/day → day 3 = 3, day 5 = 1
    expect(timeline[2].waterLeft).toBeCloseTo(3, 5)
    expect(timeline[4].waterLeft).toBeCloseTo(1, 5)
  })

  it('emits water-low and water-out warnings on the right days', () => {
    // 7-day route so the default 6-water budget actually exhausts.
    const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1, 1, 1], totalKm: 140 })
    const days = buildDailyBreakdown(route)
    const timeline = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY)
    const pressure = summarizeSupplyPressure(timeline)

    // Default water = 6. Day 4: 2 left (low). Day 6: 0 (out).
    expect(pressure.waterLowDay).toBe(4)
    expect(pressure.waterOutDay).toBe(6)
    // Default rations = 12. On a 7-day baseline, end at 5 — never crosses low (≤2).
    expect(pressure.rationsLowDay).toBeNull()
    expect(pressure.rationsOutDay).toBeNull()
  })
})

describe('journey-supply: forced march', () => {
  it('doubles ration burn and 1.5x water burn vs baseline', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 60 })
    const days = buildDailyBreakdown(route)
    const forcedParty: PartyConfig = { ...DEFAULT_PARTY, forcedMarch: true }
    const timeline = computeSupplyTimeline(days, forcedParty, DEFAULT_SUPPLY)

    // Rations: 12 - (2 * 3) = 6
    expect(timeline[2].rationsLeft).toBeCloseTo(6, 5)
    // Water: 6 - (1.5 * 3) = 1.5
    expect(timeline[2].waterLeft).toBeCloseTo(1.5, 5)
    // Per-day burn rates
    expect(timeline[0].rationsBurnedToday).toBeCloseTo(2.0, 5)
    expect(timeline[0].waterBurnedToday).toBeCloseTo(1.5, 5)
  })
})

describe('journey-supply: arid biome', () => {
  it('water burn x1.5 on days that traverse an arid edge', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 60 })
    const days = buildDailyBreakdown(route)

    // Tag the middle edge as Desert.
    const desertEdge = route.edges[1]
    const biomeForEdge = (e: JourneyEdge): string | undefined =>
      e === desertEdge ? 'Desert' : undefined

    const timeline = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY, biomeForEdge)

    // Day 1: non-arid, water = 6 - 1 = 5
    expect(timeline[0].waterBurnedToday).toBeCloseTo(1.0, 5)
    expect(timeline[0].waterLeft).toBeCloseTo(5.0, 5)
    // Day 2: arid (Desert edge), water = 5 - 1.5 = 3.5
    expect(timeline[1].waterBurnedToday).toBeCloseTo(1.5, 5)
    expect(timeline[1].waterLeft).toBeCloseTo(3.5, 5)
  })
})

describe('journey-supply: winter season', () => {
  it('rations burn x1.25 in winter', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1, 1], totalKm: 80 })
    const days = buildDailyBreakdown(route, 'winter', 'direct')
    const timeline = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY, undefined, 'winter')

    // Rations burn = 1.25/day. 12 - 4*1.25 = 7
    expect(timeline[3].rationsLeft).toBeCloseTo(7.0, 5)
    expect(timeline[0].rationsBurnedToday).toBeCloseTo(1.25, 5)
  })
})

describe('journey-supply: defaults + helpers', () => {
  it('isDefaultSupply detects the default config', () => {
    expect(isDefaultSupply(DEFAULT_SUPPLY)).toBe(true)
    expect(isDefaultSupply({ ...DEFAULT_SUPPLY, encumbrance: 'heavy' })).toBe(false)
    expect(isDefaultSupply({ ...DEFAULT_SUPPLY, packAnimals: 'caravan' })).toBe(false)
    expect(isDefaultSupply({ ...DEFAULT_SUPPLY, rationsPerPerson: 10 })).toBe(false)
    expect(isDefaultSupply({ ...DEFAULT_SUPPLY, waterPerPerson: 5 })).toBe(false)
  })
})

describe('journey-supply: encumbrance × pack-animals stacking', () => {
  it('heavy + caravan extends a 5-day route comfortably', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1], totalKm: 100 })
    const days = buildDailyBreakdown(route)
    const supply: SupplyConfig = {
      rationsPerPerson: 12,
      waterPerPerson: 6,
      encumbrance: 'heavy',
      packAnimals: 'caravan',
    }
    const timeline = computeSupplyTimeline(days, DEFAULT_PARTY, supply)

    // Start: rations = 12 + 7 = 19, water = 6 + 7 = 13
    // Per-day burn: 1.0 * 1.1 = 1.1 (each)
    // Day 5: rations = 19 - 5.5 = 13.5, water = 13 - 5.5 = 7.5
    expect(timeline[4].rationsLeft).toBeCloseTo(13.5, 5)
    expect(timeline[4].waterLeft).toBeCloseTo(7.5, 5)
    expect(timeline[0].rationsBurnedToday).toBeCloseTo(1.1, 5)
    expect(timeline[0].waterBurnedToday).toBeCloseTo(1.1, 5)
  })

  it('light encumbrance reduces burn rate', () => {
    const route = makeRoute({ edgeDays: [1, 1], totalKm: 40 })
    const days = buildDailyBreakdown(route)
    const supply: SupplyConfig = { ...DEFAULT_SUPPLY, encumbrance: 'light' }
    const timeline = computeSupplyTimeline(days, DEFAULT_PARTY, supply)

    expect(timeline[0].rationsBurnedToday).toBeCloseTo(0.9, 5)
    expect(timeline[0].waterBurnedToday).toBeCloseTo(0.9, 5)
  })
})

describe('journey-supply: resupplyAtDay', () => {
  it("'full' tier restores both rations and water to start+packBonus", () => {
    const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1], totalKm: 100 })
    const days = buildDailyBreakdown(route)
    const timeline = computeSupplyTimeline(
      days,
      DEFAULT_PARTY,
      DEFAULT_SUPPLY,
      undefined,
      undefined,
      (d) => (d === 3 ? 'full' : 'none'),
    )

    // Pre-restore on day 3: rations = 12 - 3 = 9, water = 6 - 3 = 3
    // Post-restore: both back to DEFAULT_SUPPLY (rations 12, water 6, no packBonus)
    expect(timeline[2].rationsLeft).toBeCloseTo(12, 5)
    expect(timeline[2].waterLeft).toBeCloseTo(6, 5)
    // And no water-out warning, since restore happens before warning check
    expect(timeline[2].warning).toBeUndefined()
    // Day 4 continues normal burn from the restored state
    expect(timeline[3].rationsLeft).toBeCloseTo(11, 5)
    expect(timeline[3].waterLeft).toBeCloseTo(5, 5)
  })

  it("'water' tier restores water only; rations continue to deplete", () => {
    const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1], totalKm: 100 })
    const days = buildDailyBreakdown(route)
    const timeline = computeSupplyTimeline(
      days,
      DEFAULT_PARTY,
      DEFAULT_SUPPLY,
      undefined,
      undefined,
      (d) => (d === 3 ? 'water' : 'none'),
    )

    // Day 3: rations 12 - 3 = 9 (unchanged by restore), water back to 6
    expect(timeline[2].rationsLeft).toBeCloseTo(9, 5)
    expect(timeline[2].waterLeft).toBeCloseTo(6, 5)
    // Day 5: rations 9 - 2 = 7, water 6 - 2 = 4 — neither below the ≤2 low threshold.
    expect(timeline[4].rationsLeft).toBeCloseTo(7, 5)
    expect(timeline[4].waterLeft).toBeCloseTo(4, 5)
  })

  it("'none' (and predicate absent) leaves baseline behavior unchanged", () => {
    const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1], totalKm: 100 })
    const days = buildDailyBreakdown(route)
    const baseline = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY)
    const withNone = computeSupplyTimeline(
      days, DEFAULT_PARTY, DEFAULT_SUPPLY, undefined, undefined, () => 'none',
    )
    expect(withNone).toEqual(baseline)
    // Phase 4 dynamic probe: no-restore days have no resupplyFired field.
    for (const d of baseline) expect(d.resupplyFired).toBeUndefined()
  })

  it("SupplyDay.resupplyFired echoes the tier on days the restore branch actually ran", () => {
    const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1], totalKm: 100 })
    const days = buildDailyBreakdown(route)
    const timeline = computeSupplyTimeline(
      days,
      DEFAULT_PARTY,
      DEFAULT_SUPPLY,
      undefined,
      undefined,
      (d) => (d === 2 ? 'water' : d === 4 ? 'full' : 'none'),
    )

    expect(timeline[0].resupplyFired).toBeUndefined()
    expect(timeline[1].resupplyFired).toBe('water')
    expect(timeline[2].resupplyFired).toBeUndefined()
    expect(timeline[3].resupplyFired).toBe('full')
    expect(timeline[4].resupplyFired).toBeUndefined()
  })
})

describe('journey-supply: semi-arid biome', () => {
  it('water burn x1.25 on days that traverse a Savanna edge', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 60 })
    const days = buildDailyBreakdown(route)
    const savannaEdge = route.edges[1]
    const biomeForEdge = (e: JourneyEdge): string | undefined =>
      e === savannaEdge ? 'Savanna' : undefined

    const timeline = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY, biomeForEdge)

    expect(timeline[0].waterBurnedToday).toBeCloseTo(1.0, 5)
    expect(timeline[1].waterBurnedToday).toBeCloseTo(1.25, 5)
  })

  it('arid takes priority when both arid and semi-arid edges in same day', () => {
    // Single-day route that spans both biome edges via fractional segmentDays.
    const route = makeRoute({ edgeDays: [0.5, 0.5], totalKm: 40 })
    const days = buildDailyBreakdown(route)
    // The single day should touch both edges. Confirm setup.
    expect(days.length).toBe(1)
    const biomeForEdge = (e: JourneyEdge): string | undefined => {
      if (e === route.edges[0]) return 'Scrubland'
      if (e === route.edges[1]) return 'Desert'
      return undefined
    }
    const timeline = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY, biomeForEdge)
    expect(timeline[0].waterBurnedToday).toBeCloseTo(1.5, 5)
  })
})

describe('journey-supply: summer season', () => {
  it('rations burn x0.95 in summer (tropical biology easing)', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1, 1], totalKm: 80 })
    const days = buildDailyBreakdown(route, 'summer', 'direct')
    const timeline = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY, undefined, 'summer')

    expect(timeline[0].rationsBurnedToday).toBeCloseTo(0.95, 5)
  })
})

describe('journey-supply: applyDailyBurn encounter cost', () => {
  const constants = deriveSupplyConstants(DEFAULT_SUPPLY)

  it('omitting encounterCost is unchanged from baseline burn', () => {
    const baseline = applyDailyBurn(10, 5, constants, DEFAULT_PARTY, undefined, 'none', 'none')
    expect(baseline.rationsLeft).toBeCloseTo(9, 5)
    expect(baseline.waterLeft).toBeCloseTo(4, 5)
    expect(baseline.rationsBurnedToday).toBeCloseTo(1, 5)
    expect(baseline.waterBurnedToday).toBeCloseTo(1, 5)
  })

  it('severe encounter cost subtracts 2 rations and 2 water on top of burn', () => {
    const r = applyDailyBurn(
      10, 5, constants, DEFAULT_PARTY, undefined, 'none', 'none',
      undefined, { rations: 2, water: 2 },
    )
    // 10 - 1 burn - 2 encounter = 7; 5 - 1 burn - 2 encounter = 2
    expect(r.rationsLeft).toBeCloseTo(7, 5)
    expect(r.waterLeft).toBeCloseTo(2, 5)
    // rationsBurnedToday/waterBurnedToday is total day debit (burn + encounter)
    expect(r.rationsBurnedToday).toBeCloseTo(3, 5)
    expect(r.waterBurnedToday).toBeCloseTo(3, 5)
  })

  it('moderate encounter cost subtracts 1 ration and 1 water', () => {
    const r = applyDailyBurn(
      10, 5, constants, DEFAULT_PARTY, undefined, 'none', 'none',
      undefined, { rations: 1, water: 1 },
    )
    expect(r.rationsLeft).toBeCloseTo(8, 5)
    expect(r.waterLeft).toBeCloseTo(3, 5)
  })

  it('encounter cost is debited BEFORE resupply restore — full-tier civ stop still restores', () => {
    // Day at a 'full' tier camp: encounter cost should not prevent full restore.
    const r = applyDailyBurn(
      3, 2, constants, DEFAULT_PARTY, undefined, 'none', 'full',
      undefined, { rations: 2, water: 2 },
    )
    // Even though 3 - 1 - 2 = 0 and 2 - 1 - 2 = -1, the 'full' restore
    // overwrites both to start+packBonus (default supply = 12 / 6).
    expect(r.rationsLeft).toBe(constants.startingRations)
    expect(r.waterLeft).toBe(constants.startingWater)
    // But the "burned today" reflects the realized loss before restore.
    expect(r.rationsBurnedToday).toBeCloseTo(3, 5)
    expect(r.waterBurnedToday).toBeCloseTo(3, 5)
  })

  it('multiple-encounter day costs sum (pass aggregated cost)', () => {
    // Two severes on the same day → caller aggregates to {4, 4}.
    const r = applyDailyBurn(
      12, 6, constants, DEFAULT_PARTY, undefined, 'none', 'none',
      undefined, { rations: 4, water: 4 },
    )
    // 12 - 1 - 4 = 7; 6 - 1 - 4 = 1
    expect(r.rationsLeft).toBeCloseTo(7, 5)
    expect(r.waterLeft).toBeCloseTo(1, 5)
    // Hits 'water-low' warning at <= 2 (water = 1).
    expect(r.warning).toBe('water-low')
  })
})

describe('journey-supply: applyDailyBurn resupplyFired echo (Phase 4 dynamic probe)', () => {
  const constants = deriveSupplyConstants(DEFAULT_SUPPLY)

  it('tier none → resupplyFired omitted', () => {
    const r = applyDailyBurn(10, 5, constants, DEFAULT_PARTY, undefined, 'none', 'none')
    expect(r.resupplyFired).toBeUndefined()
  })

  it("tier 'water' → resupplyFired === 'water'", () => {
    const r = applyDailyBurn(10, 1, constants, DEFAULT_PARTY, undefined, 'none', 'water')
    expect(r.resupplyFired).toBe('water')
    expect(r.waterLeft).toBe(constants.startingWater)
  })

  it("tier 'full' → resupplyFired === 'full'", () => {
    const r = applyDailyBurn(2, 1, constants, DEFAULT_PARTY, undefined, 'none', 'full')
    expect(r.resupplyFired).toBe('full')
    expect(r.rationsLeft).toBe(constants.startingRations)
    expect(r.waterLeft).toBe(constants.startingWater)
  })

  it("tier 'rations' → resupplyFired === 'rations' (engine vocab even though no current category uses it)", () => {
    const r = applyDailyBurn(1, 5, constants, DEFAULT_PARTY, undefined, 'none', 'rations')
    expect(r.resupplyFired).toBe('rations')
    expect(r.rationsLeft).toBe(constants.startingRations)
  })
})

describe('journey-supply: per-mode burn multiplier', () => {
  const constants = deriveSupplyConstants(DEFAULT_SUPPLY)

  it('modeBurnMultipliers is neutral {1,1} for an absent mode (legacy byte-identity)', () => {
    expect(modeBurnMultipliers(undefined)).toEqual({ rations: 1, water: 1 })
  })

  it('modeBurnMultipliers ranks burn safest < cheapest < fastest <= direct on rations', () => {
    const safest = modeBurnMultipliers('safest').rations
    const cheapest = modeBurnMultipliers('cheapest').rations
    const fastest = modeBurnMultipliers('fastest').rations
    const direct = modeBurnMultipliers('direct').rations
    expect(safest).toBeLessThan(cheapest)
    expect(cheapest).toBeLessThan(fastest)
    expect(fastest).toBeLessThanOrEqual(direct)
    // Water multipliers follow the same ordering.
    expect(modeBurnMultipliers('safest').water).toBeLessThan(modeBurnMultipliers('direct').water)
  })

  it('applyDailyBurn with mode omitted is byte-identical to the legacy mode-blind burn', () => {
    const legacy = applyDailyBurn(10, 5, constants, DEFAULT_PARTY, undefined, 'none', 'none')
    const omitted = applyDailyBurn(
      10, 5, constants, DEFAULT_PARTY, undefined, 'none', 'none',
      undefined, undefined, undefined,
    )
    expect(omitted.rationsLeft).toBe(legacy.rationsLeft)
    expect(omitted.waterLeft).toBe(legacy.waterLeft)
    expect(omitted.rationsBurnedToday).toBe(legacy.rationsBurnedToday)
    expect(omitted.waterBurnedToday).toBe(legacy.waterBurnedToday)
  })

  it("mode 'direct' scales the day's burn by its multiplier (1.15 rations / 1.10 water)", () => {
    const r = applyDailyBurn(
      10, 5, constants, DEFAULT_PARTY, undefined, 'none', 'none',
      undefined, undefined, 'direct',
    )
    // Base burn is 1/1; direct multiplies to 1.15 / 1.10.
    expect(r.rationsBurnedToday).toBeCloseTo(1.15, 5)
    expect(r.waterBurnedToday).toBeCloseTo(1.10, 5)
    expect(r.rationsLeft).toBeCloseTo(10 - 1.15, 5)
    expect(r.waterLeft).toBeCloseTo(5 - 1.10, 5)
  })

  it("mode 'safest' burns strictly less than 'direct' for the same day", () => {
    const safest = applyDailyBurn(10, 5, constants, DEFAULT_PARTY, undefined, 'none', 'none', undefined, undefined, 'safest')
    const direct = applyDailyBurn(10, 5, constants, DEFAULT_PARTY, undefined, 'none', 'none', undefined, undefined, 'direct')
    expect(safest.rationsBurnedToday).toBeLessThan(direct.rationsBurnedToday)
    expect(safest.waterBurnedToday).toBeLessThan(direct.waterBurnedToday)
  })

  it('mode multiplier composes with action + season + forced-march (does not replace them)', () => {
    // forced march (×2 rations) + winter (×1.25 rations) + direct (×1.15) on a base 1.
    const forced: PartyConfig = { ...DEFAULT_PARTY, forcedMarch: true }
    const r = applyDailyBurn(20, 10, constants, forced, 'winter', 'none', 'none', undefined, undefined, 'direct')
    expect(r.rationsBurnedToday).toBeCloseTo(2 * 1.25 * 1.15, 5)
  })

  it('computeSupplyTimeline omitting mode is unchanged; safest leaves more supply than direct', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1], totalKm: 100 })
    const days = buildDailyBreakdown(route)
    const neutral = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY)
    const omitted = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY, undefined, undefined, undefined, undefined)
    expect(omitted[4].rationsLeft).toBe(neutral[4].rationsLeft)

    const safest = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY, undefined, undefined, undefined, 'safest')
    const direct = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY, undefined, undefined, undefined, 'direct')
    expect(safest[4].rationsLeft).toBeGreaterThan(direct[4].rationsLeft)
    expect(safest[4].waterLeft).toBeGreaterThan(direct[4].waterLeft)
  })
})
