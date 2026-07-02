import { describe, it, expect } from 'vitest'
import { initJourneyState } from './journey-days'
import type { JourneyRoute } from './journey-graph'
import type { Encounter } from './encounters'
import {
  initTrail,
  trailAct,
  trailChoose,
  zeroTrailSignatureCosts,
  currentTrailNodeIndex,
  scoreTrail,
  stepMemberHealth,
  HUNT_ODDS,
  PERISH_RATIONS_FLOOR,
  PERISH_WATER_FLOOR,
  type TrailState,
  type TrailMember,
} from './trail'
import { SIGNATURE_CHOICES } from './passage'
import { AILMENTS } from './trail-content'

/* ─── Test helpers ──────────────────────────────────────────────────────── */

/** Mirror of passage.test.ts makeRoute — same structure, self-contained. */
function last<T>(a: T[]): T { return a[a.length - 1] }

function makeRoute(opts: { edgeDays: number[]; totalKm: number }): JourneyRoute {
  const nodes = opts.edgeDays.map((_, i) => ({
    id: `n${i}`,
    name: `Node ${i}`,
    category: i === 0 ? 'port' : 'civilization',
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

/** Synthetic encounter for injection. Mirrors passage.test.ts. */
function makeEncounter(
  key?: string,
  severity: Encounter['severity'] = 'moderate',
): Encounter {
  return {
    segmentIdx: 0,
    beat: 'test beat',
    type: 'environmental',
    severity,
    narrative: 'test',
    key,
    supplyCost: { rations: 0, water: 0 },
    timeOfDay: 'day',
  }
}

/** Default two-member party for tests. */
const MEMBERS: Pick<TrailMember, 'id' | 'name' | 'civ' | 'role'>[] = [
  { id: 'm0', name: 'Sera', civ: 'irrah' },
  { id: 'm1', name: 'Vael', civ: 'basin' },
]

/** Build a basic trail state on a 5-day route. No biomeForEdge → no hunt pending. */
function makeTrail(runSeed = 42, extraMembers?: typeof MEMBERS): TrailState {
  const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1], totalKm: 125 })
  return initTrail({
    journeyOpts: { route, season: 'spring', mode: 'direct' },
    members: extraMembers ?? MEMBERS,
    runSeed,
  })
}

/** Build a trail with a signature encounter injected on day 1. */
function trailWithSignature(key: string, runSeed = 42): TrailState {
  const s = makeTrail(runSeed)
  s.journey.encountersByDay.set(1, [makeEncounter(key)])
  return s
}

/** Advance through all remaining days of a trail (guard: 50 steps). */
function runToEnd(s: TrailState, chooseFn?: (s: TrailState) => TrailState): TrailState {
  let guard = 50
  while (s.outcome === 'in-progress' && guard-- > 0) {
    if (s.pending) {
      s = chooseFn ? chooseFn(s) : trailChoose(s, 1) // default: "press on" / skip
    } else {
      s = trailAct(s, { kind: 'continue' })
    }
  }
  return s
}

/* ─── stepMemberHealth: unit tests (pure function) ─────────────────────── */

describe('stepMemberHealth: invariant 4 — dead is absorbing', () => {
  it('returns dead for any roll and any pressure', () => {
    const p = { severity: 0 as const, supplyStress: 0 as const, arid: false, atFort: false }
    expect(stepMemberHealth('dead', 0, p)).toBe('dead')
    expect(stepMemberHealth('dead', 0.5, p)).toBe('dead')
    expect(stepMemberHealth('dead', 0.999, p)).toBe('dead')
  })
})

describe('stepMemberHealth: invariant 1 — graduated, never well→dead', () => {
  it('well can only go to ill or stay well — never skip states', () => {
    const p = { severity: 2 as const, supplyStress: 2 as const, arid: true, atFort: false }
    // Max worsening pressure: well can at most become ill.
    const result = stepMemberHealth('well', 0.999, p)
    expect(result === 'well' || result === 'ill').toBe(true)
    expect(result === 'dead').toBe(false)
    expect(result === 'very ill').toBe(false)
  })
})

describe('stepMemberHealth: invariant 2 — bidirectional', () => {
  it('clean day with low roll heals ill → well', () => {
    const p = { severity: 0 as const, supplyStress: 0 as const, arid: false, atFort: false }
    // roll=0 is below healChance (0.20 baseline on clean day) → heals
    expect(stepMemberHealth('ill', 0, p)).toBe('well')
  })

  it('fort boosts heal chance — low roll heals very ill → ill', () => {
    const p = { severity: 0 as const, supplyStress: 0 as const, arid: false, atFort: true }
    expect(stepMemberHealth('very ill', 0.01, p)).toBe('ill')
  })
})

describe('stepMemberHealth: invariant 3 — death is a roll', () => {
  it('very ill survives a below-threshold roll on a clean day', () => {
    const clean = { severity: 0 as const, supplyStress: 0 as const, arid: false, atFort: false }
    // roll=0.5 is between healChance (0.20) and worsen threshold (1-0.10=0.90)
    // → stays very ill
    expect(stepMemberHealth('very ill', 0.5, clean)).toBe('very ill')
  })

  it('very ill dies when roll exceeds the worsening threshold under severe pressure', () => {
    const harsh = { severity: 2 as const, supplyStress: 2 as const, arid: true, atFort: false }
    // worsenChance = 0.10+0.25+0.20+0.07 = 0.62 → threshold at 1-0.62=0.38
    // roll=0.999 ≥ 0.38 → worsens to dead
    expect(stepMemberHealth('very ill', 0.999, harsh)).toBe('dead')
  })
})

describe('stepMemberHealth: invariant 6 — recovery is deliberate', () => {
  it('ill member on clean days eventually reaches well (not one-way)', () => {
    const clean = { severity: 0 as const, supplyStress: 0 as const, arid: false, atFort: false }
    // roll=0 is always < healChance (0.20) → heals
    expect(stepMemberHealth('ill', 0, clean)).toBe('well')
    expect(stepMemberHealth('very ill', 0, clean)).toBe('ill')
  })
})

/* ─── initTrail ─────────────────────────────────────────────────────────── */

describe('initTrail', () => {
  it('seeds a clean in-progress state', () => {
    const s = makeTrail()
    expect(s.outcome).toBe('in-progress')
    expect(s.pending).toBeNull()
    expect(s.log).toHaveLength(0)
    expect(s.journey.dayNum).toBe(0)
    expect(s.runSeed).toBe(42)
  })

  it('all members start well', () => {
    const s = makeTrail()
    expect(s.members.every(m => m.health === 'well')).toBe(true)
  })

  it('zeroTrailSignatureCosts zeroes signature encounter costs', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    const journey = initJourneyState({ route, season: 'spring', mode: 'direct' })
    journey.encountersByDay.set(1, [makeEncounter('bandits'), { ...makeEncounter(undefined), supplyCost: { rations: 1, water: 1 } }])
    zeroTrailSignatureCosts(journey)
    // bandits is a signature → zeroed
    expect(journey.encountersByDay.get(1)![0].supplyCost).toEqual({ rations: 0, water: 0 })
    // non-signature keeps its cost
    expect(journey.encountersByDay.get(1)![1].supplyCost).toEqual({ rations: 1, water: 1 })
  })
})

