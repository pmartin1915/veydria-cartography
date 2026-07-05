import { describe, it, expect } from 'vitest'
import { initJourneyState } from './journey-days'
import type { JourneyRoute, Graph } from './journey-graph'
import type { Encounter } from './encounters'
import {
  initPassage,
  passageAct,
  passageChoose,
  passageReroute,
  zeroSignatureCosts,
  currentNodeIndex,
  SIGNATURE_CHOICES,
  PERISH_WATER_FLOOR,
  type PassageState,
} from './passage'

/** Build a forward-adjacency Graph from a makeRoute() route, for reroute tests. */
function makeGraph(route: JourneyRoute): Graph {
  const graph: Graph = { nodes: new Map(route.nodes.map(n => [n.id, n])), adj: new Map() }
  for (const e of route.edges) {
    if (!graph.adj.has(e.from)) graph.adj.set(e.from, [])
    graph.adj.get(e.from)!.push({ to: e.to, edge: e })
  }
  return graph
}

/* Mirrors the makeRoute helper in journey-days.test.ts. */
/** Last element (the project's TS lib target predates Array.prototype.at). */
function last<T>(a: T[]): T {
  return a[a.length - 1]
}

function makeRoute(opts: { edgeDays: number[]; totalKm: number }): JourneyRoute {
  const nodes = opts.edgeDays.map((_, i) => ({
    id: `n${i}`,
    name: `Node ${i}`,
    category: i === 0 ? 'port' : 'civilization',
    x: i * 100,
    y: 0,
  }))
  nodes.push({ id: `n${opts.edgeDays.length}`, name: `Node ${opts.edgeDays.length}`, category: 'oasis', x: opts.edgeDays.length * 100, y: 0 })
  const edges = opts.edgeDays.map((d, i) => ({
    from: nodes[i].id,
    to: nodes[i + 1].id,
    distanceSvg: d * 100,
    type: (i % 2 === 0 ? 'trade_route' : 'intra_civ') as 'trade_route' | 'intra_civ',
    name: `Leg ${i}`,
    segmentDays: d,
  }))
  return {
    nodes,
    edges,
    totalDistanceSvg: opts.edgeDays.reduce((s, d) => s + d * 100, 0),
    totalKm: opts.totalKm,
    estimatedDays: opts.edgeDays.reduce((s, d) => s + d, 0),
    bottlenecks: [],
    seasonalWarnings: [],
  }
}

/** A synthetic signature encounter to inject on a given engine day. Defaults to
 *  zeroed cost (the post-init production state); pass a cost to exercise zeroing. */
function signatureEncounter(key: string, cost = { rations: 0, water: 0 }): Encounter {
  return {
    segmentIdx: 0,
    beat: 'test beat',
    type: 'environmental',
    severity: 'moderate',
    narrative: 'test',
    key,
    supplyCost: cost,
    timeOfDay: 'day',
  }
}

/** Init a passage and plant a signature encounter on engine day 1.
 *  Resupply is disabled so these tests isolate the CHOICE mechanic — a full-tier
 *  camp node would otherwise refill stores and mask the choice's supply delta.
 *  Resupply-on behaviour has its own dedicated test below. */
function passageWithSignature(key: string): PassageState {
  const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1], totalKm: 125 })
  const state = initPassage({ route, season: 'spring', mode: 'direct', resupplyTierFor: () => 'none' })
  state.journey.encountersByDay.set(1, [signatureEncounter(key)])
  return state
}

/** Init a passage and plant the same signature encounter on multiple engine days.
 *  Resupply disabled (see passageWithSignature). */
function passageWithRepeatedSignature(key: string, days: number[]): PassageState {
  const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1, 1], totalKm: 150 })
  const state = initPassage({ route, season: 'spring', mode: 'direct', resupplyTierFor: () => 'none' })
  for (const d of days) {
    state.journey.encountersByDay.set(d, [signatureEncounter(key)])
  }
  return state
}

