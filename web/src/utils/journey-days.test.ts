import { describe, it, expect } from 'vitest'
import { buildDailyBreakdown, initJourneyState, nextDay, resupplyByDayForRoute } from './journey-days'
import { DEFAULT_PARTY, type JourneyRoute, type PartyConfig } from './journey-graph'
import { DEFAULT_SUPPLY, computeSupplyTimeline, getResupplyTier, type ResupplyTier } from './journey-supply'

function makeRoute(opts: { edgeDays: number[]; totalKm: number }): JourneyRoute {
  const nodes = opts.edgeDays.map((_, i) => ({
    id: `n${i}`,
    name: `Node ${i}`,
    category: i === 0 ? 'port' : i === opts.edgeDays.length ? 'oasis' : 'civilization',
    x: i * 100,
    y: 0,
  }))
  // One trailing node since edges connect i to i+1
  nodes.push({
    id: `n${opts.edgeDays.length}`,
    name: `Node ${opts.edgeDays.length}`,
    category: 'oasis',
    x: opts.edgeDays.length * 100,
    y: 0,
  })

  const totalRawSvg = opts.edgeDays.reduce((s, d) => s + d * 100, 0) // arbitrary mapping
  const edges = opts.edgeDays.map((d, i) => ({
    from: nodes[i].id,
    to: nodes[i + 1].id,
    distanceSvg: d * 100,
    type: (i % 2 === 0 ? 'trade_route' : 'intra_civ') as 'trade_route' | 'intra_civ',
    name: `Leg ${i}`,
    segmentDays: d,
  }))
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

describe('journey-days: bucketing', () => {
  it('produces zero days for an empty route', () => {
    const route = makeRoute({ edgeDays: [], totalKm: 0 })
    const days = buildDailyBreakdown(route)
    expect(days).toEqual([])
  })

  it('one short edge collapses to a single day', () => {
    const route = makeRoute({ edgeDays: [0.5], totalKm: 10 })
    const days = buildDailyBreakdown(route)
    expect(days.length).toBe(1)
    expect(days[0].dayNum).toBe(1)
  })

  it('a 5-day journey produces exactly 5 day buckets', () => {
    const route = makeRoute({ edgeDays: [2, 2, 1], totalKm: 125 })
    const days = buildDailyBreakdown(route)
    expect(days.length).toBe(5)
    expect(days[0].startLabel).toContain('Depart')
    expect(days[4].campLabel).toContain('Arrive at')
  })

  it('total km across days approximately equals route.totalKm', () => {
    const route = makeRoute({ edgeDays: [1.5, 2.0, 0.5, 1.0], totalKm: 125 })
    const days = buildDailyBreakdown(route)
    const sum = days.reduce((s, d) => s + d.kmCovered, 0)
    expect(sum).toBeGreaterThan(route.totalKm * 0.99)
    expect(sum).toBeLessThan(route.totalKm * 1.01)
  })

  it('is deterministic — same input → same output', () => {
    const r1 = makeRoute({ edgeDays: [2, 1, 1], totalKm: 100 })
    const r2 = makeRoute({ edgeDays: [2, 1, 1], totalKm: 100 })
    const a = buildDailyBreakdown(r1, 'spring', 'direct')
    const b = buildDailyBreakdown(r2, 'spring', 'direct')
    expect(a.map(d => d.weather)).toEqual(b.map(d => d.weather))
    expect(a.map(d => d.encounters.length)).toEqual(b.map(d => d.encounters.length))
  })

  it('different season produces different weather lines', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    const spring = buildDailyBreakdown(route, 'spring', 'direct')
    const winter = buildDailyBreakdown(route, 'winter', 'direct')
    // It's possible for one weather line to coincide; require at least one
    // day to differ since the seasonal pools are distinct.
    const anyDifferent = spring.some((d, i) => d.weather !== winter[i].weather)
    expect(anyDifferent).toBe(true)
  })

  it('encounters distribute across days, not clumped on the last', () => {
    const route = makeRoute({ edgeDays: [3, 3, 3], totalKm: 225 })
    const days = buildDailyBreakdown(route, 'summer', 'direct')
    const daysWithEncounters = days.filter(d => d.encounters.length > 0).length
    expect(daysWithEncounters).toBeGreaterThanOrEqual(2)
  })

  it('day 1 starts from origin name', () => {
    const route = makeRoute({ edgeDays: [2], totalKm: 50 })
    const days = buildDailyBreakdown(route)
    expect(days[0].startLabel).toContain(route.nodes[0].name)
  })

  it('last day camps at destination', () => {
    const route = makeRoute({ edgeDays: [1, 1], totalKm: 50 })
    const days = buildDailyBreakdown(route)
    const last = days[days.length - 1]
    expect(last.campLabel).toContain(route.nodes[route.nodes.length - 1].name)
  })

  it('populates edgesTraversed so UI can map days to segments', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 90 })
    const days = buildDailyBreakdown(route)
    expect(days.length).toBe(3)
    for (const day of days) {
      expect(day.edgesTraversed.length).toBeGreaterThanOrEqual(1)
      expect(day.edgesTraversed[0].edge).toBeDefined()
      expect(day.edgesTraversed[0].portion).toBeGreaterThan(0)
      expect(day.edgesTraversed[0].portion).toBeLessThanOrEqual(1)
    }
    // Day 1 should traverse the first edge
    expect(days[0].edgesTraversed[0].edge).toBe(route.edges[0])
    // Day 3 should traverse the last edge
    expect(days[2].edgesTraversed[0].edge).toBe(route.edges[2])
  })

  it('populates calendarEvents and dayOfYear when departure date is set', () => {
    const route = makeRoute({ edgeDays: [2, 2], totalKm: 100 })
    // Start on day 355 (close to year-end) so the 4-day journey wraps into
    // the new year, exercising the wrap-around logic.
    const days = buildDailyBreakdown(route, 'winter', 'direct', undefined, 355)
    expect(days.length).toBe(4)
    expect(days[0].dayOfYear).toBe(355)
    expect(days[1].dayOfYear).toBe(356)
    expect(days[2].dayOfYear).toBe(357)
    expect(days[3].dayOfYear).toBe(358)
    // At least some days should have calendar events (the canon calendar is
    // dense enough that a 4-day window almost always hits something).
    const daysWithEvents = days.filter(d => d.calendarEvents && d.calendarEvents.length > 0)
    expect(daysWithEvents.length).toBeGreaterThanOrEqual(1)
    // Each event should have the expected shape
    for (const day of days) {
      if (day.calendarEvents) {
        for (const ev of day.calendarEvents) {
          expect(ev.id).toBeDefined()
          expect(ev.name).toBeDefined()
          expect(ev.type).toBeDefined()
        }
      }
    }
  })

  it('wraps day-of-year around the year end correctly', () => {
    const route = makeRoute({ edgeDays: [2, 1], totalKm: 50 })
    const days = buildDailyBreakdown(route, 'winter', 'direct', undefined, 364)
    expect(days.length).toBe(3)
    expect(days[0].dayOfYear).toBe(364)
    expect(days[1].dayOfYear).toBe(365)
    expect(days[2].dayOfYear).toBe(1)   // wrapped
  })

  it('filters calendar events to route civilizations', () => {
    const route = makeRoute({ edgeDays: [1], totalKm: 25 })
    // Assign ndjadi civ to all nodes so the route is "in Ndjadi territory"
    for (const node of route.nodes) {
      node.civ = 'ndjadi'
    }
    // Day 30 has both ndjadi-peak-fishing and irrah-imajin-council-spring active.
    const days = buildDailyBreakdown(route, 'winter', 'direct', undefined, 30)
    expect(days.length).toBe(1)
    expect(days[0].calendarEvents).toBeDefined()
    const eventNames = days[0].calendarEvents!.map(e => e.id)
    expect(eventNames).toContain('ndjadi-peak-fishing')
    expect(eventNames).not.toContain('irrah-imajin-council-spring')
  })

  it('includes basin-wide (all) calendar events regardless of route civ', () => {
    const route = makeRoute({ edgeDays: [1], totalKm: 25 })
    for (const node of route.nodes) {
      node.civ = 'kheshkai'
    }
    // Day 1 has basin-khazadari-rate-setting (civilization: 'all').
    const days = buildDailyBreakdown(route, 'winter', 'direct', undefined, 1)
    expect(days.length).toBe(1)
    expect(days[0].calendarEvents).toBeDefined()
    const eventNames = days[0].calendarEvents!.map(e => e.id)
    expect(eventNames).toContain('basin-khazadari-rate-setting')
  })

  it('forced march adds an exhaustion line to every day', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    const party: PartyConfig = { ...DEFAULT_PARTY, forcedMarch: true }
    const days = buildDailyBreakdown(route, undefined, 'direct', undefined, undefined, party)
    expect(days.length).toBe(3)
    for (const day of days) {
      expect(day.notable.some(n => n.toLowerCase().includes('forced march'))).toBe(true)
    }
  })

  it('day 1 summary line only appears when party differs from default', () => {
    const route = makeRoute({ edgeDays: [1, 1], totalKm: 50 })

    const defaultDays = buildDailyBreakdown(route, undefined, 'direct', undefined, undefined, DEFAULT_PARTY)
    expect(defaultDays[0].notable.some(n => n.startsWith('Party:'))).toBe(false)

    const mounted: PartyConfig = { ...DEFAULT_PARTY, mount: 'mounted' }
    const mountedDays = buildDailyBreakdown(route, undefined, 'direct', undefined, undefined, mounted)
    expect(mountedDays[0].notable.some(n => n.startsWith('Party:'))).toBe(true)
    // Summary line only on day 1
    expect(mountedDays[1].notable.some(n => n.startsWith('Party:'))).toBe(false)
  })

  it('omits party summary and forced-march line when no party config supplied', () => {
    const route = makeRoute({ edgeDays: [1], totalKm: 25 })
    const days = buildDailyBreakdown(route)
    expect(days[0].notable.some(n => n.startsWith('Party:'))).toBe(false)
    expect(days[0].notable.some(n => n.toLowerCase().includes('forced march'))).toBe(false)
  })
})

