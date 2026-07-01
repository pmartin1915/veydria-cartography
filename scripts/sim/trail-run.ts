/**
 * trail-run.ts — Shared Trail-mode harness for calibrating the PROVISIONAL
 * health / hunt / rank constants in trail.ts.
 *
 * Mirrors run-journey.ts and passage-run.ts in role: pure utilities for
 * driving a TrailState from initTrail to terminal outcome, instrumenting
 * health-transition events (worsen / heal / death) via snapshot-diff, and
 * returning a TrailTrace suitable for CSV aggregation or single-shot inspection.
 *
 * Fidelity decisions (why this harness produces real numbers, not phantom ones):
 *  1. Real per-edge biome. buildEdgeBiomes() replicates JourneyPlanner.tsx:157-167
 *     exactly — edge-midpoint → getBiomeAtPoint() over the same geojson the app
 *     loads. Desert/Sabkha/Steppe/Escarpment are present verbatim in the geojson
 *     → arid pressure and HUNT_ODDS entries fire as they do in real play.
 *  2. Representative hunt policy. Hunt pending is zero-cost (both branches share
 *     the same nextDay advance, trail.ts:571), so always-hunt trivializes
 *     supplyStress (rations pinned near ceiling → supplyStress never bites) and
 *     never-hunt (the unit-test default) phantomizes it (no ration source).
 *     The "hunt-when-low" baseline hunts only when rations margin falls below
 *     HUNT_RATION_THRESHOLD — the midpoint that exercises the supplyStress constants.
 *  3. No "rest" action in v1. Health heals passively only under zero pressure
 *     (severity=0, supplyStress=0), boosted at forts. Wait-days from signature
 *     choices do NOT step health (trail.ts:493). The only active policy lever is
 *     hunt-threshold + safest signature choice — both wired here.
 *
 * Dead-constant note (no silent caps): HUNT_ODDS keys 'Savanna', 'Forest',
 * 'Highland', 'Scrubland' and SEMI_ARID_BIOMES strings 'Savanna', 'Scrubland'
 * don't appear verbatim in veydria-spatial.geojson. Only Desert/Sabkha/Steppe/
 * Escarpment hit specific entries; everything else falls to HUNT_ODDS.default /
 * no-semi-arid. The report flags this explicitly.
 */

import {
  findRouteWithFallback,
  type JourneyRoute,
  type JourneyEdge,
  type JourneyNode,
  type PartyConfig,
  type Season,
  type RouteMode,
} from '../../web/src/utils/journey-graph'
import { type JourneyStateOpts } from '../../web/src/utils/journey-days'
import {
  initTrail,
  trailAct,
  trailChoose,
  scoreTrail,
  type Health,
  type TrailState,
  type TrailMember,
  type InitTrailOpts,
  type TrailOutcome,
} from '../../web/src/utils/trail'
import { getBiomeAtPoint } from '../../web/src/utils/hex-grid'
import type { GeoJSONFeature } from '../../web/src/types/geojson'
import {
  loadGeojson,
  buildGraphFromGeojson,
  getResupplyTier,
  type Graph,
} from './run-journey'

export type { Graph }
export { loadGeojson, buildGraphFromGeojson, getResupplyTier }

/* ─── Health order (mirrors trail.ts — const is not exported from source) ─── */

const HEALTH_ORDER: Health[] = ['well', 'ill', 'very ill', 'dead']

/* ─── Supply / party / policy presets ─── */

export type SupplyPreset = 'caravan' | 'standard' | 'tight'
export type HuntPolicy = 'hunt-when-low' | 'never-hunt' | 'always-hunt'

/**
 * Ration margin (rationsLeft) below which hunt-when-low policy hunts.
 * With PROVISIONAL supply burn ~ 1/person/day, 3 = roughly 3 days of buffer.
 */
const HUNT_RATION_THRESHOLD = 3