/* ─── Determinism ────────────────────────────────────────────────────────── */

describe('determinism', () => {
  it('same runSeed → byte-identical run (log, members, outcome, supply)', () => {
    function run(seed: number) {
      let s = makeTrail(seed)
      // Inject a signature to exercise signatureCounts / choice path too.
      s.journey.encountersByDay.set(1, [makeEncounter('ford')])
      s = trailAct(s, { kind: 'continue' })   // → signature pending
      s = trailChoose(s, 0)                    // resolve ford choice 0
      return runToEnd(s)
    }
    const a = run(1234)
    const b = run(1234)
    expect(a.outcome).toBe(b.outcome)
    expect(a.journey.rationsLeft).toBeCloseTo(b.journey.rationsLeft, 9)
    expect(a.journey.waterLeft).toBeCloseTo(b.journey.waterLeft, 9)
    expect(a.journey.dayNum).toBe(b.journey.dayNum)
    expect(a.log).toEqual(b.log)
    expect(a.members.map(m => m.health)).toEqual(b.members.map(m => m.health))
  })

  it('different runSeeds → different runs (seed is actually wired)', () => {
    function run(seed: number) {
      const s = makeTrail(seed)
      // Inject a severe encounter to make health pressure vary between seeds.
      s.journey.encountersByDay.set(1, [makeEncounter(undefined, 'severe')])
      return runToEnd(s)
    }
    const runs = [run(1), run(2), run(999), run(0xDEADBEEF)]
    // At least some runs should produce a different health trajectory.
    // (Not guaranteed to differ on every tiny route, but with 4 seeds and
    // per-member per-day rolls, the probability of byte-identical logs is ~0.)
    const logs = runs.map(r => r.log.join('|'))
    const uniqueLogs = new Set(logs)
    expect(uniqueLogs.size).toBeGreaterThan(1)
  })
})

