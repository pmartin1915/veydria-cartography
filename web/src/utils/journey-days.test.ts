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
})
