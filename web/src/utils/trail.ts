/**
 * trail.ts — Oregon Trail '88 mode: Veydria skin
 *
 * A SIBLING to passage.ts. Rides the same frozen journey engine (journey-days.ts)
 * without modifying it — not one line. Member health is a parallel narrative +
 * scoring layer alongside an untouched JourneyState, exactly as Passage's
 * choice/scar/extraDays layer does.
 *
 * Design seams:
 *  - journey-days.ts, journey-supply.ts, encounters.ts, and passage.ts are
 *    NEVER modified. `git diff` on those files shows zero changes.
 *  - `stepMemberHealth` is seeded (not true-random) so the sim harness can
 *    attribute outcome deltas to choices vs RNG. Same runSeed → byte-identical run.
 *  - `applyDayHealth` is the SINGLE site that steps each member's health per
 *    travelled day. Both direct-advance (trailAct) and pending-resolution
 *    (trailChoose) call it, so health never steps twice or zero times per day.
 *
 * v1 simplifications (intentional — do not "fix"):
 *  - HealthPressure.severity reads the *encounter* beat severity, NOT the
 *    resolved choice risk. "Stand and fight, two don't rise" doesn't itself
 *    drive the health roll. Fine for v1; documented so it isn't mistaken for a bug.
 *  - hunt pending only surfaces when biomeForEdge is available on the journey.
 *    Routes without biome data advance normally (no hunt interruption).
 *  - daysDelta from signature choices applies simplified wait burns (1 water/day
 *    flat rate) rather than the full applyDailyBurn formula. Passage.ts uses
 *    the full formula; trail.ts keeps it simple for v1.
 *  - All numeric probability constants tagged PROVISIONAL — see Step 2b.
 *
 * Build sequence: this is Step 2a. Step 2b (trail-run.ts sim harness) calibrates
 * the PROVISIONAL constants. Step 3 (TrailMode.tsx view) is scoped to /orchestrate.
 */

import {
  initJourneyState,
  nextDay,
  type JourneyState,
  type JourneyStateOpts,
  type Action,
} from './journey-days'
import {
  SIGNATURE_CHOICES,
  PERISH_RATIONS_FLOOR,
  PERISH_WATER_FLOOR,
  zeroSignatureCosts,
  type EncounterChoice,
} from './passage'
import { mulberry32, djb2Hash } from './encounters'
import { classifyAridity } from './journey-supply'

// re-export the floors so consumers don't need to import passage.ts
export { PERISH_RATIONS_FLOOR, PERISH_WATER_FLOOR }

/* ─── Member roster ─────────────────────────────────────────────────────── */

export type Health = 'well' | 'ill' | 'very ill' | 'dead'

/** Ordinal used in stepMemberHealth. DO NOT reorder — index arithmetic depends on it. */
const HEALTH_ORDER: Health[] = ['well', 'ill', 'very ill', 'dead']

export interface TrailMember {
  /** Stable slot id, e.g. 'm0'..'m4'. */
  id: string
  /** Canon Veydrian name — linguistics morphemes only. */
  name: string
  /** CIV key — flavors ailments, epitaphs, and final rank label. */
  civ: string
  /** Cosmetic role tag: 'scout' | 'porter' | 'merchant' | … */
  role?: string
  health: Health
  /** Current Veydrian disease name while ill/very-ill, e.g. 'salt-sickness'. */
  ailment?: string
  /** Set once (first death turn), never overwritten. Undefined while alive. */
  diedDay?: number
  /** One-sentence grave text, set at death. Format: "Name died of ailment near location. Day N." */
  epitaph?: string
}

/* ─── Trail state ───────────────────────────────────────────────────────── */

export type TrailOutcome =
  | 'in-progress'
  | 'arrived'      // reached destination (≥1 member alive)
  | 'aborted'      // player used turn-back action
  | 'perished'     // supply debt floor: rationsLeft ≤ PERISH_RATIONS_FLOOR
                   //                 or waterLeft  ≤ PERISH_WATER_FLOOR
  | 'party-wiped'  // every member dead, orthogonal to supply level