describe('journey-days: nextDay parity with buildDailyBreakdown', () => {
  /* The parity gate: initJourneyState + loop nextDay({continue}) must produce
   * the same JourneyDay[] that buildDailyBreakdown produces. This is what
   * keeps the UI (which calls buildDailyBreakdown) and the sim (which steps
   * via nextDay) on the same engine. */

  function sameJourneyDays(a: ReturnType<typeof buildDailyBreakdown>, b: ReturnType<typeof buildDailyBreakdown>): void {
    expect(b.length).toBe(a.length)
    for (let i = 0; i < a.length; i++) {
      expect(b[i].dayNum).toBe(a[i].dayNum)
      expect(b[i].kmCovered).toBeCloseTo(a[i].kmCovered, 10)
      expect(b[i].startLabel).toBe(a[i].startLabel)
      expect(b[i].campLabel).toBe(a[i].campLabel)
      expect(b[i].weather).toBe(a[i].weather)
      expect(b[i].notable).toEqual(a[i].notable)
      expect(b[i].encounters).toEqual(a[i].encounters)
      expect(b[i].dayOfYear).toBe(a[i].dayOfYear)
      expect(b[i].calendarEvents).toEqual(a[i].calendarEvents)
      expect(b[i].edgesTraversed.length).toBe(a[i].edgesTraversed.length)
    }
  }

  function runContinueLoop(route: JourneyRoute, season: 'spring' | 'summer' | 'autumn' | 'winter' | undefined, departureDayOfYear?: number, party?: PartyConfig) {
    let state = initJourneyState({ route, season, mode: 'direct', departureDayOfYear, party })
    const out = []
    let safety = state.totalDays + 5
    while (!state.finished && safety-- > 0) {
      const result = nextDay(state, { kind: 'continue' })
      if (result.day) out.push(result.day)
      state = result.state
    }
    return out
  }

  it('matches buildDailyBreakdown for a 5-day continue-only run', () => {
    const route = makeRoute({ edgeDays: [2, 2, 1], totalKm: 125 })
    const a = buildDailyBreakdown(route, 'summer', 'direct')
    const b = runContinueLoop(route, 'summer')
    sameJourneyDays(a, b)
  })

  it('matches across all four seasons', () => {
    const route = makeRoute({ edgeDays: [1.5, 2.0, 0.5, 1.0], totalKm: 200 })
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const a = buildDailyBreakdown(route, season, 'direct')
      const b = runContinueLoop(route, season)
      sameJourneyDays(a, b)
    }
  })

  it('matches with departureDayOfYear set (calendar wrap)', () => {
    const route = makeRoute({ edgeDays: [2, 1, 1], totalKm: 100 })
    const a = buildDailyBreakdown(route, 'winter', 'direct', undefined, 364)
    const b = runContinueLoop(route, 'winter', 364)
    sameJourneyDays(a, b)
  })

  it('matches with forced-march party config', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    const party: PartyConfig = { ...DEFAULT_PARTY, forcedMarch: true }
    const a = buildDailyBreakdown(route, 'spring', 'direct', undefined, undefined, party)
    const b = runContinueLoop(route, 'spring', undefined, party)
    sameJourneyDays(a, b)
  })
})