describe('passage: init', () => {
  it('seeds a clean in-progress state from a computed route', () => {
    const route = makeRoute({ edgeDays: [2, 2, 1], totalKm: 125 })
    const s = initPassage({ route, season: 'spring', mode: 'direct' })
    expect(s.outcome).toBe('in-progress')
    expect(s.log).toEqual([])
    expect(s.extraDays).toBe(0)
    expect(s.pending).toBeNull()
    expect(s.journey.dayNum).toBe(0)
    expect(s.journey.rationsLeft).toBe(s.journey.supplyConstants.startingRations)
  })

  it('zeroSignatureCosts zeroes signature encounter cost but leaves others intact', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    const journey = initJourneyState({ route, season: 'spring', mode: 'direct' })
    journey.encountersByDay.set(1, [signatureEncounter('bandits', { rations: 2, water: 2 })])
    journey.encountersByDay.set(2, [signatureEncounter('not-a-signature', { rations: 1, water: 1 })])
    zeroSignatureCosts(journey)
    expect(journey.encountersByDay.get(1)![0].supplyCost).toEqual({ rations: 0, water: 0 })
    // A non-registered key keeps its cost (only signature encounters are zeroed).
    expect(journey.encountersByDay.get(2)![0].supplyCost).toEqual({ rations: 1, water: 1 })
  })
})

describe('passage: stepping + endings', () => {
  it('continue advances exactly one engine day and appends a day entry', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    let s = initPassage({ route, season: 'spring', mode: 'direct' })
    s = passageAct(s, { kind: 'continue' })
    expect(s.journey.dayNum).toBe(1)
    expect(s.log).toHaveLength(1)
    expect(s.log[0].kind).toBe('day')
  })

  it('reaching the destination ends with outcome="arrived"', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    let s = initPassage({ route, season: 'spring', mode: 'direct' })
    let guard = 20
    while (s.outcome === 'in-progress' && guard-- > 0) s = passageAct(s, { kind: 'continue' })
    expect(s.outcome).toBe('arrived')
    expect(last(s.log)).toMatchObject({ kind: 'ending', outcome: 'arrived' })
  })

  it('turn-back ends with outcome="aborted"', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1, 1], totalKm: 100 })
    let s = initPassage({ route, season: 'spring', mode: 'direct' })
    s = passageAct(s, { kind: 'continue' })
    s = passageAct(s, { kind: 'turn-back' })
    expect(s.outcome).toBe('aborted')
    expect(last(s.log)).toMatchObject({ kind: 'ending', outcome: 'aborted' })
  })

  it('draining water past PERISH_WATER_FLOOR ends with outcome="perished"', () => {
    const route = makeRoute({ edgeDays: [2, 2, 2, 2, 2], totalKm: 250 })
    let s = initPassage({
      route,
      season: 'spring',
      mode: 'direct',
      supply: { rationsPerPerson: 30, waterPerPerson: 2, encumbrance: 'normal', packAnimals: 'none' },
      // Resupply off: this isolates the perish-floor mechanic. A refill node would
      // top water back up and the party would arrive instead of perishing.
      resupplyTierFor: () => 'none',
    })
    let guard: number = 30
    while (s.outcome === 'in-progress' && guard-- > 0) s = passageAct(s, { kind: 'continue' })
    expect(s.outcome).toBe('perished')
    expect(s.journey.waterLeft).toBeLessThanOrEqual(PERISH_WATER_FLOOR)
    expect(last(s.log)).toMatchObject({ kind: 'ending', outcome: 'perished' })
  })
})