export type TrailPending =
  | { kind: 'signature'; key: string; choices: EncounterChoice[] }
  | { kind: 'ford' }   // reserved: route-level ford crossing (not an encounter beat)
  | { kind: 'hunt' }   // biome-gated dice-roll; view offers "Hunt" | "Press on"
  | { kind: 'fort' }   // waypoint resupply — advance automatically

export interface TrailState {
  /** Frozen engine state — never bypassed. */
  journey: JourneyState
  /** Parallel roster — load-bearing for scoring. */
  members: TrailMember[]
  /** Captured at initTrail; stored for harness replay. */
  runSeed: number
  /** Terse day/event lines: "Day 8 — Sera is ill." */
  log: string[]
  /** Non-null: UI must resolve before advancing. */
  pending: TrailPending | null
  outcome: TrailOutcome
  /** Per-key call count → prose variation (same semantics as passage.ts). */
  signatureCounts: Record<string, number>
}

/* ─── Health pressure ───────────────────────────────────────────────────── */

interface HealthPressure {
  /** Day's worst encounter beat: none=0 | moderate=1 | severe=2. */
  severity: 0 | 1 | 2
  /** From JourneyState supply level: none=0 | low=1 | out=2. Max of rations/water. */
  supplyStress: 0 | 1 | 2
  /** classifyAridity(day) === 'arid'. */
  arid: boolean
  /** This day's resupply tier is 'full' (camping at a waypoint settlement). */
  atFort: boolean
}

/* ─── Scoring ────────────────────────────────────────────────────────────── */

export interface TrailScore {
  survivors: number
  daysElapsed: number
  /** rationsLeft + waterLeft at terminal (can be negative). */
  supplyMargin: number
  /**
   * PROVISIONAL generic rank label (Step 4 replaces with per-civ flavor).
   * NOTE / spec-correction: the spec's example ranks ("Trail Warden", "Dune Walker")
   * are NOT in CIV_LABELS — that map is civ-slug→civ-name. Per-civ rank flavor is
   * Step 4 (Content). This table is a structural stub so TrailScore is usable now.
   */
  rank: string
}

/* ─── InitTrailOpts ─────────────────────────────────────────────────────── */

export interface InitTrailOpts {
  journeyOpts: JourneyStateOpts
  /** 2–5 members. */
  members: Pick<TrailMember, 'id' | 'name' | 'civ' | 'role'>[]
  /** Caller supplies. UI = Date.now()>>>0, sim harness = fixed value. */
  runSeed: number
}

/* ─── Hunt odds ─────────────────────────────────────────────────────────── */

/**
 * Biome → {chance, yield} for the hunt mini-game dice-roll.
 * PROVISIONAL — sim-calibrated in Step 2b.
 * A successful hunt adds `yield` rations, clamped to the resupply ceiling.
 * A failed hunt adds nothing.
 */
export const HUNT_ODDS: Record<string, { chance: number; yield: number }> = {
  Savanna:   { chance: 0.70, yield: 3 }, // PROVISIONAL
  Forest:    { chance: 0.60, yield: 3 }, // PROVISIONAL
  Scrubland: { chance: 0.50, yield: 2 }, // PROVISIONAL
  Highland:  { chance: 0.40, yield: 2 }, // PROVISIONAL
  Desert:    { chance: 0.20, yield: 1 }, // PROVISIONAL
  Sabkha:    { chance: 0.15, yield: 1 }, // PROVISIONAL
  Steppe:    { chance: 0.45, yield: 2 }, // PROVISIONAL
  default:   { chance: 0.30, yield: 2 }, // PROVISIONAL
}

/* ─── Seed offsets — isolate RNG streams ────────────────────────────────── */

/** Per-member health roll offset. Mix: runSeed ^ routeSeed ^ (day*HEALTH_DAY_MULT) ^ memberIdx. */
const HEALTH_DAY_MULT = 1000
/** Hunt roll offset — different stream from health. */
const HUNT_DAY_MULT = 777