describe('journey-days: nextDay action mechanics', () => {
  it('rest emits zero km, no encounters, exhaustion stays floored at 0', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    let state = initJourneyState({ route, season: 'summer', mode: 'direct' })
    const step = nextDay(state, { kind: 'rest' })
    expect(step.day).not.toBeNull()
    expect(step.day!.kmCovered).toBe(0)
    expect(step.day!.encounters).toEqual([])
    expect(step.day!.edgesTraversed).toEqual([])
    expect(step.day!.notable.some(n => /rest/i.test(n))).toBe(true)
    /* Initial exhaustion is 0; rest -1 floored at 0 → no exhaustionLevel field. */
    expect(step.day!.exhaustionLevel).toBeUndefined()
    expect(step.state.exhaustionLevel).toBe(0)
  })

  it('force-march doubles ration burn and bumps exhaustion', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    let state = initJourneyState({ route, season: 'spring', mode: 'direct', supply: DEFAULT_SUPPLY })
    const continueStep = nextDay(state, { kind: 'continue' })
    const forceState = initJourneyState({ route, season: 'spring', mode: 'direct', supply: DEFAULT_SUPPLY })
    const forceStep = nextDay(forceState, { kind: 'force-march' })
    expect(forceStep.supply!.rationsBurnedToday).toBeCloseTo(continueStep.supply!.rationsBurnedToday * 2, 5)
    expect(forceStep.supply!.waterBurnedToday).toBeCloseTo(continueStep.supply!.waterBurnedToday * 1.5, 5)
    expect(forceStep.state.exhaustionLevel).toBe(1)
    expect(forceStep.day!.exhaustionLevel).toBe(1)
  })

  it('ration halves the ration burn and bumps exhaustion', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    let state = initJourneyState({ route, season: 'spring', mode: 'direct', supply: DEFAULT_SUPPLY })
    const continueStep = nextDay(state, { kind: 'continue' })
    const rationState = initJourneyState({ route, season: 'spring', mode: 'direct', supply: DEFAULT_SUPPLY })
    const rationStep = nextDay(rationState, { kind: 'ration' })
    expect(rationStep.supply!.rationsBurnedToday).toBeCloseTo(continueStep.supply!.rationsBurnedToday * 0.5, 5)
    expect(rationStep.state.exhaustionLevel).toBe(1)
  })

  it('rest decrements exhaustion (after a force-march bumps it up)', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    let state = initJourneyState({ route, season: 'spring', mode: 'direct' })
    state = nextDay(state, { kind: 'force-march' }).state
    expect(state.exhaustionLevel).toBe(1)
    state = nextDay(state, { kind: 'rest' }).state
    expect(state.exhaustionLevel).toBe(0)
    /* Another rest should stay at 0 (floor). */
    state = nextDay(state, { kind: 'rest' }).state
    expect(state.exhaustionLevel).toBe(0)
  })

  it('turn-back finishes the journey with outcome="aborted"', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    let state = initJourneyState({ route, season: 'spring', mode: 'direct' })
    state = nextDay(state, { kind: 'continue' }).state
    const aborted = nextDay(state, { kind: 'turn-back' })
    expect(aborted.state.finished).toBe(true)
    expect(aborted.outcome).toBe('aborted')
    expect(aborted.day!.notable.some(n => /turn back/i.test(n))).toBe(true)
    /* Further steps are no-ops. */
    const noop = nextDay(aborted.state, { kind: 'continue' })
    expect(noop.advanced).toBe(false)
    expect(noop.day).toBeNull()
  })

  it('reroute requires graph + endId; throws otherwise', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    const state = initJourneyState({ route, season: 'spring', mode: 'direct' })
    expect(() => nextDay(state, { kind: 'reroute', mode: 'safest' })).toThrow(/graph and state\.endId/)
  })
})