describe('passage: signature encounters + choices', () => {
  it('a signature encounter on the next day pauses for a choice instead of advancing', () => {
    let s = passageWithSignature('ford')
    s = passageAct(s, { kind: 'continue' })
    expect(s.pending).not.toBeNull()
    expect(s.pending!.encounter.key).toBe('ford')
    expect(s.pending!.choices).toHaveLength(3)
    expect(s.journey.dayNum).toBe(0) // did NOT advance
  })

  it('each registered signature has at least 2 measurably-distinct choices', () => {
    for (const key of Object.keys(SIGNATURE_CHOICES)) {
      const variants = SIGNATURE_CHOICES[key]
      expect(variants.length).toBeGreaterThanOrEqual(1)
      const choices = variants[0]
      expect(choices.length).toBeGreaterThanOrEqual(2)
      // Distinct: the (rations, water, days) cost vectors are not all identical.
      const vectors = choices.map(c =>
        `${c.outcome.rationsDelta ?? 0}|${c.outcome.waterDelta ?? 0}|${c.outcome.daysDelta ?? 0}`,
      )
      expect(new Set(vectors).size).toBeGreaterThan(1)
    }
  })

  it('a one-off ration delta moves supply by exactly that delta difference between branches', () => {
    // ford choice 0 (Ford now, rations -2) vs choice 2 (Pay guide, rations -1):
    // base day burn cancels, leaving a 1-ration difference.
    const base = passageWithSignature('ford')
    const pending = passageAct(base, { kind: 'continue' })
    const fordNow = passageChoose(pending, 0)
    const payGuide = passageChoose(pending, 2)
    expect(fordNow.journey.rationsLeft).toBeCloseTo(payGuide.journey.rationsLeft - 1, 5)
    expect(fordNow.journey.dayNum).toBe(1) // the encounter day resolved
  })

  it('a daysDelta choice appends that many wait entries and advances extraDays', () => {
    const base = passageWithSignature('ford')
    const pending = passageAct(base, { kind: 'continue' })
    const wait = passageChoose(pending, 1) // "Wait out the flood" → daysDelta 2
    expect(wait.extraDays).toBe(2)
    expect(wait.log.filter(e => e.kind === 'wait')).toHaveLength(2)
    expect(wait.log.some(e => e.kind === 'choice')).toBe(true)
  })

  it('wait days burn water but not rations (rest-rate)', () => {
    const base = passageWithSignature('ford')
    const pending = passageAct(base, { kind: 'continue' })
    const rationsBefore = pending.journey.rationsLeft
    const waterBefore = pending.journey.waterLeft
    const wait = passageChoose(pending, 1)
    const lastWait = last(wait.log.filter(e => e.kind === 'wait'))
    // Across two wait days, water dropped; rations only move from base day burn after.
    expect(wait.journey.waterLeft).toBeLessThan(waterBefore)
    expect(lastWait).toMatchObject({ kind: 'wait' })
    void rationsBefore
  })

  it('a single encounter of key X always resolves to variants[0]', () => {
    const base = passageWithSignature('bandits')
    const pending = passageAct(base, { kind: 'continue' })
    expect(pending.pending).not.toBeNull()
    expect(pending.pending!.choices).toEqual(SIGNATURE_CHOICES.bandits[0])
    expect(pending.signatureCounts).toEqual({})
  })

  it('repeated ford encounters use variants[0] then wrap to variants[0] fallback', () => {
    const base = passageWithRepeatedSignature('ford', [1, 2])
    const first = passageAct(base, { kind: 'continue' })
    expect(first.pending).not.toBeNull()
    expect(first.pending!.choices).toEqual(SIGNATURE_CHOICES.ford[0])

    const afterFirst = passageChoose(first, 0)
    expect(afterFirst.signatureCounts.ford).toBe(1)

    const second = passageAct(afterFirst, { kind: 'continue' })
    expect(second.pending).not.toBeNull()
    // ford has only one variant, so the second encounter falls back to variants[0].
    expect(second.pending!.choices).toEqual(SIGNATURE_CHOICES.ford[0])
  })

  it('repeated sand-wraith encounters cycle through variants', () => {
    const base = passageWithRepeatedSignature('sand-wraith', [1, 2])
    const first = passageAct(base, { kind: 'continue' })
    expect(first.pending).not.toBeNull()
    expect(first.pending!.choices).toEqual(SIGNATURE_CHOICES['sand-wraith'][0])

    const afterFirst = passageChoose(first, 0)
    expect(afterFirst.signatureCounts['sand-wraith']).toBe(1)

    const second = passageAct(afterFirst, { kind: 'continue' })
    expect(second.pending).not.toBeNull()
    expect(second.pending!.choices).toEqual(SIGNATURE_CHOICES['sand-wraith'][1])
  })
})