/* ─── Private helpers ───────────────────────────────────────────────────── */

/** First signature encounter for engine day `d`, or null. Private (mirrors passage.ts). */
function signatureForDay(
  journey: JourneyState,
  d: number,
  signatureCounts: Record<string, number>,
): { key: string; choices: EncounterChoice[] } | null {
  const encs = journey.encountersByDay.get(d)
  if (!encs) return null
  for (const enc of encs) {
    if (!enc.key) continue
    const variants = SIGNATURE_CHOICES[enc.key]
    if (!variants) continue
    const instance = signatureCounts[enc.key] ?? 0
    const idx = instance % variants.length
    return { key: enc.key, choices: variants[idx] }
  }
  return null
}

/** Encounter severity → numeric pressure level. */
function severityLevel(sev: 'mild' | 'moderate' | 'severe'): 0 | 1 | 2 {
  if (sev === 'severe') return 2
  if (sev === 'moderate') return 1
  return 0
}

/* ─── stepMemberHealth ──────────────────────────────────────────────────── */

/**
 * Pure health transition for one member. Satisfies all 6 spec invariants:
 * 1. Graduated: at most one step per day in either direction (never well→dead).
 * 2. Bidirectional: healChance positive on clean days (severity=0, supplyStress=0),
 *    boosted by atFort. Neglect trends toward death; rest+supply+forts reverse it.
 * 3. Death is a roll: very ill→dead fires only when roll exceeds the threshold.
 *    A very ill member on clean days has real (not negligible) healChance.
 * 4. dead is absorbing: stepMemberHealth('dead', …) === 'dead' always.
 * 5. diedDay/epitaph are set-once — handled by caller (applyDayHealth).
 * 6. NOT monotonic: recovery is deliberate v1 design. Do not collapse to one-way.
 *
 * All numeric constants PROVISIONAL — sim-calibrated in Step 2b.
 */
export function stepMemberHealth(
  current: Health,
  roll: number, // [0, 1) — caller computes from seeded RNG
  p: HealthPressure,
): Health {
  // Invariant 4: dead is absorbing.
  if (current === 'dead') return 'dead'

  const idx = HEALTH_ORDER.indexOf(current)

  // Worsening chance — rises with pressure. PROVISIONAL thresholds.
  let worsenChance = 0.10 // PROVISIONAL base (applies even on clean days)
  if (p.severity === 2) worsenChance += 0.25       // PROVISIONAL
  else if (p.severity === 1) worsenChance += 0.12  // PROVISIONAL
  if (p.supplyStress === 2) worsenChance += 0.20   // PROVISIONAL
  else if (p.supplyStress === 1) worsenChance += 0.08 // PROVISIONAL
  if (p.arid) worsenChance += 0.07                 // PROVISIONAL
  worsenChance = Math.min(worsenChance, 0.80)

  // Heal chance — only on a clean day (severity=0 AND supplyStress=0).
  // PROVISIONAL thresholds.
  let healChance = 0
  if (p.severity === 0 && p.supplyStress === 0) {
    healChance = p.atFort ? 0.45 : 0.20 // PROVISIONAL
  }

  // Invariant 1: one step max. Roll is single-use: compare heal threshold first
  // (roll < healChance), then worsen threshold from the top (roll ≥ 1−worsenChance).
  // The two windows are non-overlapping at calibrated values; if they did overlap,
  // heal wins (the more surprising outcome is rewarded to incentivise rest).
  if (idx > 0 && roll < healChance) {
    return HEALTH_ORDER[idx - 1]
  }
  if (idx < HEALTH_ORDER.length - 1 && roll >= 1 - worsenChance) {
    return HEALTH_ORDER[idx + 1]
  }
  return current
}

/* ─── applyDayHealth ────────────────────────────────────────────────────── */