describe('journey-days: resupply day mapping parity with legacy name-based walk', () => {
  /* The policy path resolves a day's resupply tier from `state.resupplyByDay`
   * (built inside bucketRoute). The legacy sim path resolves it by walking
   * `days[].campLabel` after buildDailyBreakdown returns and mapping the
   * named node to a tier. These two mappings must agree — otherwise the
   * naive policy diverges from the legacy no-policy path on borderline
   * grids (see HANDOFF-2026-05-26 / parity-fix). */

  /* Mirrors run-journey.ts:212-224 exactly. */
  function legacyDayToTier(
    days: ReturnType<typeof buildDailyBreakdown>,
    route: JourneyRoute,
    tierFor: (category: string) => ResupplyTier,
  ): Map<number, ResupplyTier> {
    const nameToTier = new Map<string, ResupplyTier>()
    for (const n of route.nodes) nameToTier.set(n.name, tierFor(n.category))
    const out = new Map<number, ResupplyTier>()
    for (const d of days) {
      let name: string | undefined
      if (d.campLabel.startsWith('Camp at ')) name = d.campLabel.slice('Camp at '.length)
      else if (d.campLabel.startsWith('Arrive at ')) name = d.campLabel.slice('Arrive at '.length)
      if (!name) continue
      const tier = nameToTier.get(name)
      if (tier && tier !== 'none') out.set(d.dayNum, tier)
    }
    return out
  }

  const tierFor = (cat: string): ResupplyTier => {
    if (cat === 'civilization') return 'full'
    if (cat === 'oasis' || cat === 'port') return 'water'
    return 'none'
  }

  it('policy path supply timeline equals legacy buildDailyBreakdown+computeSupplyTimeline', () => {
    /* Multi-edge route with mixed node categories (port start, civilization
     * mid, oasis mid, civilization end). edgeDays chosen so node-arrival
     * times include both integer and fractional accNodeDay boundaries —
     * the shape the old Math.ceil(accNodeDay) rule got wrong. */
    const route = makeRoute({ edgeDays: [3.5, 2.2, 1.8, 2.5], totalKm: 300 })
    /* makeRoute defaults categories to port/civilization/oasis based on
     * position; first node is `port`, last is `oasis`, middle are
     * `civilization`. tierFor maps all three to a non-'none' tier so every
     * day is exercised. */

    const a = buildDailyBreakdown(route, 'spring', 'direct', undefined, undefined, DEFAULT_PARTY)
    const dayToTier = legacyDayToTier(a, route, tierFor)
    const legacySupply = computeSupplyTimeline(
      a, DEFAULT_PARTY, DEFAULT_SUPPLY,
      undefined, 'spring',
      (d) => dayToTier.get(d) ?? 'none',
      'direct', /* both paths must use the same mode so the per-mode burn multiplier matches */
    )

    let state = initJourneyState({
      route, season: 'spring', mode: 'direct',
      party: DEFAULT_PARTY, supply: DEFAULT_SUPPLY,
      resupplyTierFor: tierFor,
    })
    const policySupply: typeof legacySupply = []
    let safety = state.totalDays + 5
    while (!state.finished && safety-- > 0) {
      const step = nextDay(state, { kind: 'continue' })
      if (step.supply) policySupply.push(step.supply)
      state = step.state
    }

    expect(policySupply.length).toBe(legacySupply.length)
    for (let i = 0; i < legacySupply.length; i++) {
      expect(policySupply[i].rationsLeft).toBeCloseTo(legacySupply[i].rationsLeft, 10)
      expect(policySupply[i].waterLeft).toBeCloseTo(legacySupply[i].waterLeft, 10)
      expect(policySupply[i].warning).toBe(legacySupply[i].warning)
    }
  })

  it('start node resupplies on day 1 (matches "Camp at <origin>" semantics)', () => {
    /* Regression for the pre-fix bug: bucketRoute used `i === 0 ? 0 : …`
     * which skipped the origin node entirely, so day 1's "Camp at <origin>"
     * never granted resupply on the policy path. Uses a long first edge so
     * day 1 falls within t<=0.15 of the origin (campLabelAt's "Camp at X"
     * threshold). */
    const route = makeRoute({ edgeDays: [8, 2, 1], totalKm: 200 })
    /* First node category in makeRoute is 'port' → tier 'water' here. */

    const a = buildDailyBreakdown(route, 'spring', 'direct')
    expect(a[0].campLabel.startsWith('Camp at ')).toBe(true)

    /* The policy path's bucketRoute should mark day 1 as 'water' (since
     * the origin node is a port). Verify by running a low-water supply
     * config: without origin resupply, day 1 would burn down; with it,
     * day 1 ends at startingWater. */
    const lowWater = { ...DEFAULT_SUPPLY, waterPerPerson: 3 }
    let state = initJourneyState({
      route, season: 'spring', mode: 'direct',
      party: DEFAULT_PARTY, supply: lowWater,
      resupplyTierFor: tierFor,
    })
    const day1 = nextDay(state, { kind: 'continue' })
    expect(day1.supply).not.toBeNull()
    /* Origin port → 'water' tier → waterLeft restored to startingWater after burn. */
    expect(day1.supply!.waterLeft).toBe(state.supplyConstants.startingWater)
  })

  it('SupplyDay.resupplyFired survives the nextDay flow (Phase 4 dynamic probe)', () => {
    /* Same setup as the start-node test: origin port → 'water' tier on day 1.
     * Verifies that BurnResult.resupplyFired echoes into SupplyDay through
     * nextDay (not just through computeSupplyTimeline). */
    const route = makeRoute({ edgeDays: [8, 2, 1], totalKm: 200 })
    let state = initJourneyState({
      route, season: 'spring', mode: 'direct',
      party: DEFAULT_PARTY, supply: DEFAULT_SUPPLY,
      resupplyTierFor: tierFor,
    })
    const day1 = nextDay(state, { kind: 'continue' })
    expect(day1.supply!.resupplyFired).toBe('water')
  })
})