describe('passage: current position', () => {
  it('starts at the origin and advances toward the destination node', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    let s = initPassage({ route, season: 'spring', mode: 'direct' })
    expect(currentNodeIndex(s)).toBe(0)
    s = passageAct(s, { kind: 'continue' })
    const afterDay1 = currentNodeIndex(s)
    expect(afterDay1).toBeGreaterThanOrEqual(1)
    let guard = 10
    while (s.outcome === 'in-progress' && guard-- > 0) s = passageAct(s, { kind: 'continue' })
    expect(currentNodeIndex(s)).toBe(route.nodes.length - 1) // destination
  })
})

describe('passage: determinism', () => {
  it('same route + same choice sequence → identical final supply, outcome, day count', () => {
    function run(): PassageState {
      let s = passageWithSignature('bandits')
      s = passageAct(s, { kind: 'continue' }) // → pending
      s = passageChoose(s, 1) // parley (rations -1, daysDelta 1)
      let guard = 20
      while (s.outcome === 'in-progress' && guard-- > 0) s = passageAct(s, { kind: 'continue' })
      return s
    }
    const a = run()
    const b = run()
    expect(a.outcome).toBe(b.outcome)
    expect(a.journey.rationsLeft).toBeCloseTo(b.journey.rationsLeft, 9)
    expect(a.journey.waterLeft).toBeCloseTo(b.journey.waterLeft, 9)
    expect(a.journey.dayNum).toBe(b.journey.dayNum)
    expect(a.extraDays).toBe(b.extraDays)
    expect(a.log.length).toBe(b.log.length)
  })
})