/**
 * PRIVATE. The single site that steps every living member's health exactly once
 * for one *travelled* day. Both trailAct (direct advance) and trailChoose
 * (pending resolution) call this — never both, never neither.
 *
 * Derives HealthPressure from the post-advance JourneyState, steps each living
 * member via stepMemberHealth, appends log lines on change/death, sets diedDay
 * and epitaph once (never overwritten), then runs terminal checks in spec order:
 * 1. Supply floor → 'perished'
 * 2. All members dead → 'party-wiped'
 * 3. Engine arrived → 'arrived'
 */
function applyDayHealth(state: TrailState): TrailState {
  const journey = state.journey
  const day = journey.dayNum  // the day that was just stepped

  // ── Derive HealthPressure ──

  // severity: max encounter severity for the day (beat severity, NOT choice risk).
  // v1 simplification: documented above in module comment.
  const encs = journey.encountersByDay.get(day) ?? []
  let maxSeverity: 0 | 1 | 2 = 0
  for (const enc of encs) {
    const s = severityLevel(enc.severity)
    if (s > maxSeverity) maxSeverity = s as 0 | 1 | 2
  }

  // supplyStress: max of rations and water stress from the post-burn supply levels.
  const rStress: 0 | 1 | 2 = journey.rationsLeft <= 0 ? 2 : journey.rationsLeft <= 2 ? 1 : 0
  const wStress: 0 | 1 | 2 = journey.waterLeft <= 0 ? 2 : journey.waterLeft <= 2 ? 1 : 0
  const supplyStress: 0 | 1 | 2 = (Math.max(rStress, wStress) as 0 | 1 | 2)

  // arid: from today's edges.
  const dayEdges = journey.edgesByDay.get(day) ?? []
  const arid = classifyAridity(dayEdges, journey.biomeForEdge) === 'arid'

  // atFort: today's camp is at a full-resupply waypoint.
  const atFort = journey.resupplyByDay.get(day) === 'full'

  const pressure: HealthPressure = { severity: maxSeverity, supplyStress, arid, atFort }

  // ── Step each living member ──

  const log = [...state.log]
  const members: TrailMember[] = state.members.map((m, memberIdx) => {
    if (m.health === 'dead') return m  // invariant 4: dead is absorbing

    // Per-member seeded roll: mix runSeed, routeSeed, day, and memberIdx so
    // each member's stream is independent and each day differs.
    const seed = ((state.runSeed ^ journey.routeSeed ^ (day * HEALTH_DAY_MULT) ^ memberIdx) >>> 0)
    const roll = mulberry32(seed)()

    const newHealth = stepMemberHealth(m.health, roll, pressure)
    if (newHealth === m.health) return m  // no change

    if (newHealth === 'dead') {
      // Invariant 5: diedDay and epitaph set once, never overwritten.
      const loc = journey.route.nodes[journey.route.nodes.length - 1]?.name ?? 'the far road'
      const ailment = m.ailment ?? 'fever'
      const epitaph = `${m.name} died of ${ailment} near ${loc}. Day ${day}.`
      log.push(`Day ${day} — ${m.name} has died. "${epitaph}"`)
      return { ...m, health: 'dead', diedDay: day, epitaph }
    }

    if (newHealth === 'very ill' || newHealth === 'ill') {
      const ailment = m.ailment ?? 'fever'
      log.push(`Day ${day} — ${m.name} is ${newHealth}.`)
      return { ...m, health: newHealth, ailment }
    }

    // Recovery to well.
    log.push(`Day ${day} — ${m.name} has recovered.`)
    return { ...m, health: newHealth, ailment: undefined }
  })

  // ── Terminal checks in spec order ──

  let outcome = state.outcome
  if (outcome === 'in-progress') {
    if (
      journey.rationsLeft <= PERISH_RATIONS_FLOOR ||
      journey.waterLeft <= PERISH_WATER_FLOOR
    ) {
      outcome = 'perished'
      log.push(`Day ${day} — The party's stores are spent past the last honest count.`)
    } else if (members.every(m => m.health === 'dead')) {
      outcome = 'party-wiped'
      log.push(`Day ${day} — The party has perished to the last.`)
    } else if (journey.outcome === 'arrived') {
      outcome = 'arrived'
      const dest = journey.route.nodes[journey.route.nodes.length - 1]?.name ?? 'the far gate'
      log.push(`Day ${day} — Arrived at ${dest}.`)
    }
  }

  return { ...state, members, log, outcome }
}

