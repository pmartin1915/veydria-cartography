import { describe, it, expect } from 'vitest'
import { buildDailyBreakdown } from './journey-days'
import { DEFAULT_PARTY, type JourneyRoute, type PartyConfig, type JourneyEdge } from './journey-graph'
import {
  computeSupplyTimeline,
  DEFAULT_SUPPLY,
  isDefaultSupply,
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
    // Rations start at 7, burn 1/day → end at 2
    expect(timeline[4].rationsLeft).toBeCloseTo(2, 5)
    // Water starts at 3, burn 1/day → at day 3 is 0, day 4 is -1, day 5 is -2
    expect(timeline[2].waterLeft).toBeCloseTo(0, 5)
    expect(timeline[4].waterLeft).toBeCloseTo(-2, 5)
  })

  it('emits water-low and water-out warnings on the right days', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1], totalKm: 100 })
    const days = buildDailyBreakdown(route)
    const timeline = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY)
    const pressure = summarizeSupplyPressure(timeline)

    // Default water = 3 days. Day 1: 2 left (low). Day 3: 0 (out).
    expect(pressure.waterLowDay).toBe(1)
    expect(pressure.waterOutDay).toBe(3)
    // Default rations = 7. On a 5-day baseline, day 5 hits exactly 2 (low threshold).
    expect(pressure.rationsLowDay).toBe(5)
    expect(pressure.rationsOutDay).toBeNull()
  })
})

describe('journey-supply: forced march', () => {
  it('doubles ration burn and 1.5x water burn vs baseline', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 60 })
    const days = buildDailyBreakdown(route)
    const forcedParty: PartyConfig = { ...DEFAULT_PARTY, forcedMarch: true }
    const timeline = computeSupplyTimeline(days, forcedParty, DEFAULT_SUPPLY)

    // Rations: 7 - (2 * 3) = 1
    expect(timeline[2].rationsLeft).toBeCloseTo(1, 5)
    // Water: 3 - (1.5 * 3) = -1.5
    expect(timeline[2].waterLeft).toBeCloseTo(-1.5, 5)
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

    // Day 1: non-arid, water = 3 - 1 = 2
    expect(timeline[0].waterBurnedToday).toBeCloseTo(1.0, 5)
    expect(timeline[0].waterLeft).toBeCloseTo(2.0, 5)
    // Day 2: arid (Desert edge), water = 2 - 1.5 = 0.5
    expect(timeline[1].waterBurnedToday).toBeCloseTo(1.5, 5)
    expect(timeline[1].waterLeft).toBeCloseTo(0.5, 5)
  })
})

describe('journey-supply: winter season', () => {
  it('rations burn x1.25 in winter', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1, 1], totalKm: 80 })
    const days = buildDailyBreakdown(route, 'winter', 'direct')
    const timeline = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY, undefined, 'winter')

    // Rations burn = 1.25/day. 7 - 4*1.25 = 2
    expect(timeline[3].rationsLeft).toBeCloseTo(2.0, 5)
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
      rationsPerPerson: 7,
      waterPerPerson: 3,
      encumbrance: 'heavy',
      packAnimals: 'caravan',
    }
    const timeline = computeSupplyTimeline(days, DEFAULT_PARTY, supply)

    // Start: rations = 7 + 7 = 14, water = 3 + 7 = 10
    // Per-day burn: 1.0 * 1.1 = 1.1 (each)
    // Day 5: rations = 14 - 5.5 = 8.5, water = 10 - 5.5 = 4.5
    expect(timeline[4].rationsLeft).toBeCloseTo(8.5, 5)
    expect(timeline[4].waterLeft).toBeCloseTo(4.5, 5)
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

    // Pre-restore on day 3: rations = 7 - 3 = 4, water = 3 - 3 = 0
    // Post-restore: both back to DEFAULT_SUPPLY (rations 7, water 3, no packBonus)
    expect(timeline[2].rationsLeft).toBeCloseTo(7, 5)
    expect(timeline[2].waterLeft).toBeCloseTo(3, 5)
    // And no water-out warning, since restore happens before warning check
    expect(timeline[2].warning).toBeUndefined()
    // Day 4 continues normal burn from the restored state
    expect(timeline[3].rationsLeft).toBeCloseTo(6, 5)
    expect(timeline[3].waterLeft).toBeCloseTo(2, 5)
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

    // Day 3: rations 7 - 3 = 4 (unchanged by restore), water back to 3
    expect(timeline[2].rationsLeft).toBeCloseTo(4, 5)
    expect(timeline[2].waterLeft).toBeCloseTo(3, 5)
    // Day 5: rations 4 - 2 = 2, water 3 - 2 = 1 (low warning on water, not rations:
    // rations-low fires at <=2 but water-low has higher priority at <=2)
    expect(timeline[4].rationsLeft).toBeCloseTo(2, 5)
    expect(timeline[4].waterLeft).toBeCloseTo(1, 5)
  })

  it("'none' (and predicate absent) leaves baseline behavior unchanged", () => {
    const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1], totalKm: 100 })
    const days = buildDailyBreakdown(route)
    const baseline = computeSupplyTimeline(days, DEFAULT_PARTY, DEFAULT_SUPPLY)
    const withNone = computeSupplyTimeline(
      days, DEFAULT_PARTY, DEFAULT_SUPPLY, undefined, undefined, () => 'none',
    )
    expect(withNone).toEqual(baseline)
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