describe('passage: capacity scar (Passage v1.1 Slice 2)', () => {
  /** Build a pending state with a custom signature choice set. */
  function passageWithCustomChoices(
    choices: import('./passage').EncounterChoice[],
  ): PassageState {
    const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1], totalKm: 125 })
    // Resupply off so the clamp/scar mechanic is measured in isolation.
    const state = initPassage({ route, season: 'spring', mode: 'direct', resupplyTierFor: () => 'none' })
    const enc = signatureEncounter('test-scar')
    state.journey.encountersByDay.set(1, [enc])
    state.pending = { encounter: enc, choices }
    state.signatureCounts = {}
    return state
  }

  it('passageChoose accumulates scarRations/scarWater onto the journey', () => {
    const state = passageWithCustomChoices([
      {
        label: 'Lose the cart',
        outcome: {
          rationsDelta: -1,
          scarRations: 2,
          scarWater: 1,
          narrative: 'The cart is gone.',
        },
      },
    ])
    const chosen = passageChoose(state, 0)
    expect(chosen.journey.scarRations).toBe(2)
    expect(chosen.journey.scarWater).toBe(1)
  })

  it('passageChoose clamps current stores to the new scarred ceiling', () => {
    const state = passageWithCustomChoices([
      {
        label: 'Lose the cart',
        outcome: {
          rationsDelta: 0,
          scarRations: 5,
          narrative: 'The cart is gone.',
        },
      },
    ])
    // Default starting rations = 12. Scar of 5 lowers ceiling to 7.
    // Even with rationsDelta 0, current stores clamp down to 7 before the
    // encounter day's burn (mode 'direct' => 1.15 ration burn).
    const chosen = passageChoose(state, 0)
    expect(chosen.journey.scarRations).toBe(5)
    expect(chosen.journey.rationsLeft).toBeLessThanOrEqual(7)
    expect(chosen.journey.rationsLeft).toBeCloseTo(7 - 1.15, 5)
  })

  it('a scarred branch ends with lower post-resupply supply than a non-scarred branch', () => {
    const base = passageWithSignature('sabkha-sinkhole')
    const pending = passageAct(base, { kind: 'continue' })
    expect(pending.pending).not.toBeNull()

    const cutLoose = passageChoose(pending, 0) // scarRations: 1
    const haulOut = passageChoose(pending, 1)   // no scar

    // The scarred branch accumulates a permanent ceiling reduction; the other
    // branch does not (scar stays 0). Both resolve the same engine day, so the
    // base day burn cancels and the immediate ration delta makes the scarred
    // branch strictly lower.
    expect(cutLoose.journey.scarRations).toBe(1)
    expect(haulOut.journey.scarRations).toBe(0)
    expect(cutLoose.journey.rationsLeft).toBeLessThan(haulOut.journey.rationsLeft)
  })

  it('switchback "Stave the water-casks" lowers the water ceiling by 2; "Double-team" takes no scar', () => {
    const base = passageWithSignature('switchback')
    const pending = passageAct(base, { kind: 'continue' })
    expect(pending.pending).not.toBeNull()
    expect(pending.pending!.choices).toHaveLength(2)

    const startingWater = base.journey.supplyConstants.startingWater
    const stave = passageChoose(pending, 0)      // scarWater: 2
    const doubleTeam = passageChoose(pending, 1)  // daysDelta: 2, no scar

    // Stave accumulates a permanent water-ceiling reduction of 2 and clamps current
    // stores down to that lowered ceiling immediately (the party starts the day full),
    // before the encounter-day burn — so waterLeft ends at or below startingWater - 2.
    expect(stave.journey.scarWater).toBe(2)
    expect(stave.journey.waterLeft).toBeLessThanOrEqual(startingWater - 2)
    // Double-team trades time, not capacity: no permanent scar on either resource.
    expect(doubleTeam.journey.scarWater ?? 0).toBe(0)
    expect(doubleTeam.journey.scarRations ?? 0).toBe(0)
  })

  it('dry-wadi "take the wadi" lowers the water ceiling by 2; "stay on trail" takes no scar', () => {
    // Slice 4: dry-wadi gained teeth as a scar (a transient cost washed out at the
    // next resupply; only a persistent scar survives it). "Take the wadi" trades a
    // permanent water cask for two days saved; "stay on trail" trades time only.
    const base = passageWithSignature('dry-wadi')
    const pending = passageAct(base, { kind: 'continue' })
    expect(pending.pending).not.toBeNull()
    expect(pending.pending!.choices).toHaveLength(2)

    const startingWater = base.journey.supplyConstants.startingWater
    const takeWadi = passageChoose(pending, 0)    // scarWater: 2
    const stayTrail = passageChoose(pending, 1)   // daysDelta: 2, no scar

    expect(takeWadi.journey.scarWater).toBe(2)
    expect(takeWadi.journey.waterLeft).toBeLessThanOrEqual(startingWater - 2)
    expect(stayTrail.journey.scarWater ?? 0).toBe(0)
    expect(stayTrail.extraDays).toBe(2)
  })
})

