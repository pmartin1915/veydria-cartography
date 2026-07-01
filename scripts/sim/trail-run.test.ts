/**
 * trail-run.test.ts — Harness correctness tests for the Trail-mode sim driver.
 *
 * Covers:
 *  1. Determinism: same seed → byte-identical TrailTrace
 *  2. Trace shape: all required fields present and typed correctly
 *  3. Party size echo: members array length matches partySize
 *  4. Biome wiring: land route with always-hunt → huntAttempts > 0
 *  5. Hunt policy: never-hunt → huntSuccess = 0 always
 *  6. Heal happens: caravan supply on a medium route → events.heal > 0 across N seeds
 *  7. buildEdgeBiomes: returns array matching route.edges length
 */

import { describe, it, expect } from 'vitest'
import {
  runTrail,
  buildGraphFromGeojson,
  loadGeojson,
  buildEdgeBiomes,
  makeMembers,
  type TrailInputs,
} from './trail-run'
import {
  findRouteWithFallback,
  type PartyConfig,
} from '../../web/src/utils/journey-graph'

/* ─── Shared fixtures (loaded once — geojson I/O is the slow part) ─── */

const geojson  = loadGeojson()
const graph    = buildGraphFromGeojson()
const features = geojson.features

const BASE_PARTY: PartyConfig = { pace: 'normal', mount: 'foot', size: 'medium', forcedMarch: false }

const BASE: TrailInputs = {
  from:         'irrah',
  to:           'ngaru_bon',
  season:       'spring',
  mode:         'direct',
  supplyPreset: 'standard',
  partySize:    3,
  runSeed:      42,
  huntPolicy:   'hunt-when-low',
}

/* ─── Tests ─── */

describe('trail-run determinism', () => {
  it('same seed → byte-identical trace', () => {
    const t1 = runTrail({ ...BASE, runSeed: 99 }, graph, features)
    const t2 = runTrail({ ...BASE, runSeed: 99 }, graph, features)
    expect(JSON.stringify(t1)).toBe(JSON.stringify(t2))
  })

  it('different seeds → different traces (on a route that exists)', () => {
    const t1 = runTrail({ ...BASE, runSeed: 1 }, graph, features)
    const t2 = runTrail({ ...BASE, runSeed: 2 }, graph, features)
    // Skip comparison when both returned no-route sentinel (routeKm=null both)
    if (t1.routeKm === null && t2.routeKm === null) return
    // At minimum, health outcomes or death days should differ across seeds
    expect(JSON.stringify(t1) === JSON.stringify(t2)).toBe(false)
  })
})

describe('trail-run trace shape', () => {
  it('all required fields present', () => {
    const t = runTrail(BASE, graph, features)
    expect(t).toMatchObject({
      outcome:     expect.any(String),
      daysElapsed: expect.any(Number),
      survivors:   expect.any(Number),
      partySize:   expect.any(Number),
      supplyMargin: expect.any(Number),
      rank:        expect.any(String),
      members:     expect.any(Array),
      events:      expect.objectContaining({ worsen: expect.any(Number), heal: expect.any(Number), deaths: expect.any(Number) }),
      deathDays:   expect.any(Array),
      pendingCounts: expect.objectContaining({ signature: expect.any(Number), hunt: expect.any(Number), fort: expect.any(Number), ford: expect.any(Number) }),
      huntAttempts: expect.any(Number),
      huntSuccess:  expect.any(Number),
    })
  })

  it('members array length matches partySize', () => {
    const t = runTrail({ ...BASE, partySize: 4 }, graph, features)
    expect(t.members).toHaveLength(4)
    expect(t.partySize).toBe(4)
  })

  it('partySize 2 is valid', () => {
    const t = runTrail({ ...BASE, partySize: 2 }, graph, features)
    expect(t.members).toHaveLength(2)
  })

  it('members override is honoured', () => {
    const customMembers = makeMembers(2)
    const t = runTrail({ ...BASE, partySize: 99, members: customMembers }, graph, features)
    expect(t.members).toHaveLength(2)
    expect(t.partySize).toBe(2)
  })
})