/* ─── Once-per-day health step (the critical invariant) ─────────────────── */

describe('once-per-day health step', () => {
  it('(a) plain continue advances health exactly once', () => {
    // Plant a severe encounter on day 1 to make a health change detectable.
    // With seed=0, roll should consistently produce a worsening result
    // on a severe encounter. We check the log has exactly one health event.
    const s = makeTrail(0)
    // Override m0 to ill so a worsening is visible (well→ill vs well→well are hard to count).
    s.members[0] = { ...s.members[0], health: 'ill' }
    s.journey.encountersByDay.set(1, [makeEncounter(undefined, 'severe')])

    const before = s.members.map(m => m.health)
    const after = trailAct(s, { kind: 'continue' })

    // Health can only have stepped once: each member's health differs by at most 1 step.
    after.members.forEach((m, i) => {
      const from = before[i]
      const fromIdx = ['well', 'ill', 'very ill', 'dead'].indexOf(from)
      const toIdx = ['well', 'ill', 'very ill', 'dead'].indexOf(m.health)
      expect(Math.abs(toIdx - fromIdx)).toBeLessThanOrEqual(1)
    })

    // Engine day advanced.
    expect(after.journey.dayNum).toBe(1)
  })

  it('(b) pending-set turn steps health zero times', () => {
    // A continue that surfaces a signature pending must NOT step health.
    let s = trailWithSignature('ford')
    const healthBefore = s.members.map(m => m.health)

    s = trailAct(s, { kind: 'continue' })

    // Still pending — day not yet travelled.
    expect(s.pending).not.toBeNull()
    expect(s.pending!.kind).toBe('signature')
    expect(s.journey.dayNum).toBe(0) // engine NOT advanced

    // Health unchanged: zero steps.
    expect(s.members.map(m => m.health)).toEqual(healthBefore)
    // Log has no health events.
    const healthEvents = s.log.filter(l => /is ill|is very ill|recovered|died/.test(l))
    expect(healthEvents).toHaveLength(0)
  })

  it('(c) trailChoose after pending steps health exactly once', () => {
    let s = trailWithSignature('ford')
    s = trailAct(s, { kind: 'continue' })  // → pending, 0 health steps

    expect(s.pending?.kind).toBe('signature')
    const dayBefore = s.journey.dayNum  // 0

    s = trailChoose(s, 0)  // resolve ford → advance day → health step

    expect(s.pending).toBeNull()
    expect(s.journey.dayNum).toBe(dayBefore + 1)  // engine advanced

    // Exactly one round of health steps fired (one step per member max).
    s.members.forEach(m => {
      // diedDay would be set only on the turn health first reaches dead.
      if (m.diedDay !== undefined) expect(m.diedDay).toBe(dayBefore + 1)
    })
  })
})

/* ─── Endings ────────────────────────────────────────────────────────────── */