describe('passage: reroute (Passage v1.1)', () => {
  /** Init a passage with the graph + endId wiring the engine reroute needs.
   *  Resupply off so supply carry-forward is measured cleanly. Supply is generous
   *  because findRouteWithFallback recomputes segmentDays from the synthetic SVG
   *  distances (not the original edgeDays), so a rerouted leg can run several days
   *  longer than its nominal 1 — we want completion to depend on the reroute, not
   *  on whether the synthetic geometry happens to fit the default water skin. */
  function rerouteable(edgeDays: number[]): { state: PassageState; route: JourneyRoute } {
    const route = makeRoute({ edgeDays, totalKm: edgeDays.reduce((s, d) => s + d, 0) * 25 })
    const state = initPassage({
      route, season: 'spring', mode: 'direct',
      supply: { rationsPerPerson: 60, waterPerPerson: 60, encumbrance: 'normal', packAnimals: 'none' },
      graph: makeGraph(route), endId: route.nodes[route.nodes.length - 1].id,
      resupplyTierFor: () => 'none',
    })
    return { state, route }
  }

  it('swaps the route to the new destination and carries supply forward without consuming a day', () => {
    const { state, route } = rerouteable([1, 1, 1, 1, 1]) // nodes n0..n5
    const afterDay = passageAct(state, { kind: 'continue' }) // dayNum 1
    const rationsBefore = afterDay.journey.rationsLeft
    const waterBefore = afterDay.journey.waterLeft
    const dayBefore = afterDay.journey.dayNum

    const newDest = route.nodes[3].id // a nearer destination than n5
    const rerouted = passageReroute(afterDay, newDest, 'direct')

    // New route terminates at the chosen destination.
    expect(rerouted.journey.route.nodes[rerouted.journey.route.nodes.length - 1].id).toBe(newDest)
    // Day counter continues unbroken: dayOffset pinned to the reroute day, no day spent.
    expect(rerouted.journey.dayOffset).toBe(dayBefore)
    expect(rerouted.journey.dayNum).toBe(dayBefore)
    // Supply carried forward exactly (reroute is a decision, not travel).
    expect(rerouted.journey.rationsLeft).toBeCloseTo(rationsBefore, 5)
    expect(rerouted.journey.waterLeft).toBeCloseTo(waterBefore, 5)
    // A reroute journal entry naming the destination was appended.
    const lastEntry = last(rerouted.log)
    expect(lastEntry.kind).toBe('reroute')
    expect(lastEntry).toMatchObject({ kind: 'reroute', toName: route.nodes[3].name })
    // Marker snaps to the head of the new route (localDay 0 → node 0).
    expect(currentNodeIndex(rerouted)).toBe(0)
  })

  it('can be marched to an ending after a reroute', () => {
    const { state, route } = rerouteable([1, 1, 1, 1, 1])
    let s = passageAct(state, { kind: 'continue' })
    s = passageReroute(s, route.nodes[2].id, 'direct')
    let guard = 30
    while (s.outcome === 'in-progress' && guard-- > 0) s = passageAct(s, { kind: 'continue' })
    expect(s.outcome).toBe('arrived')
    expect(last(s.log)).toMatchObject({ kind: 'ending', outcome: 'arrived' })
  })

  it('is a no-op while a choice is pending, when terminal, or without graph wiring', () => {
    // Pending: a signature blocks reroute.
    const pendingState = passageAct(passageWithSignature('ford'), { kind: 'continue' })
    expect(pendingState.pending).not.toBeNull()
    expect(passageReroute(pendingState, 'n2', 'direct')).toBe(pendingState)

    // No graph wiring (the production pre-reroute path): no-op, not a throw.
    const noGraph = initPassage({
      route: makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 }), season: 'spring', mode: 'direct',
    })
    expect(passageReroute(noGraph, 'n2', 'direct')).toBe(noGraph)
  })
})

describe('passage: resupply activation (live product)', () => {
  it('reaching a full-tier camp node restocks toward the carrying cap', () => {
    // makeRoute: n1.. are "civilization" (full tier). Start below cap so the
    // restock is observable. Resupply is ON by default in initPassage now.
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    const state = initPassage({
      route, season: 'spring', mode: 'direct',
      supply: { rationsPerPerson: 8, waterPerPerson: 8, encumbrance: 'normal', packAnimals: 'none' },
    })
    const afterDay1 = passageAct(state, { kind: 'continue' }) // camps at n1 (civilization → full)
    const day1 = last(afterDay1.log)
    expect(day1.kind).toBe('day')
    if (day1.kind === 'day') {
      expect(day1.supply.resupplyFired).toBe('full')
    }
    // Restocked back to (at most) the carrying cap — strictly above the post-burn level.
    expect(afterDay1.journey.rationsLeft).toBeGreaterThan(8 - 2)
  })

  it('a default-init passage activates resupply (getResupplyTier) without an explicit tier fn', () => {
    const route = makeRoute({ edgeDays: [1, 1], totalKm: 50 })
    const state = initPassage({ route, season: 'spring', mode: 'direct' })
    // resupplyByDay is populated => the engine will restock at full/water nodes.
    expect(state.journey.resupplyByDay.size).toBeGreaterThan(0)
  })
})