/* ─── Public API ─────────────────────────────────────────────────────────── */

/**
 * Zero the engine-side supplyCost of every signature encounter so the player's
 * CHOICE owns 100% of that encounter's supply movement. Delegates to passage.ts.
 */
export function zeroTrailSignatureCosts(journey: JourneyState): void {
  zeroSignatureCosts(journey)
}

/**
 * Index of the route node the party has most recently reached.
 *
 * Replicates passage.ts's currentNodeIndex logic directly on state.journey
 * (cannot delegate because currentNodeIndex takes PassageState, not TrailState).
 * v1 has no reroute, so dayOffset is always 0.
 */
export function currentTrailNodeIndex(state: TrailState): number {
  const { route, dayNum, dayOffset } = state.journey
  const localDay = dayNum - dayOffset
  if (localDay <= 0) return 0
  let acc = 0
  for (let i = 0; i < route.edges.length; i++) {
    const ed = route.edges[i].segmentDays || 0
    if (acc + ed >= localDay) {
      const frac = ed > 0 ? (localDay - acc) / ed : 1
      return frac >= 0.5 ? i + 1 : i
    }
    acc += ed
  }
  return route.nodes.length - 1
}

/**
 * Begin a Trail run from the same inputs Atlas computed. Seeds a JourneyState
 * via the existing engine, zeroes signature encounter costs (same reason as
 * passage.ts — engine bakes supplyCost into burn; zeroing lets the choice own it),
 * and initialises all members at 'well'.
 */
export function initTrail(opts: InitTrailOpts): TrailState {
  const journey = initJourneyState(opts.journeyOpts)
  zeroSignatureCosts(journey)
  const members: TrailMember[] = opts.members.map(m => ({
    ...m,
    health: 'well' as Health,
  }))
  return {
    journey,
    members,
    runSeed: opts.runSeed,
    log: [],
    pending: null,
    outcome: 'in-progress',
    signatureCounts: {},
  }
}

/**
 * Advance the trail by one player action. A `continue` that would land on a
 * pending event (priority: signature/ford → fort → hunt) sets `pending` and
 * returns WITHOUT stepping health — the day has not yet been travelled.
 * All other actions (or continues with no pending event) advance via the engine
 * and call applyDayHealth exactly once.
 *
 * No-op when finished or while a choice is pending.
 */
export function trailAct(state: TrailState, action: Action): TrailState {
  if (state.outcome !== 'in-progress' || state.pending) return state

  if (action.kind === 'turn-back') {
    // Apply one day's burn (party hikes back) and mark aborted — mirrors passageAct.
    const result = nextDay(state.journey, action)
    const log = [...state.log, `Day ${state.journey.dayNum + 1} — The party turns back.`]
    return { ...state, journey: result.state, outcome: 'aborted', log }
  }

  if (action.kind === 'continue') {
    const nextDayNum = state.journey.dayNum + 1

    // Priority 1: signature / ford (reuses SIGNATURE_CHOICES registry from passage.ts).
    const sig = signatureForDay(state.journey, nextDayNum, state.signatureCounts)
    if (sig) {
      return { ...state, pending: { kind: 'signature', key: sig.key, choices: sig.choices } }
    }

    // Priority 2: fort resupply.
    if (state.journey.resupplyByDay.get(nextDayNum) === 'full') {
      return { ...state, pending: { kind: 'fort' } }
    }

    // Priority 3: hunt (only when biome data is available on this journey).
    // Routes without biomeForEdge advance normally — no hunt pending surfaces.
    // v1 simplification: hunt surfaces whenever biomeForEdge is set and edges exist.
    if (state.journey.biomeForEdge) {
      const dayEdges = state.journey.edgesByDay.get(nextDayNum) ?? []
      if (dayEdges.length > 0) {
        return { ...state, pending: { kind: 'hunt' } }
      }
    }
  }

  // Normal advance: step engine and update health.
  const result = nextDay(state.journey, action)
  if (!result.advanced) return state

  const next: TrailState = { ...state, journey: result.state, log: [...state.log] }
  return applyDayHealth(next)
}