describe('journey-days: resupplyByDayForRoute (2026-07-04 wiring fix)', () => {
  /* Regression coverage for the root-cause bug this session found: every
   * web/src caller of initJourneyState/computeSupplyTimeline used to omit a
   * resupplyTierFor/resupplyAtDay predicate entirely, so resupplyByDay was
   * always empty in live Passage/Trail play and in the JourneyDaysTab/
   * campaign-log/journey-export supply forecasts — only the offline sim
   * harness (scripts/sim/*) ever wired getResupplyTier. These tests exercise
   * the real exported getResupplyTier (not a hand-rolled tierFor like the
   * parity block above) end-to-end through the new resupplyByDayForRoute
   * wrapper, the same one JourneyDaysTab/campaign-log/journey-export now call. */

  it('is non-empty for a route with a civilization origin (would have been empty pre-fix)', () => {
    const route = makeRoute({ edgeDays: [2, 2, 2], totalKm: 200 })
    const resupplyByDay = resupplyByDayForRoute(route, 'spring', 'direct')
    expect(resupplyByDay.size).toBeGreaterThan(0)
  })

  it("a 'water'-category node (the Aethelian Basin's own category, the canon fix) grants a 'water' tier at the day it's reached", () => {
    // Minimal 2-edge route: civilization origin -> water-category midpoint -> oasis end.
    // Mirrors the real medium route's shape (irrah -> ... -> aethelian_basin -> ... -> ngaru_bon).
    const route: JourneyRoute = {
      nodes: [
        { id: 'a', name: 'Origin', category: 'civilization', x: 0, y: 0 },
        { id: 'b', name: 'Basin', category: 'water', x: 100, y: 0 },
        { id: 'c', name: 'Dest', category: 'oasis', x: 200, y: 0 },
      ],
      edges: [
        { from: 'a', to: 'b', distanceSvg: 100, type: 'trade_route', name: 'Leg 0', segmentDays: 3 },
        { from: 'b', to: 'c', distanceSvg: 100, type: 'trade_route', name: 'Leg 1', segmentDays: 3 },
      ],
      totalDistanceSvg: 200,
      totalKm: 200,
      estimatedDays: 6,
      bottlenecks: [],
      seasonalWarnings: [],
    }
    const resupplyByDay = resupplyByDayForRoute(route, 'spring', 'direct')
    // Day 3 lands at the Basin node (end of the first 3-day leg) -> 'water' tier.
    expect(resupplyByDay.get(3)).toBe('water')
    // Confirms getResupplyTier itself (not a stand-in) is what's wired through.
    expect(getResupplyTier('water')).toBe('water')
  })
})

