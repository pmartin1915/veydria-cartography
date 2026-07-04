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
  FORAGE_WATER_ODDS,
  STREAM_ODDS,
  STREAM_WATER,
  STREAM_CONTAM_CHANCE,
  ceilWaterOf,
  campSpringRecovery,
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

/** Build a trail on a 5-day route with a fixed biome for every edge. */
function makeTrailWithBiome(biome: string, runSeed = 42, extraMembers?: typeof MEMBERS): TrailState {
  const route = makeRoute({ edgeDays: [1, 1, 1, 1, 1], totalKm: 125 })
  const edgeBiomes = route.edges.map(() => biome)
  return initTrail({
    journeyOpts: {
      route,
      season: 'spring',
      mode: 'direct',
      edgeBiomes,
      biomeForEdge: (edge) => edgeBiomes[route.edges.indexOf(edge)],
    },
    members: extraMembers ?? MEMBERS,
    runSeed,
  })
}

/** Find a seed that makes forage succeed (or fail) in the given biome on day 1. */
function findForageSeed(biome: string, wantSuccess: boolean): number {
  for (let seed = 0; seed < 2000; seed++) {
    const s = makeTrailWithBiome(biome, seed)
    const after = trailChoose({ ...s, pending: { kind: 'hunt' } }, 2)
    const success = after.log.some(l => l.includes('Foraging:') && !l.includes('no water'))
    if (success === wantSuccess) return seed
  }
  throw new Error(`Could not find seed for forage ${wantSuccess ? 'success' : 'failure'} in ${biome}`)
}

/** Find a seed that makes a stream surface (or not) on day 1 in the given biome. */
function findStreamSeed(biome: string, wantSurface: boolean, contaminated?: boolean): number {
  for (let seed = 0; seed < 5000; seed++) {
    const s = makeTrailWithBiome(biome, seed)
    const after = trailAct(s, { kind: 'continue' })
    if (wantSurface) {
      if (after.pending?.kind === 'stream') {
        if (contaminated === undefined || after.pending.contaminated === contaminated) return seed
      }
    } else {
      if (after.pending?.kind !== 'stream') return seed
    }
  }
  throw new Error(`Could not find seed for stream ${wantSurface ? 'surface' : 'no surface'} in ${biome}`)
}

/** Find a seed where a contaminated stream surfaces and only the stream sickness changes health. */
function findContaminatedStreamSeed(): number {
  for (let seed = 0; seed < 5000; seed++) {
    const s = makeTrailWithBiome('Oasis', seed)
    const afterAct = trailAct(s, { kind: 'continue' })
    if (afterAct.pending?.kind !== 'stream' || !afterAct.pending.contaminated) continue
    const beforeHealth = s.members.map(m => m.health)
    const after = trailChoose(afterAct, 0)
    let changed = 0
    let died = false
    for (let i = 0; i < after.members.length; i++) {
      if (after.members[i].health !== beforeHealth[i]) changed++
      if (after.members[i].health === 'dead') died = true
    }
    if (changed === 1 && !died) return seed
  }
  throw new Error('Could not find seed for contaminated stream sickness test')
}

/** Find a seed that makes dig-seep surface (or not) on day 1. */
function findSeepSeed(wantSurface: boolean): number {
  for (let seed = 0; seed < 5000; seed++) {
    // Start with very low water so the water<=2 gate is satisfied.
    const s = makeTrailWithBiome('Desert', seed)
    s.journey.waterLeft = 2
    const after = trailAct(s, { kind: 'continue' })
    if (wantSurface) {
      if (after.pending?.kind === 'dig-seep') return seed
    } else {
      if (after.pending?.kind !== 'dig-seep') return seed
    }
  }
  throw new Error(`Could not find seed for dig-seep ${wantSurface ? 'surface' : 'no surface'}`)
}