export const SUPPLY_PRESETS = {
  /** Generous: full caravan, 12 days rations, 6 water. */
  caravan:  { rationsPerPerson: 12, waterPerPerson: 6, encumbrance: 'normal' as const, packAnimals: 'caravan' as const },
  /** Canonical 2-resource economy (post PR-#44 retune). */
  standard: { rationsPerPerson: 6,  waterPerPerson: 6, encumbrance: 'normal' as const, packAnimals: 'none' as const },
  /** Tight: runs out mid-journey on long routes — exercises perished/party-wiped. */
  tight:    { rationsPerPerson: 4,  waterPerPerson: 3, encumbrance: 'normal' as const, packAnimals: 'none' as const },
} satisfies Record<SupplyPreset, { rationsPerPerson: number; waterPerPerson: number; encumbrance: 'normal'; packAnimals: 'none' | 'caravan' }>

/** Map member count to journey-engine party size bucket. */
function sizeForCount(n: number): 'small' | 'medium' | 'large' {
  if (n <= 2) return 'small'
  if (n <= 4) return 'medium'
  return 'large'
}

/* ─── Default member roster ─── */

const DEFAULT_CIVS  = ['irrah', 'basin', 'ngaru_bon', 'kheshkai', 'qollari'] as const
const DEFAULT_NAMES = ['Sera', 'Vael', 'Oman', 'Khet', 'Dura'] as const

export function makeMembers(count: number): Pick<TrailMember, 'id' | 'name' | 'civ'>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    name: DEFAULT_NAMES[i] ?? `Traveller${i}`,
    civ:  DEFAULT_CIVS[i]  ?? 'irrah',
  }))
}

/* ─── Public types ─── */

export interface TrailInputs {
  from: string
  to: string
  season?: Season
  mode: RouteMode
  supplyPreset: SupplyPreset
  /** Number of trail members (2–5). Ignored if `members` override is provided. */
  partySize: number
  runSeed: number
  huntPolicy: HuntPolicy
  /** Optional member roster override. Defaults to makeMembers(partySize). */
  members?: Pick<TrailMember, 'id' | 'name' | 'civ'>[]
}

export interface MemberTrace {
  id: string
  name: string
  civ: string
  finalHealth: Health
  diedDay: number | undefined
  ailment: string | undefined
}

export interface TrailTrace {
  inputs: TrailInputs
  outcome: TrailOutcome
  daysElapsed: number
  survivors: number
  /** Actual roster size (may differ from inputs.partySize if members override was used). */
  partySize: number
  /** rationsLeft + waterLeft at terminal. */
  supplyMargin: number
  rank: string
  members: MemberTrace[]
  events: {
    /** Times a living member worsened (well→ill, ill→very ill, or very ill→dead). */
    worsen: number
    /** Times a member recovered (very ill→ill or ill→well). */
    heal: number
    /** Total deaths (subset of worsen: very ill→dead). */
    deaths: number
  }
  /** Engine day number of each death, in occurrence order. */
  deathDays: number[]
  pendingCounts: {
    signature: number
    hunt: number
    fort: number
    ford: number
  }
  /** Times we chose to Hunt (idx=0), i.e., policy triggered a hunt attempt. */
  huntAttempts: number
  /** Of huntAttempts, how many succeeded (rations increased). */
  huntSuccess: number
  /** null means no route was found for this from/to pair. */
  routeKm: number | null
  routeEstimatedDays: number | null
}

/* ─── Edge biome builder ─── */

/**
 * Replicates JourneyPlanner.tsx:157-167 exactly — the app's sole source of
 * biome-per-edge. Returns both the raw array (for JourneyStateOpts.edgeBiomes,
 * which drives encounter generation) and the callback (for JourneyStateOpts.biomeForEdge,
 * which drives applyDayHealth's arid check and trailChoose's hunt biome lookup).
 */