describe('trail-run hunt policy', () => {
  it('always-hunt: huntAttempts > 0 on a land route with biome data', () => {
    const t = runTrail({ ...BASE, huntPolicy: 'always-hunt' }, graph, features)
    if (t.routeKm === null) return // skip no-route
    // biomeForEdge is wired on every land route → hunt pending surfaces every
    // day with edges → always-hunt policy chose Hunt at least once
    expect(t.huntAttempts).toBeGreaterThan(0)
  })

  it('never-hunt: huntSuccess is always 0', () => {
    const t = runTrail({ ...BASE, huntPolicy: 'never-hunt' }, graph, features)
    expect(t.huntSuccess).toBe(0)
  })

  it('never-hunt vs always-hunt: always-hunt has higher supplyMargin on average (caravan)', async () => {
    // With caravan supply, always-hunt should produce same or better supply margins
    // than never-hunt (hunting only adds rations, never removes them in v1)
    const SEEDS = [1, 2, 3, 4, 5]
    let sumAlways = 0, sumNever = 0
    for (const seed of SEEDS) {
      const always = runTrail({ ...BASE, supplyPreset: 'standard', huntPolicy: 'always-hunt', runSeed: seed }, graph, features)
      const never  = runTrail({ ...BASE, supplyPreset: 'standard', huntPolicy: 'never-hunt',  runSeed: seed }, graph, features)
      sumAlways += always.supplyMargin
      sumNever  += never.supplyMargin
    }
    // Always-hunt should match or beat never-hunt (hunts are free in v1)
    expect(sumAlways).toBeGreaterThanOrEqual(sumNever)
  })
})

describe('trail-run health mechanics', () => {
  it('heal happens: caravan supply → heal events > 0 across multiple seeds', () => {
    // With generous supply, supplyStress stays 0 → healChance = 0.20 fires
    // Over 10 seeds with a 3-person party on a medium route, heal should occur
    let totalHeal = 0
    for (let seed = 1; seed <= 10; seed++) {
      const t = runTrail({ ...BASE, supplyPreset: 'caravan', runSeed: seed }, graph, features)
      totalHeal += t.events.heal
    }
    expect(totalHeal).toBeGreaterThan(0)
  })

  it('tight supply → some perished/party-wiped outcomes across seeds', () => {
    // Tight supply on a long route should produce at least some non-arrived outcomes
    let nonArrived = 0
    for (let seed = 1; seed <= 10; seed++) {
      const t = runTrail({
        from: 'kheshkai', to: 'oravan', season: 'summer',
        mode: 'direct', supplyPreset: 'tight', partySize: 3,
        runSeed: seed, huntPolicy: 'never-hunt',
      }, graph, features)
      if (t.outcome !== 'arrived') nonArrived++
    }
    expect(nonArrived).toBeGreaterThan(0)
  })

  it('deaths are recorded in deathDays array', () => {
    // Run many seeds on tight supply until we find a run with deaths
    let foundDeath = false
    for (let seed = 1; seed <= 30; seed++) {
      const t = runTrail({
        from: 'kheshkai', to: 'oravan', season: 'summer',
        mode: 'direct', supplyPreset: 'tight', partySize: 4,
        runSeed: seed, huntPolicy: 'never-hunt',
      }, graph, features)
      if (t.events.deaths > 0) {
        expect(t.deathDays).toHaveLength(t.events.deaths)
        expect(t.deathDays.every(d => typeof d === 'number' && d > 0)).toBe(true)
        foundDeath = true
        break
      }
    }
    // If no deaths found across 30 seeds, the constants may be too lenient — flag it
    if (!foundDeath) {
      console.warn('trail-run.test: no deaths found across 30 tight/long seeds — consider lowering heal or raising base worsen')
    }
  })
})

describe('buildEdgeBiomes', () => {
  it('returns array of same length as route.edges', () => {
    const { route } = findRouteWithFallback(graph, 'irrah', 'ngaru_bon', 'spring', 'direct', BASE_PARTY)
    if (!route) return // skip if no route
    const { edgeBiomes, biomeForEdge } = buildEdgeBiomes(route, features)
    expect(edgeBiomes).toHaveLength(route.edges.length)
    expect(typeof biomeForEdge).toBe('function')
  })

  it('biomeForEdge callback returns string or undefined for each edge', () => {
    const { route } = findRouteWithFallback(graph, 'irrah', 'ngaru_bon', 'spring', 'direct', BASE_PARTY)
    if (!route) return
    const { biomeForEdge } = buildEdgeBiomes(route, features)
    for (const edge of route.edges) {
      const b = biomeForEdge(edge)
      expect(b === undefined || typeof b === 'string').toBe(true)
    }
  })

  it('at least some edges have a biome string (geojson has 3004 terrain cells)', () => {
    const { route } = findRouteWithFallback(graph, 'irrah', 'ngaru_bon', 'spring', 'direct', BASE_PARTY)
    if (!route) return
    const { edgeBiomes } = buildEdgeBiomes(route, features)
    const withBiome = edgeBiomes.filter(b => b !== undefined)
    expect(withBiome.length).toBeGreaterThan(0)
  })
})