/**
 * Resolve the current pending. Applies deltas for the pending kind, advances
 * the engine via nextDay, then calls applyDayHealth exactly once.
 *
 * Signature: apply rationsDelta/waterDelta/scarRations/scarWater + daysDelta
 * (simplified: each wait day drains 1 water flat-rate; health does NOT step
 * during wait days — the party is stationary). Clamps positive rations to
 * the resupply ceiling (hunting cannot stockpile above the starting cap).
 *
 * Hunt (choiceIndex 0 = Hunt, 1 = Press on): seeded roll, yield clamped to ceiling.
 * Fort: advance automatically (engine resupply fires via the day's resupplyByDay tier).
 * Ford: reserved pending kind — advances with a log entry.
 */
export function trailChoose(state: TrailState, choiceIndex: number): TrailState {
  if (!state.pending || state.outcome !== 'in-progress') return state

  const pending = state.pending
  let journey: JourneyState = { ...state.journey }
  const log: string[] = [...state.log]
  let signatureCounts = state.signatureCounts
  const nextDayNum = journey.dayNum + 1

  if (pending.kind === 'signature') {
    const choice = pending.choices[choiceIndex]
    if (!choice) return state

    // Apply daysDelta as simplified wait burns: 1 water per wait day (flat-rate).
    // Health does NOT step during wait days (party is stationary, not travelling).
    // v1 simplification: passage.ts uses full applyDailyBurn; trail.ts keeps it simple.
    const waitDays = choice.outcome.daysDelta ?? 0
    for (let i = 0; i < waitDays; i++) {
      journey = { ...journey, waterLeft: journey.waterLeft - 1 }
      log.push(`Day ${nextDayNum + i} — Waiting. Stores draw down.`)
    }

    // Apply scar (permanent ceiling reduction) before the one-off delta.
    const newScarRations = (journey.scarRations ?? 0) + (choice.outcome.scarRations ?? 0)
    const newScarWater = (journey.scarWater ?? 0) + (choice.outcome.scarWater ?? 0)
    if (choice.outcome.scarRations || choice.outcome.scarWater) {
      const newCeilRations = Math.max(0, journey.supplyConstants.startingRations - newScarRations)
      const newCeilWater = Math.max(0, journey.supplyConstants.startingWater - newScarWater)
      journey = {
        ...journey,
        scarRations: newScarRations,
        scarWater: newScarWater,
        rationsLeft: Math.min(journey.rationsLeft, newCeilRations),
        waterLeft: Math.min(journey.waterLeft, newCeilWater),
      }
    }

    // Apply one-off supply delta. Positive rations clamped to ceiling (spec §trailChoose).
    const ceilRations = Math.max(0, journey.supplyConstants.startingRations - (journey.scarRations ?? 0))
    journey = {
      ...journey,
      rationsLeft: Math.min(
        journey.rationsLeft + (choice.outcome.rationsDelta ?? 0),
        ceilRations,
      ),
      waterLeft: journey.waterLeft + (choice.outcome.waterDelta ?? 0),
    }

    log.push(`Day ${nextDayNum} — ${choice.label}: ${choice.outcome.narrative}`)

    signatureCounts = {
      ...signatureCounts,
      [pending.key]: (signatureCounts[pending.key] ?? 0) + 1,
    }
  } else if (pending.kind === 'fort') {
    // Fort: advance; engine resupply tier fires automatically inside nextDay.
    log.push(`Day ${nextDayNum} — The party resupplies at the waypoint.`)
  } else if (pending.kind === 'hunt') {
    if (choiceIndex === 0) {
      // "Hunt" — seeded roll. Separate seed stream from health rolls (HUNT_DAY_MULT).
      const seed = ((state.runSeed ^ journey.routeSeed ^ (nextDayNum * HUNT_DAY_MULT)) >>> 0)
      const roll = mulberry32(seed)()

      // Determine biome for this day's edges.
      const dayEdges = journey.edgesByDay.get(nextDayNum) ?? []
      let biomeName = 'default'
      if (journey.biomeForEdge && dayEdges.length > 0) {
        biomeName = journey.biomeForEdge(dayEdges[0].edge) ?? 'default'
      }
      const odds = HUNT_ODDS[biomeName] ?? HUNT_ODDS.default

      if (roll < odds.chance) {
        // Success: add yield, clamped to resupply ceiling (can't stockpile above cap).
        const ceilRations = Math.max(0, journey.supplyConstants.startingRations - (journey.scarRations ?? 0))
        const gained = Math.min(journey.rationsLeft + odds.yield, ceilRations) - journey.rationsLeft
        journey = { ...journey, rationsLeft: journey.rationsLeft + gained }
        log.push(`Day ${nextDayNum} — Hunting successful. ${gained} day(s) of rations gained.`)
      } else {
        log.push(`Day ${nextDayNum} — Hunting: nothing found.`)
      }
    } else {
      // "Press on" — skip hunt, advance normally.
      log.push(`Day ${nextDayNum} — The party presses on without hunting.`)
    }
  } else if (pending.kind === 'ford') {
    // Reserved for route-level ford crossings (no encounter beat required).
    // v1: just advance with a narrative note.
    log.push(`Day ${nextDayNum} — The party fords the river and presses on.`)
  }

  // Advance the engine. Signature cost was zeroed at init so the choice delta
  // already owns 100% of the supply movement for this day.
  const result = nextDay(journey, { kind: 'continue' })
  const nextJourney = result.advanced ? result.state : journey

  const next: TrailState = {
    ...state,
    journey: nextJourney,
    log,
    pending: null,
    signatureCounts,
  }
  return applyDayHealth(next)
}