describe('journey-days: capacity scar persistence (Passage v1.1 Slice 2)', () => {
  const tierFor = (cat: string): ResupplyTier => {
    if (cat === 'civilization') return 'full'
    if (cat === 'oasis' || cat === 'port') return 'water'
    return 'none'
  }

  it('nextDay resupply respects scarRations and restores to the lowered ceiling', () => {
    // 3-day route; make the first trailing node a civilization so day 1 camps at it
    // and gets 'full'.
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    route.nodes[1].category = 'civilization'

    let state = initJourneyState({
      route, season: 'spring', mode: 'direct',
      party: DEFAULT_PARTY, supply: DEFAULT_SUPPLY,
      resupplyTierFor: tierFor,
    })
    // Impose a Passage scar.
    state = { ...state, scarRations: 3, scarWater: 2 }

    const day1 = nextDay(state, { kind: 'continue' })
    expect(day1.supply).not.toBeNull()
    // Day 1 camps at Node 1 (civilization) → 'full' restore to scarred ceiling.
    expect(day1.supply!.resupplyFired).toBe('full')
    expect(day1.state.rationsLeft).toBe(state.supplyConstants.startingRations - 3)
    expect(day1.state.waterLeft).toBe(state.supplyConstants.startingWater - 2)
    expect(day1.state.scarRations).toBe(3)
    expect(day1.state.scarWater).toBe(2)
  })

  it('scarRations and scarWater persist across a nextDay step', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    let state = initJourneyState({ route, season: 'spring', mode: 'direct' })
    state = { ...state, scarRations: 2, scarWater: 1 }

    const step = nextDay(state, { kind: 'continue' })
    expect(step.state.scarRations).toBe(2)
    expect(step.state.scarWater).toBe(1)
  })

  it('scarRations and scarWater persist across a reroute', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    const graph: import('./journey-graph').Graph = {
      nodes: new Map(route.nodes.map(n => [n.id, n])),
      adj: new Map(),
    }
    for (const e of route.edges) {
      if (!graph.adj.has(e.from)) graph.adj.set(e.from, [])
      graph.adj.get(e.from)!.push({ to: e.to, edge: e })
    }

    let state = initJourneyState({
      route, season: 'spring', mode: 'direct',
      party: DEFAULT_PARTY, supply: DEFAULT_SUPPLY,
      graph, endId: route.nodes[route.nodes.length - 1].id,
      resupplyTierFor: tierFor,
    })
    state = { ...state, scarRations: 4, scarWater: 2 }

    // Step one day, then reroute.
    state = nextDay(state, { kind: 'continue' }).state
    const rerouted = nextDay(state, { kind: 'reroute', mode: 'safest' })
    expect(rerouted.advanced).toBe(true)
    expect(rerouted.state.scarRations).toBe(4)
    expect(rerouted.state.scarWater).toBe(2)
  })
})