export function buildEdgeBiomes(
  route: JourneyRoute,
  features: GeoJSONFeature[],
): {
  edgeBiomes: (string | undefined)[]
  biomeForEdge: (edge: JourneyEdge) => string | undefined
} {
  const nodeById = new Map<string, JourneyNode>()
  for (const n of route.nodes) nodeById.set(n.id, n)

  const edgeBiomes: (string | undefined)[] = route.edges.map(edge => {
    const from = nodeById.get(edge.from)
    const to   = nodeById.get(edge.to)
    if (!from || !to) return undefined
    const mx = (from.x + to.x) / 2
    const my = (from.y + to.y) / 2
    return getBiomeAtPoint(mx, my, features) ?? undefined
  })

  const biomeForEdge = (e: JourneyEdge): string | undefined =>
    edgeBiomes[route.edges.indexOf(e)]

  return { edgeBiomes, biomeForEdge }
}

/* ─── Choice policy ─── */

/**
 * Returns the choiceIndex for the current pending event under the given hunt policy.
 *
 * Hunt (kind='hunt'): 0=Hunt, 1=Press on.
 *   - hunt-when-low: hunt when rationsLeft < HUNT_RATION_THRESHOLD, else press on.
 *   - always-hunt:   always 0 (trivializes supply — upper-bound for report).
 *   - never-hunt:    always 1 (phantom economy — lower-bound / harsh floor).
 *
 * Signature: argmin over choices by supply cost, heavily penalizing scars and wait days.
 *   Rational: scars permanently reduce resupply ceiling; wait days drain water without
 *   health benefit. A simulated "safest choice" policy prevents signature outcomes from
 *   dominating the health metrics we're trying to calibrate.
 *
 * Fort / ford: choice index 0 (the shim ignores it for these).
 */
export function chooseByPolicy(state: TrailState, huntPolicy: HuntPolicy): number {
  const pending = state.pending
  if (!pending) return 0

  if (pending.kind === 'hunt') {
    if (huntPolicy === 'always-hunt') return 0
    if (huntPolicy === 'never-hunt')  return 1
    return state.journey.rationsLeft < HUNT_RATION_THRESHOLD ? 0 : 1
  }

  if (pending.kind === 'signature') {
    const { choices } = pending
    let bestIdx = 0
    let bestScore = -Infinity
    for (let i = 0; i < choices.length; i++) {
      const o = choices[i].outcome
      const score =
        (o.rationsDelta ?? 0) +
        (o.waterDelta ?? 0) -
        (o.scarRations ?? 0) * 4 -
        (o.scarWater  ?? 0) * 4 -
        (o.daysDelta  ?? 0) * 2
      if (score > bestScore) { bestScore = score; bestIdx = i }
    }
    return bestIdx
  }

  return 0 // fort / ford
}

/* ─── Main runner ─── */

/**
 * Run one trail to terminal outcome and return a calibration-ready TrailTrace.
 *
 * Pass `features` from `loadGeojson().features` — the caller loads once and
 * reuses across a batch (getBiomeAtPoint is pure-CPU, not I/O).
 */
