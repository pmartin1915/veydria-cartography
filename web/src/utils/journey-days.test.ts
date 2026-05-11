import { describe, it, expect } from 'vitest'
import { buildDailyBreakdown } from './journey-days'
import type { JourneyRoute } from './journey-graph'

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
})