/**
 * Compute the final score. Call at any terminal outcome (arrived / aborted /
 * perished / party-wiped).
 *
 * Rank thresholds PROVISIONAL — Step 4 (Content) replaces with per-civ flavor.
 * NOTE: spec example ranks ("Trail Warden", "Dune Walker") are NOT in CIV_LABELS
 * (that map is civ-slug → civ-name, e.g. basin → "Aethelian Basin"). Per-civ
 * rank vocabulary is Step 4 (Content). This is a generic tier stub.
 */
export function scoreTrail(state: TrailState): TrailScore {
  const survivors = state.members.filter(m => m.health !== 'dead').length
  const daysElapsed = state.journey.dayNum
  const supplyMargin = state.journey.rationsLeft + state.journey.waterLeft
  const total = state.members.length

  // PROVISIONAL rank table — Step 4 replaces with per-civ flavor.
  let rank: string
  if (state.outcome === 'arrived') {
    if (survivors === total && supplyMargin > 4) rank = 'Trail Warden'        // PROVISIONAL
    else if (survivors === total)                rank = 'Dusty Survivor'      // PROVISIONAL
    else if (survivors > total / 2)              rank = 'Road-Scarred'        // PROVISIONAL
    else                                         rank = 'Last Walker'         // PROVISIONAL
  } else if (state.outcome === 'party-wiped') {
    rank = 'Bones in the Sand'                                                // PROVISIONAL
  } else if (state.outcome === 'perished') {
    rank = 'Lost to the Road'                                                 // PROVISIONAL
  } else {
    rank = 'Turn-Back'                                                        // PROVISIONAL
  }

  return { survivors, daysElapsed, supplyMargin, rank }
}

/* ─── djb2Hash re-export ─────────────────────────────────────────────────── */
// Exported so the UI can derive a deterministic runSeed from a string (e.g. campaign ID)
// without pulling in all of encounters.ts.
export { djb2Hash }