export function runTrail(
  inputs: TrailInputs,
  graph: Graph,
  features: GeoJSONFeature[],
): TrailTrace {
  const supply   = SUPPLY_PRESETS[inputs.supplyPreset]
  const members  = inputs.members ?? makeMembers(inputs.partySize)
  const nMembers = members.length
  const party: PartyConfig = {
    pace: 'normal',
    mount: 'foot',
    size: sizeForCount(nMembers),
    forcedMarch: false,
  }

  const { route } = findRouteWithFallback(
    graph, inputs.from, inputs.to, inputs.season, inputs.mode, party,
  )

  if (!route) {
    // No route found — return a sentinel trace with outcome 'aborted' + rank 'No Route'.
    return {
      inputs,
      outcome: 'aborted',
      daysElapsed: 0,
      survivors: 0,
      partySize: nMembers,
      supplyMargin: 0,
      rank: 'No Route',
      members: members.map(m => ({ ...m, finalHealth: 'dead' as Health, diedDay: undefined, ailment: undefined })),
      events: { worsen: 0, heal: 0, deaths: 0 },
      deathDays: [],
      pendingCounts: { signature: 0, hunt: 0, fort: 0, ford: 0 },
      huntAttempts: 0,
      huntSuccess: 0,
      routeKm: null,
      routeEstimatedDays: null,
    }
  }

  // Faithful biome: replicate JourneyPlanner.tsx:157-167.
  const { edgeBiomes, biomeForEdge } = buildEdgeBiomes(route, features)

  const journeyOpts: JourneyStateOpts = {
    route,
    season: inputs.season,
    mode: inputs.mode,
    edgeBiomes,
    biomeForEdge,
    departureDayOfYear: undefined,
    party,
    supply,
    graph,
    endId: inputs.to,
    resupplyTierFor: getResupplyTier,
  }

  const trailOpts: InitTrailOpts = {
    journeyOpts,
    members,
    runSeed: inputs.runSeed,
  }

  let state = initTrail(trailOpts)

  // Snapshot-diff tracking: record health index of each member before each step.
  let prevIdx = state.members.map(m => HEALTH_ORDER.indexOf(m.health))

  let worsen      = 0
  let heal        = 0
  let deaths      = 0
  let huntAttempts = 0
  let huntSuccess  = 0
  const pendingCounts = { signature: 0, hunt: 0, fort: 0, ford: 0 }

  // Safety cap: 3× the route's day budget to bound any runaway loop.
  const safetyMax = (state.journey.totalDays + 1) * 3
  let safety = safetyMax

  while (state.outcome === 'in-progress' && safety-- > 0) {
    const before = state

    if (state.pending) {
      const kind = state.pending.kind
      pendingCounts[kind]++

      if (kind === 'hunt') {
        const idx = chooseByPolicy(state, inputs.huntPolicy)
        if (idx === 0) {
          // Chose to Hunt — detect success via rations delta.
          huntAttempts++
          const rationsBefore = state.journey.rationsLeft
          state = trailChoose(state, idx)
          if (state.journey.rationsLeft > rationsBefore) huntSuccess++
        } else {
          // Press on — no hunt attempt.
          state = trailChoose(state, idx)
        }
      } else {
        state = trailChoose(state, chooseByPolicy(state, inputs.huntPolicy))
      }
    } else {
      state = trailAct(state, { kind: 'continue' })
    }

    if (state === before) break // shim returned no-op — shouldn't happen in normal flow

    // Snapshot-diff: tally health transitions.
    const curIdx = state.members.map(m => HEALTH_ORDER.indexOf(m.health))
    for (let i = 0; i < curIdx.length; i++) {
      const prev = prevIdx[i]
      const cur  = curIdx[i]
      if (cur > prev) {
        if (cur === 3) deaths++  // very ill → dead
        else           worsen++  // well → ill or ill → very ill
      } else if (cur < prev) {
        heal++
      }
    }
    prevIdx = curIdx
  }

  const score = scoreTrail(state)

  return {
    inputs,
    outcome: state.outcome,
    daysElapsed: score.daysElapsed,
    survivors: score.survivors,
    partySize: nMembers,
    supplyMargin: score.supplyMargin,
    rank: score.rank,
    members: state.members.map(m => ({
      id: m.id,
      name: m.name,
      civ: m.civ,
      finalHealth: m.health,
      diedDay: m.diedDay,
      ailment: m.ailment,
    })),
    events: { worsen, heal, deaths },
    deathDays: state.members.filter(m => m.diedDay !== undefined).map(m => m.diedDay as number),
    pendingCounts,
    huntAttempts,
    huntSuccess,
    routeKm: route.totalKm,
    routeEstimatedDays: route.estimatedDays,
  }
}