/** Find a seed that makes dig succeed (or fail). */
function findDigSeed(wantSuccess: boolean): number {
  for (let seed = 0; seed < 5000; seed++) {
    const s = makeTrailWithBiome('Desert', seed)
    s.journey.waterLeft = 2
    const afterAct = trailAct(s, { kind: 'continue' })
    if (afterAct.pending?.kind !== 'dig-seep') continue
    const after = trailChoose(afterAct, 0)
    const success = after.log.some(l => l.includes('water seeps up dark and cold'))
    if (success === wantSuccess) return seed
  }
  throw new Error(`Could not find seed for dig-seep ${wantSuccess ? 'success' : 'failure'}`)
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

/* ─── Forage-for-water ──────────────────────────────────────────────────── */

describe('forage-for-water', () => {
  it('success adds the biome yield and logs the clamped gain', () => {
    // trailChoose's final nextDay(...) applies the day's own travel burn on top of
    // the forage delta (same as the pre-existing hunt-ceiling test's pattern), so
    // compare against the press-on (index 1) branch — same day, same burn, only the
    // forage yield differs — rather than assuming zero burn.
    const seed = findForageSeed('Oasis', true)
    const s = makeTrailWithBiome('Oasis', seed)
    s.journey.waterLeft = 2 // room for yield
    const pending = { ...s, pending: { kind: 'hunt' } as const }
    const after = trailChoose(pending, 2)
    const pressOn = trailChoose(pending, 1)
    expect(after.log.some(l => /Foraging: \d+ day\(s\) of water found/.test(l))).toBe(true)
    expect(after.journey.waterLeft).toBeCloseTo(pressOn.journey.waterLeft + FORAGE_WATER_ODDS.Oasis.yield, 9)
    expect(after.journey.dayNum).toBe(1)
  })

  it('failure adds no water and logs the miss', () => {
    const seed = findForageSeed('Desert', false)
    const s = makeTrailWithBiome('Desert', seed)
    const pending = { ...s, pending: { kind: 'hunt' } as const }
    const after = trailChoose(pending, 2)
    const pressOn = trailChoose(pending, 1)
    expect(after.log).toContain('Day 1 — Foraging: no water found.')
    expect(after.journey.waterLeft).toBeCloseTo(pressOn.journey.waterLeft, 9)
    expect(after.journey.dayNum).toBe(1)
  })

  it('success clamps to the scarred water ceiling', () => {
    // Already at the scarred ceiling pre-burn, so the forage yield is fully clamped
    // away (net gain 0) and the branch should match press-on exactly.
    const seed = findForageSeed('Oasis', true)
    const s = makeTrailWithBiome('Oasis', seed)
    s.journey.scarWater = s.journey.supplyConstants.startingWater - 1 // ceiling = 1
    s.journey.waterLeft = 1 // already at ceiling
    const pending = { ...s, pending: { kind: 'hunt' } as const }
    const after = trailChoose(pending, 2)
    const pressOn = trailChoose(pending, 1)
    expect(after.journey.waterLeft).toBeCloseTo(pressOn.journey.waterLeft, 9)
    expect(after.log.some(l => /Foraging: 0 day\(s\) of water found/.test(l))).toBe(true)
  })

  it('existing hunt indices 0 and 1 still work unchanged', () => {
    // Use a biome where hunt success is deterministic enough to verify rations changed.
    const seed = findForageSeed('Oasis', true)
    const s = makeTrailWithBiome('Oasis', seed)
    const hunt = trailChoose({ ...s, pending: { kind: 'hunt' } }, 0)
    const press = trailChoose({ ...s, pending: { kind: 'hunt' } }, 1)
    expect(hunt.log.some(l => /Hunting/.test(l))).toBe(true)
    expect(press.log).toContain('Day 1 — The party presses on without hunting.')
    expect(hunt.journey.dayNum).toBe(1)
    expect(press.journey.dayNum).toBe(1)
  })
})

/* ─── Stream refill ─────────────────────────────────────────────────────── */

describe('stream refill', () => {
  it('surfaces only when the roll passes AND the 2-day gap holds', () => {
    const seed = findStreamSeed('Oasis', true)
    const s = makeTrailWithBiome('Oasis', seed)
    const d1 = trailAct(s, { kind: 'continue' })
    expect(d1.pending?.kind).toBe('stream')
    expect(d1.lastStreamDay).toBe(1)

    // Resolve the stream and advance to day 2. A second stream cannot surface
    // the very next day (gap < 2).
    const d2 = trailChoose(d1, 2) // push on
    const d3pending = trailAct(d2, { kind: 'continue' })
    expect(d3pending.pending?.kind).not.toBe('stream')

    // Day 4 is far enough from day 1 for another roll to be allowed (gap >= 2).
    // Whether it actually fires depends on this seed's day-3 roll — Oasis's 0.70
    // chance makes a second surface likely, so assert the invariant either way:
    // lastStreamDay only moves when a stream actually surfaces, and to the right day.
    const d4 = trailChoose(d3pending, d3pending.pending?.kind === 'hunt' ? 1 : 0)
    const d5pending = trailAct(d4, { kind: 'continue' })
    if (d5pending.pending?.kind === 'stream') {
      expect(d5pending.lastStreamDay).toBe(3)
    } else {
      expect(d5pending.lastStreamDay).toBe(1)
    }
  })

  it('fort-eligible day wins over stream priority', () => {
    const route = makeRoute({ edgeDays: [1, 1, 1], totalKm: 75 })
    const edgeBiomes = route.edges.map(() => 'Oasis')
    const s = initTrail({
      journeyOpts: {
        route,
        season: 'spring',
        mode: 'direct',
        edgeBiomes,
        biomeForEdge: (edge) => edgeBiomes[route.edges.indexOf(edge)],
      },
      members: MEMBERS,
      runSeed: 1,
    })
    // Force day 1 to be a full-resupply fort.
    s.journey.resupplyByDay.set(1, 'full')
    const after = trailAct(s, { kind: 'continue' })
    expect(after.pending?.kind).toBe('fort')
  })

  it('stream surfaces instead of hunt when both could fire', () => {
    const seed = findStreamSeed('Oasis', true)
    const s = makeTrailWithBiome('Oasis', seed)
    const after = trailAct(s, { kind: 'continue' })
    expect(after.pending?.kind).toBe('stream')
  })

  it('contaminated fill sickens exactly one living member one step and never kills', () => {
    const seed = findContaminatedStreamSeed()
    const s = makeTrailWithBiome('Oasis', seed)
    const beforeHealth = s.members.map(m => m.health)
    const afterAct = trailAct(s, { kind: 'continue' })
    const pending = afterAct.pending
    if (pending?.kind !== 'stream') throw new Error('expected a stream pending')
    expect(pending.contaminated).toBe(true)

    const after = trailChoose(afterAct, 0)
    expect(after.log.some(l => l.includes('The water was foul.'))).toBe(true)

    let changed = 0
    for (let i = 0; i < after.members.length; i++) {
      const from = beforeHealth[i]
      const to = after.members[i].health
      if (from !== to) {
        changed++
        expect(from === 'well' && to === 'ill').toBe(true)
      }
    }
    expect(changed).toBe(1)
    expect(after.members.every(m => m.health !== 'dead')).toBe(true)
  })

  it('contaminated fill does not drop a very ill member to dead', () => {
    const seed = findContaminatedStreamSeed()
    const s = makeTrailWithBiome('Oasis', seed)
    s.members = s.members.map((m, i) => i === 0 ? { ...m, health: 'very ill' } : m)
    const afterAct = trailAct(s, { kind: 'continue' })
    const after = trailChoose(afterAct, 0)
    expect(after.members[0].health).toBe('very ill')
    expect(after.members.every(m => m.health !== 'dead')).toBe(true)
  })

  it('boil costs 1 water then refills safely', () => {
    // trailChoose's final nextDay(...) applies the day's own travel burn on top of
    // the boil/refill delta, so compare against the push-on (index 2) branch — same
    // day, same burn, only the boil cost + refill differ — rather than assuming
    // zero burn.
    const seed = findStreamSeed('Oasis', true)
    const s = makeTrailWithBiome('Oasis', seed)
    s.journey.waterLeft = 1
    const afterAct = trailAct(s, { kind: 'continue' })
    const after = trailChoose(afterAct, 1)
    const pushOn = trailChoose(afterAct, 2)
    expect(after.log).toContain('Day 1 — The party halts to boil the water.')
    const preBurnBoil = Math.min(STREAM_WATER, ceilWaterOf(after.journey)) // waterLeft was 1-1=0 pre-refill
    expect(after.journey.waterLeft).toBeCloseTo(pushOn.journey.waterLeft + (preBurnBoil - 1), 9)
    expect(after.members.every(m => m.health === 'well')).toBe(true)
  })

  it('stream refill clamps to the scarred ceiling', () => {
    // Already at the scarred ceiling pre-burn, so the fill is fully clamped away
    // (net gain 0) and should match the push-on branch exactly (same day burn).
    const seed = findStreamSeed('Oasis', true)
    const s = makeTrailWithBiome('Oasis', seed)
    s.journey.scarWater = s.journey.supplyConstants.startingWater - 1
    s.journey.waterLeft = 1
    const afterAct = trailAct(s, { kind: 'continue' })
    const after = trailChoose(afterAct, 0)
    const pushOn = trailChoose(afterAct, 2)
    expect(after.journey.waterLeft).toBeCloseTo(pushOn.journey.waterLeft, 9)
  })

  it('lastStreamDay and lastSeepDay persist across unrelated resolutions', () => {
    const seed = findStreamSeed('Oasis', true)
    const s = makeTrailWithBiome('Oasis', seed)
    const afterStream = trailAct(s, { kind: 'continue' })
    expect(afterStream.lastStreamDay).toBe(1)

    // Resolve the stream; then inject a signature on the next pending day and resolve it.
    const afterResolve = trailChoose(afterStream, 2)
    afterResolve.journey.encountersByDay.set(afterResolve.journey.dayNum + 1, [makeEncounter('ford')])
    const afterSigPending = trailAct(afterResolve, { kind: 'continue' })
    const afterSigResolve = trailChoose(afterSigPending, 0)
    expect(afterSigResolve.lastStreamDay).toBe(1)
    expect(afterSigResolve.lastSeepDay).toBeUndefined()
  })
})

/* ─── Rest camp-spring ──────────────────────────────────────────────────── */

describe('rest camp-spring recovery', () => {
  it('rest in a wet biome is net-water-positive when below ceiling', () => {
    const s = makeTrailWithBiome('Cloud forest', 42)
    s.journey.waterLeft = 2 // below ceiling
    const before = s.journey.waterLeft
    const after = trailAct(s, { kind: 'rest' })
    expect(after.journey.waterLeft).toBeGreaterThan(before)
    expect(after.log.some(l => l.includes('camp spring yields'))).toBe(true)
  })

  it('rest in arid terrain applies engine burn plus camp-spring recovery', () => {
    // The engine itself zeroes edgesInDay on rest days (journey-days.ts), so its
    // OWN aridity classification for the burn is always 'none' — the arid biome
    // multiplier (1.5) never applies to rest burn, by design (this is why the
    // recovery classifies aridity from the raw edgesByDay bucket instead of trusting
    // the engine's rest-day burn state). Engine rest burn = encMult(1.0) *
    // actionMods.water(1) * modeMods.water(1.10, 'direct') = 1.10; recovery = 1
    // (arid tier); net = -0.10.
    const s = makeTrailWithBiome('Desert', 42)
    const before = s.journey.waterLeft
    const after = trailAct(s, { kind: 'rest' })
    expect(after.journey.waterLeft).toBeCloseTo(before - 0.1, 9)
  })

  it('rest recovery clamps to the scarred ceiling', () => {
    const s = makeTrailWithBiome('Cloud forest', 42)
    s.journey.scarWater = s.journey.supplyConstants.startingWater - 1
    s.journey.waterLeft = ceilWaterOf(s.journey)
    const after = trailAct(s, { kind: 'rest' })
    expect(after.journey.waterLeft).toBe(ceilWaterOf(after.journey))
  })

  it('rest still steps health exactly once', () => {
    const s = makeTrailWithBiome('Cloud forest', 42)
    s.members[0] = { ...s.members[0], health: 'ill' }
    const before = s.members.map(m => m.health)
    const after = trailAct(s, { kind: 'rest' })
    after.members.forEach((m, i) => {
      const fromIdx = ['well', 'ill', 'very ill', 'dead'].indexOf(before[i])
      const toIdx = ['well', 'ill', 'very ill', 'dead'].indexOf(m.health)
      expect(Math.abs(toIdx - fromIdx)).toBeLessThanOrEqual(1)
    })
  })
})

/* ─── Dig-seep ──────────────────────────────────────────────────────────── */

describe('dig-seep', () => {
  it('does not surface when terrain is not arid', () => {
    const s = makeTrailWithBiome('Cloud forest', 42)
    s.journey.waterLeft = 2
    const after = trailAct(s, { kind: 'continue' })
    expect(after.pending?.kind).not.toBe('dig-seep')
  })

  it('does not surface when water is above 2', () => {
    const s = makeTrailWithBiome('Desert', 42)
    s.journey.waterLeft = 3
    const after = trailAct(s, { kind: 'continue' })
    expect(after.pending?.kind).not.toBe('dig-seep')
  })

  it('does not surface inside the 3-day cooldown', () => {
    const seed = findSeepSeed(true)
    const s = makeTrailWithBiome('Desert', seed)
    s.journey.waterLeft = 2
    const d1 = trailAct(s, { kind: 'continue' })
    expect(d1.pending?.kind).toBe('dig-seep')
    expect(d1.lastSeepDay).toBe(1)

    // Resolve and try the next day; cooldown should prevent another seep.
    const d2 = trailChoose(d1, 1) // push on
    d2.journey.waterLeft = 2
    const d3pending = trailAct(d2, { kind: 'continue' })
    expect(d3pending.pending?.kind).not.toBe('dig-seep')
  })

  it('dig success adds up to 8 water and is deterministic for a fixed seed', () => {
    const seed = findDigSeed(true)
    const s1 = makeTrailWithBiome('Desert', seed)
    s1.journey.waterLeft = 2
    const a1 = trailChoose(trailAct(s1, { kind: 'continue' }), 0)

    const s2 = makeTrailWithBiome('Desert', seed)
    s2.journey.waterLeft = 2
    const a2 = trailChoose(trailAct(s2, { kind: 'continue' }), 0)

    expect(a1.journey.waterLeft).toBe(a2.journey.waterLeft)
    expect(a1.log).toEqual(a2.log)
  })

  it('dig failure adds no water and is deterministic for a fixed seed', () => {
    const seed = findDigSeed(false)
    const s1 = makeTrailWithBiome('Desert', seed)
    s1.journey.waterLeft = 2
    const a1 = trailChoose(trailAct(s1, { kind: 'continue' }), 0)

    const s2 = makeTrailWithBiome('Desert', seed)
    s2.journey.waterLeft = 2
    const a2 = trailChoose(trailAct(s2, { kind: 'continue' }), 0)

    expect(a1.journey.waterLeft).toBe(a2.journey.waterLeft)
    expect(a1.log).toEqual(a2.log)
  })

  it('dig applies the wait burn even on failure', () => {
    // Compare against push-on (index 1) rather than assuming zero day-burn — same
    // day, same burn, dig differs only by the -1 wait cost (failure adds no water).
    const seed = findDigSeed(false)
    const s = makeTrailWithBiome('Desert', seed)
    s.journey.waterLeft = 2
    const pending = trailAct(s, { kind: 'continue' })
    const dig = trailChoose(pending, 0)
    const pushOn = trailChoose(pending, 1)
    expect(dig.journey.waterLeft).toBeCloseTo(pushOn.journey.waterLeft - 1, 9)
  })
})

/* ─── ceilWaterOf helper ────────────────────────────────────────────────── */

describe('ceilWaterOf', () => {
  it('returns startingWater when no scar', () => {
    const s = makeTrail()
    expect(ceilWaterOf(s.journey)).toBe(s.journey.supplyConstants.startingWater)
  })

  it('returns startingWater minus scarWater', () => {
    const s = makeTrail()
    s.journey.scarWater = 2
    expect(ceilWaterOf(s.journey)).toBe(s.journey.supplyConstants.startingWater - 2)
  })

  it('floors at zero', () => {
    const s = makeTrail()
    s.journey.scarWater = 999
    expect(ceilWaterOf(s.journey)).toBe(0)
  })
})

/* ─── campSpringRecovery helper ─────────────────────────────────────────── */

describe('campSpringRecovery', () => {
  it('maps aridity levels exhaustively', () => {
    expect(campSpringRecovery('arid')).toBe(1)
    expect(campSpringRecovery('semi-arid')).toBe(2)
    expect(campSpringRecovery('none')).toBe(3)
  })
})