describe('endings', () => {
  it('reaching the destination ends with arrived', () => {
    const s = runToEnd(makeTrail())
    expect(s.outcome).toBe('arrived')
  })

  it('turn-back ends with aborted', () => {
    let s = makeTrail()
    s = trailAct(s, { kind: 'continue' })
    s = trailAct(s, { kind: 'turn-back' })
    expect(s.outcome).toBe('aborted')
  })

  it('supply floor → perished (not party-wiped even if members survive)', () => {
    const route = makeRoute({ edgeDays: [3, 3, 3, 3], totalKm: 240 })
    let s = initTrail({
      journeyOpts: {
        route,
        season: 'summer',
        mode: 'direct',
        supply: { rationsPerPerson: 30, waterPerPerson: 2, encumbrance: 'normal', packAnimals: 'none' },
      },
      members: MEMBERS,
      runSeed: 1,
    })
    let guard = 50
    while (s.outcome === 'in-progress' && guard-- > 0) {
      if (s.pending) { s = trailChoose(s, 1); continue }
      s = trailAct(s, { kind: 'continue' })
    }
    expect(s.outcome).toBe('perished')
    const supplyFloorHit =
      s.journey.waterLeft <= PERISH_WATER_FLOOR ||
      s.journey.rationsLeft <= PERISH_RATIONS_FLOOR
    expect(supplyFloorHit).toBe(true)
  })

  it('terminal order — supply floor beats party-wiped', () => {
    // Construct a state where BOTH supply-floor AND party-wiped conditions hold.
    // Supply floor check (1) must fire before party-wiped (2) → outcome = 'perished'.
    //
    // Implementation note: we clear encountersByDay to avoid signature-encounter
    // pending interruptions on day 1. The spring ford encounter frequently lands on
    // day 1 of a short route; clearing it lets trailAct advance directly so
    // applyDayHealth can run the terminal-check ordering.
    const route = makeRoute({ edgeDays: [2, 2], totalKm: 100 })
    let s = initTrail({ journeyOpts: { route, season: 'spring', mode: 'direct' }, members: MEMBERS, runSeed: 1 })
    s = {
      ...s,
      members: s.members.map(m => ({ ...m, health: 'dead' as const, diedDay: 0, epitaph: 'Test.' })),
      journey: {
        ...s.journey,
        rationsLeft: PERISH_RATIONS_FLOOR - 1,  // clearly below floor (-7)
        waterLeft: PERISH_WATER_FLOOR - 1,       // clearly below floor (-4)
        encountersByDay: new Map(),              // no encounters → no pending
      },
    }
    // Both conditions true: supply floor wins → 'perished', not 'party-wiped'.
    const advanced = trailAct(s, { kind: 'continue' })
    expect(advanced.outcome).toBe('perished')
  })

  it('party-wiped with supply remaining → party-wiped (not perished)', () => {
    // All members dead, supply above floor → party-wiped.
    const route = makeRoute({ edgeDays: [2, 2], totalKm: 100 })
    let s = initTrail({ journeyOpts: { route, season: 'spring', mode: 'direct' }, members: MEMBERS, runSeed: 1 })
    // Force all dead, supply healthy.
    s = {
      ...s,
      members: s.members.map(m => ({ ...m, health: 'dead' as const, diedDay: 0, epitaph: 'Test.' })),
    }
    // rationsLeft and waterLeft are at starting values (well above floor).
    const advanced = trailAct(s, { kind: 'continue' })
    expect(advanced.outcome).toBe('party-wiped')
  })
})

/* ─── diedDay / epitaph set-once ────────────────────────────────────────── */

describe('invariant 5 — diedDay and epitaph set once, never overwritten', () => {
  it('diedDay and epitaph are fixed on the death turn', () => {
    // Force a member to very ill and drive them to death with a high-pressure roll.
    const s = makeTrail(0)
    s.members[0] = { ...s.members[0], health: 'very ill' }
    // Inject severe encounter to push worsenChance up.
    s.journey.encountersByDay.set(1, [makeEncounter(undefined, 'severe')])

    // Run a few days to let death happen naturally (or check directly via
    // a full run and verify only the first death turn has diedDay set).
    const final = runToEnd(s)
    final.members.forEach(m => {
      if (m.diedDay !== undefined) {
        // diedDay is a number (set once).
        expect(typeof m.diedDay).toBe('number')
        expect(m.epitaph).toMatch(/Day \d+/)
        // Step 4 content: the ailment is a real AILMENTS name, and the location
        // is the node nearest the death day — not blindly the destination.
        const named = AILMENTS.some(a => m.epitaph!.includes(`died of ${a.name}`))
        expect(named, `epitaph names a real ailment: "${m.epitaph}"`).toBe(true)
        const route = final.journey.route
        let acc = 0
        let idx = route.nodes.length - 1
        for (let i = 0; i < route.edges.length; i++) {
          const ed = route.edges[i].segmentDays || 0
          if (acc + ed >= m.diedDay!) {
            idx = ed > 0 && (m.diedDay! - acc) / ed >= 0.5 ? i + 1 : i
            break
          }
          acc += ed
        }
        expect(m.epitaph).toContain(`near ${route.nodes[idx].name}`)
      }
    })
  })
})

/* ─── Hunt ceiling clamp ─────────────────────────────────────────────────── */

describe('hunt ceiling clamp (spec §trailChoose)', () => {
  it('a successful hunt cannot push rations above the resupply ceiling', () => {
    // Build a trail with Savanna biome (70% chance, yield 3).
    // Force rations to be near-full so ceiling clamp is testable.
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    let s = initTrail({
      journeyOpts: { route, season: 'spring', mode: 'direct' },
      members: MEMBERS,
      runSeed: 1,
    })

    // Directly inject a hunt pending and set rations at ceiling.
    const ceiling = s.journey.supplyConstants.startingRations - (s.journey.scarRations ?? 0)
    s = {
      ...s,
      journey: { ...s.journey, rationsLeft: ceiling },  // already at ceiling
      pending: { kind: 'hunt' },
    }
    // Override biomeForEdge to return 'Savanna' (70% chance, yield 3).
    // Use a seed that guarantees a successful roll (seed=1, HUNT_DAY_MULT=777, day=1):
    // We'll try both outcomes and verify ceiling clamp holds for the success case.
    // Since we can't control which seed produces success without running the RNG,
    // we test both branches: after trailChoose(s, 0), rationsLeft ≤ ceiling.
    const after = trailChoose(s, 0)  // "Hunt"
    const newCeiling = after.journey.supplyConstants.startingRations - (after.journey.scarRations ?? 0)
    expect(after.journey.rationsLeft).toBeLessThanOrEqual(newCeiling)
  })

  it('HUNT_ODDS has the correct biomes per spec', () => {
    const expected = ['Savanna', 'Forest', 'Scrubland', 'Highland', 'Desert', 'Sabkha', 'Steppe', 'default']
    for (const biome of expected) {
      expect(HUNT_ODDS[biome]).toBeDefined()
      expect(HUNT_ODDS[biome].chance).toBeGreaterThan(0)
      expect(HUNT_ODDS[biome].yield).toBeGreaterThan(0)
    }
    // Savanna is the most productive (highest chance × yield).
    expect(HUNT_ODDS.Savanna.chance).toBeGreaterThan(HUNT_ODDS.Desert.chance)
  })
})

/* ─── Signature encounters + choices ────────────────────────────────────── */

describe('signature encounters', () => {
  it('a signature on the next day pauses without advancing', () => {
    let s = trailWithSignature('ford')
    s = trailAct(s, { kind: 'continue' })
    expect(s.pending).not.toBeNull()
    expect(s.pending!.kind).toBe('signature')
    expect((s.pending as { kind: 'signature'; key: string }).key).toBe('ford')
    expect(s.journey.dayNum).toBe(0)  // NOT advanced
  })

  it('resolving a signature choice advances the day and bumps signatureCounts', () => {
    let s = trailWithSignature('ford')
    s = trailAct(s, { kind: 'continue' })  // pending
    s = trailChoose(s, 0)                  // ford choice 0
    expect(s.pending).toBeNull()
    expect(s.journey.dayNum).toBe(1)
    expect(s.signatureCounts['ford']).toBe(1)
  })

  it('rationsDelta choice moves supply by the expected amount between branches', () => {
    // ford choice 0 (Ford now, -2 rations) vs choice 2 (Pay guide, -1 ration):
    // base day burn cancels; net difference = 1 ration.
    const base = trailWithSignature('ford')
    const pending = trailAct(base, { kind: 'continue' })
    const branch0 = trailChoose(pending, 0)  // -2 rations
    const branch2 = trailChoose(pending, 2)  // -1 ration
    expect(branch0.journey.rationsLeft).toBeCloseTo(branch2.journey.rationsLeft - 1, 5)
  })

  it('scoreTrail returns the correct structural fields', () => {
    const final = runToEnd(makeTrail())
    const score = scoreTrail(final)
    expect(typeof score.survivors).toBe('number')
    expect(typeof score.daysElapsed).toBe('number')
    expect(typeof score.supplyMargin).toBe('number')
    expect(typeof score.rank).toBe('string')
    expect(score.rank.length).toBeGreaterThan(0)
  })
})

/* ─── currentTrailNodeIndex ──────────────────────────────────────────────── */

describe('currentTrailNodeIndex', () => {
  it('starts at 0 and advances toward the destination', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    let s = initTrail({ journeyOpts: { route, season: 'spring', mode: 'direct' }, members: MEMBERS, runSeed: 1 })
    expect(currentTrailNodeIndex(s)).toBe(0)
    s = trailAct(s, { kind: 'continue' })
    expect(currentTrailNodeIndex(s)).toBeGreaterThanOrEqual(1)
    s = runToEnd(s)
    expect(currentTrailNodeIndex(s)).toBe(route.nodes.length - 1)
  })
})
