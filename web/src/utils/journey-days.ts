/**
 * journey-days.ts — Day-by-day breakdown of a journey route
 *
 * Splits a JourneyRoute (with per-edge segmentDays) into a sequence of
 * one-day buckets. Each bucket lists the kilometres covered, encounters
 * that surface that day, where the party camps at dusk, and a rolled
 * weather line for the season.
 *
 * The output is fully deterministic — same route + season + mode → same
 * days. This is the unit a GM uses for session prep.
 */

import type { JourneyRoute, JourneyEdge, JourneyNode, Season, RouteMode, PartyConfig } from './journey-graph'
import { DEFAULT_PARTY, isDefaultParty, findRouteWithFallback } from './journey-graph'
import { generateEncounters, type Encounter } from './encounters'
import type { CalendarEvent } from './calendar'
import { getEventsForDay } from './calendar'
import type { SupplyConfig, ResupplyTier, SupplyConstants, SupplyDay, SupplyWarning } from './journey-supply'
import { DEFAULT_SUPPLY, deriveSupplyConstants, applyDailyBurn, classifyAridity, type AridityLevel, type BurnModifiers } from './journey-supply'

export interface JourneyDay {
  dayNum: number
  kmCovered: number
  startLabel: string
  campLabel: string
  weather: string
  encounters: Encounter[]
  notable: string[]
  edgesTraversed: { edge: JourneyEdge; portion: number }[] // portion ∈ (0, 1]
  /** Calendar events active on this day, if departure date is set. */
  calendarEvents?: CalendarEvent[]
  /** Absolute day-of-year (1–365) if departure date is set. */
  dayOfYear?: number
  /** Cumulative exhaustion (Phase 3). Omitted when zero to keep legacy traces byte-stable. */
  exhaustionLevel?: number
}

/* ─── Hash + RNG (kept self-contained so this module is independent) ─── */

function djb2Hash(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i)
  return h >>> 0
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6D2B79F5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ─── Weather pools by season ─── */

const WEATHER_POOLS: Record<Season | 'any', string[]> = {
  spring: [
    'Cool morning mist; the sun burns it off by mid-day.',
    'Steady drizzle until noon, then a sharp clear wind from the east.',
    'Warm and bright; new growth crowds the trail.',
    'Squall line at dawn — soaks the bedrolls before camp is struck.',
    'Pollen-thick air; the horses sneeze and the guide curses.',
    'A late frost glazes the trail until first light.',
  ],
  summer: [
    'Heat haze on the horizon; the air shimmers above the road.',
    'Brassy sky, no wind, every step costs water.',
    'Brief afternoon thunderhead — drenches one stretch and skips the next.',
    'Dust devils to the south; the guide reads them as a warning.',
    'Cicada-loud and breezeless; midday rest is mandatory.',
    'Clear, hot, lethal under armour. Travel by dusk.',
  ],
  autumn: [
    'Cold rain off and on; the trail goes to mud by sundown.',
    'Bright, brittle sun; leaves crunch underfoot and the wind smells of woodsmoke.',
    'Ground fog clings until late morning, hiding cairn-marks.',
    'High wind from the steppe — strong enough to stagger a laden mule.',
    'First freeze of the season; puddles glaze and breath fogs.',
    'Wet snow at altitude, plain rain below.',
  ],
  winter: [
    'Hard frost; ice rims every water-skin by dawn.',
    'Snow squall reduces visibility to a spear-throw.',
    'Clear and bone-dry; the cold finds every gap in cloak and glove.',
    'Wind off the high pass; ice crystals cut exposed skin.',
    'Heavy overcast; daylight is a grey rumour and dusk comes by 4th hour.',
    'Sun on snow — blinding without veiled eyes.',
  ],
  any: [
    'Unremarkable weather; the road is the road.',
    'A clean wind and a cold sky; good travelling.',
    'Cloud-cover keeps the heat off and the spirits low.',
    'Light wind, steady pace.',
  ],
}

function rollWeather(rng: () => number, season: Season | undefined): string {
  const pool = season ? WEATHER_POOLS[season] : WEATHER_POOLS.any
  return pool[Math.floor(rng() * pool.length)]
}

/* ─── Helpers ─── */

function midpointDayOfEdge(startT: number, edgeDays: number): number {
  // 1-indexed day on which the edge midpoint falls
  return Math.max(1, Math.ceil(startT + edgeDays / 2))
}

function clampPortion(p: number): number {
  if (p < 0) return 0
  if (p > 1) return 1
  return p
}

/**
 * Find where the party is at the end of `dayBoundary` given a route walked
 * edge by edge. Returns the index of the edge currently being traversed
 * and how far along it (0..1). If the day boundary is past route end,
 * returns { edgeIdx: edges.length - 1, t: 1 } (i.e. at the destination).
 */
function locateAtDay(
  edges: JourneyEdge[],
  dayBoundary: number
): { edgeIdx: number; t: number } {
  let acc = 0
  for (let i = 0; i < edges.length; i++) {
    const ed = edges[i].segmentDays || 0
    if (acc + ed >= dayBoundary) {
      const t = ed > 0 ? (dayBoundary - acc) / ed : 1
      return { edgeIdx: i, t: clampPortion(t) }
    }
    acc += ed
  }
  return { edgeIdx: edges.length - 1, t: 1 }
}

function campLabelAt(
  nodes: JourneyNode[],
  edges: JourneyEdge[],
  edgeIdx: number,
  t: number
): string {
  // t < 0.15 → just-arrived at the leading node of this edge
  // t > 0.85 → essentially at the trailing node
  // otherwise → between two nodes, on the edge name
  const fromNode = nodes[edgeIdx]
  const toNode = nodes[edgeIdx + 1] ?? nodes[edgeIdx]
  if (t <= 0.15) return `Camp at ${fromNode.name}`
  if (t >= 0.85) return `Camp at ${toNode.name}`
  const edge = edges[edgeIdx]
  return `Camp on the ${edge.name} (between ${fromNode.name} and ${toNode.name})`
}

function formatPartySummary(p: PartyConfig): string {
  const bits: string[] = []
  if (p.mount === 'mounted') bits.push('mounted')
  if (p.pace !== 'normal') bits.push(`${p.pace} pace`)
  if (p.size !== 'medium') bits.push(`${p.size} party`)
  if (p.forcedMarch) bits.push('forced march')
  return bits.length > 0 ? `Party: ${bits.join(', ')}.` : ''
}

function notableForDay(
  edgesInDay: { edge: JourneyEdge; portion: number }[],
  dayNum: number,
  totalDays: number,
  party?: PartyConfig
): string[] {
  const out: string[] = []
  for (const { edge } of edgesInDay) {
    if (edge.type === 'chokepoint') {
      out.push(`Traverse ${edge.name} (chokepoint)`)
    } else if (edge.type === 'civ_link') {
      out.push(`Cross from one civ to the next via ${edge.name}`)
    } else if (edge.bottleneck) {
      out.push(`Bottleneck on ${edge.name}: ${edge.bottleneck}`)
    }
    if (edge.seasonal) {
      out.push(`Seasonal note on ${edge.name}: ${edge.seasonal}`)
    }
  }
  if (dayNum === 1) {
    out.unshift('Departure day.')
    if (party && !isDefaultParty(party)) {
      const summary = formatPartySummary(party)
      if (summary) out.unshift(summary)
    }
  }
  if (dayNum === totalDays) out.push('Arrival day.')
  if (party?.forcedMarch) {
    out.push('Forced march — each day costs a level of exhaustion until a long rest.')
  }
  return out
}

/* ─── Phase 3 sim API: state + per-day stepping ─── */

export type Action =
  | { kind: 'continue' }
  | { kind: 'rest' }
  | { kind: 'force-march' }
  | { kind: 'ration' }
  | { kind: 'reroute'; mode: RouteMode }
  | { kind: 'turn-back' }

/**
 * Terminal state of a journey. `in-progress` is the running state;
 * `arrived` fires on the final day; `aborted` fires when a policy
 * picks `turn-back`. Supply outages do NOT terminate by themselves —
 * the day's `supply.warning` surfaces them; callers (sim summarizer)
 * decide what to do.
 */
export type DayOutcome =
  | 'in-progress'
  | 'arrived'
  | 'aborted'

export interface JourneyState {
  /* Inputs (the harness never mutates these directly; reroute swaps route + cache.) */
  route: JourneyRoute
  season?: Season
  mode: RouteMode
  party: PartyConfig
  supply: SupplyConfig
  edgeBiomes?: (string | undefined)[]
  departureDayOfYear?: number

  /* For reroute support (sim harness only; buildDailyBreakdown omits) */
  graph?: import('./journey-graph').Graph
  endId?: string
  resupplyTierFor?: (category: string) => ResupplyTier
  biomeForEdge?: (edge: JourneyEdge) => string | undefined

  /* Derived per-route (recomputed on reroute). dayOffset shifts the
   * new route's day numbering so the journey-level dayNum continues. */
  totalDays: number
  dayOffset: number
  routeSeed: number
  encountersByDay: Map<number, Encounter[]>
  edgesByDay: Map<number, { edge: JourneyEdge; portion: number }[]>
  resupplyByDay: Map<number, ResupplyTier>
  routeCivs: Set<string>
  supplyConstants: SupplyConstants

  /* Mutable per step */
  dayNum: number /* last completed day (0 at init) */
  rationsLeft: number
  waterLeft: number
  exhaustionLevel: number
  finished: boolean
  outcome: DayOutcome
}

export interface JourneyStateOpts {
  route: JourneyRoute
  season?: Season
  mode?: RouteMode
  edgeBiomes?: (string | undefined)[]
  departureDayOfYear?: number
  party?: PartyConfig
  supply?: SupplyConfig
  /* Sim-harness-only fields. UI path leaves them undefined. */
  graph?: import('./journey-graph').Graph
  endId?: string
  resupplyTierFor?: (category: string) => ResupplyTier
  biomeForEdge?: (edge: JourneyEdge) => string | undefined
}

export interface NextDayResult {
  state: JourneyState
  day: JourneyDay | null
  supply: SupplyDay | null
  outcome: DayOutcome
  /** True if this call advanced state at all (false when called on a finished state). */
  advanced: boolean
}

/* Internal: bucket encounters + edges + resupply tiers for a given route
 * segment starting at `dayOffset`. Pure — does not look at JourneyState. */
function bucketRoute(
  route: JourneyRoute,
  season: Season | undefined,
  mode: RouteMode,
  edgeBiomes: (string | undefined)[] | undefined,
  dayOffset: number,
  resupplyTierFor?: (category: string) => ResupplyTier,
): {
  totalDays: number
  routeSeed: number
  encountersByDay: Map<number, Encounter[]>
  edgesByDay: Map<number, { edge: JourneyEdge; portion: number }[]>
  resupplyByDay: Map<number, ResupplyTier>
  routeCivs: Set<string>
} {
  const totalDaysLocal = Math.max(1, Math.ceil(route.estimatedDays))
  const sig = route.nodes.map(n => n.id).join('|') + '#' + (season || 'any') + '#' + mode + '#days'
  const routeSeed = djb2Hash(sig)

  /* Pre-bucket encounters by their edge's midpoint day, offset to journey day. */
  const allEncounters = generateEncounters(route, season, mode, edgeBiomes)
  const encountersByDay: Map<number, Encounter[]> = new Map()
  let acc = 0
  const edgeMidpointDay: number[] = []
  for (const e of route.edges) {
    const ed = e.segmentDays || 0
    edgeMidpointDay.push(midpointDayOfEdge(acc, ed))
    acc += ed
  }
  for (const enc of allEncounters) {
    const localDay = Math.min(totalDaysLocal, edgeMidpointDay[enc.segmentIdx] || 1)
    const day = dayOffset + localDay
    if (!encountersByDay.has(day)) encountersByDay.set(day, [])
    encountersByDay.get(day)!.push(enc)
  }

  /* Pre-compute edges traversed within each day (incl. partial edges). */
  const edgesByDay: Map<number, { edge: JourneyEdge; portion: number }[]> = new Map()
  acc = 0
  for (let i = 0; i < route.edges.length; i++) {
    const ed = route.edges[i].segmentDays || 0
    const startT = acc
    const endT = acc + ed
    acc = endT

    const firstDay = Math.max(1, Math.ceil(startT + 0.001))
    const lastDay = Math.min(totalDaysLocal, Math.ceil(endT))
    if (firstDay > lastDay) {
      const d = dayOffset + edgeMidpointDay[i]
      const list = edgesByDay.get(d) || []
      list.push({ edge: route.edges[i], portion: 1 })
      edgesByDay.set(d, list)
      continue
    }
    for (let d = firstDay; d <= lastDay; d++) {
      const dayStartT = d - 1
      const dayEndT = d
      const overlap = Math.min(endT, dayEndT) - Math.max(startT, dayStartT)
      const portion = ed > 0 ? clampPortion(overlap / ed) : 0
      if (portion <= 0) continue
      const journeyDay = dayOffset + d
      const list = edgesByDay.get(journeyDay) || []
      list.push({ edge: route.edges[i], portion })
      edgesByDay.set(journeyDay, list)
    }
  }

  /* Civilizations on the route (kebab-case) for calendar filtering. */
  const routeCivs = new Set(
    route.nodes
      .map(n => n.civ?.replace(/_/g, '-'))
      .filter((c): c is string => !!c)
  )

  /* Pre-bucket resupply tiers per day. Mirrors run-journey.ts's legacy walk
   * over days[].campLabel: a day grants the tier of whatever node its
   * campLabel names ("Camp at X" or "Arrive at X"). Mid-edge days
   * ("Camp on the …") grant no tier — they don't name a node.
   *
   * Implementation: for each local day we recompute the end-of-day position
   * via locateAtDay + the same t<=0.15 / t>=0.85 snap that campLabelAt uses,
   * then look the resulting node name up in a name→tier map. The final day
   * always maps to the destination node (matches nextDay's "Arrive at X"
   * shortcut at journey-days.ts isFinalDay branch).
   *
   * Why this care: a previous accNodeDay-based mapping (Math.ceil of
   * cumulative segmentDays) could land a node on a different day than
   * campLabelAt did at non-integer node boundaries, causing the policy
   * supply path to diverge from the legacy supply path. See HANDOFF-2026-05-26. */
  const resupplyByDay: Map<number, ResupplyTier> = new Map()
  if (resupplyTierFor) {
    const nameToTier = new Map<string, ResupplyTier>()
    for (const n of route.nodes) {
      nameToTier.set(n.name, resupplyTierFor(n.category))
    }
    for (let localDay = 1; localDay <= totalDaysLocal; localDay++) {
      let nodeName: string | undefined
      if (localDay === totalDaysLocal) {
        nodeName = route.nodes[route.nodes.length - 1].name
      } else {
        const pos = locateAtDay(route.edges, localDay)
        if (pos.t <= 0.15) {
          nodeName = route.nodes[pos.edgeIdx].name
        } else if (pos.t >= 0.85) {
          nodeName = (route.nodes[pos.edgeIdx + 1] ?? route.nodes[pos.edgeIdx]).name
        }
      }
      if (!nodeName) continue
      const tier = nameToTier.get(nodeName)
      if (!tier || tier === 'none') continue
      const journeyDay = dayOffset + localDay
      const existing = resupplyByDay.get(journeyDay)
      if (!existing || tierRank(tier) > tierRank(existing)) {
        resupplyByDay.set(journeyDay, tier)
      }
    }
  }

  return {
    totalDays: dayOffset + totalDaysLocal,
    routeSeed,
    encountersByDay,
    edgesByDay,
    resupplyByDay,
    routeCivs,
  }
}

function tierRank(t: ResupplyTier): number {
  if (t === 'full') return 3
  if (t === 'rations') return 2
  if (t === 'water') return 1
  return 0
}

/**
 * Initialise a stepping state for a route. UI callers (buildDailyBreakdown)
 * pass only narrative inputs; the sim harness also passes graph/endId/
 * resupplyTierFor/biomeForEdge so reroute + supply tracking work.
 */
export function initJourneyState(opts: JourneyStateOpts): JourneyState {
  const route = opts.route
  const season = opts.season
  const mode = opts.mode ?? 'direct'
  const party = opts.party ?? DEFAULT_PARTY
  const supply = opts.supply ?? DEFAULT_SUPPLY
  const constants = deriveSupplyConstants(supply)

  /* Empty/zero-day route: produce a finished state that emits nothing. */
  if (!route.edges.length || route.estimatedDays <= 0) {
    return {
      route, season, mode, party, supply,
      edgeBiomes: opts.edgeBiomes,
      departureDayOfYear: opts.departureDayOfYear,
      graph: opts.graph,
      endId: opts.endId,
      resupplyTierFor: opts.resupplyTierFor,
      biomeForEdge: opts.biomeForEdge,
      totalDays: 0,
      dayOffset: 0,
      routeSeed: 0,
      encountersByDay: new Map(),
      edgesByDay: new Map(),
      resupplyByDay: new Map(),
      routeCivs: new Set(),
      supplyConstants: constants,
      dayNum: 0,
      rationsLeft: constants.startingRations,
      waterLeft: constants.startingWater,
      exhaustionLevel: 0,
      finished: true,
      outcome: 'arrived',
    }
  }

  const buckets = bucketRoute(route, season, mode, opts.edgeBiomes, 0, opts.resupplyTierFor)

  return {
    route, season, mode, party, supply,
    edgeBiomes: opts.edgeBiomes,
    departureDayOfYear: opts.departureDayOfYear,
    graph: opts.graph,
    endId: opts.endId,
    resupplyTierFor: opts.resupplyTierFor,
    biomeForEdge: opts.biomeForEdge,
    totalDays: buckets.totalDays,
    dayOffset: 0,
    routeSeed: buckets.routeSeed,
    encountersByDay: buckets.encountersByDay,
    edgesByDay: buckets.edgesByDay,
    resupplyByDay: buckets.resupplyByDay,
    routeCivs: buckets.routeCivs,
    supplyConstants: constants,
    dayNum: 0,
    rationsLeft: constants.startingRations,
    waterLeft: constants.startingWater,
    exhaustionLevel: 0,
    finished: false,
    outcome: 'in-progress',
  }
}

function burnModsForAction(action: Action): BurnModifiers {
  if (action.kind === 'rest') return { rations: 0, water: 1 }
  if (action.kind === 'force-march') return { rations: 2, water: 1.5 }
  if (action.kind === 'ration') return { rations: 0.5, water: 1 }
  /* continue, reroute, turn-back use default 1×1. */
  return { rations: 1, water: 1 }
}

function exhaustionDeltaForAction(action: Action): number {
  if (action.kind === 'rest') return -1
  if (action.kind === 'force-march') return 1
  if (action.kind === 'ration') return 1
  return 0
}

/**
 * Step one day forward. Pure: returns a fresh state, never mutates the input.
 *
 * Actions:
 * - `continue`   — normal day, default burn.
 * - `rest`       — zero km, zero ration burn, full water burn, exhaustion −1.
 * - `force-march` — ×2 ration / ×1.5 water burn this day, exhaustion +1.
 * - `ration`     — half ration burn this day, exhaustion +1.
 * - `reroute`    — snap to current node, re-route via findRouteWithFallback,
 *                  recompute buckets for the new route segment. Requires
 *                  `state.graph` + `state.endId` (sim harness only).
 * - `turn-back`  — applies a normal day's burn (party is hiking back) and
 *                  marks the journey aborted.
 */
export function nextDay(state: JourneyState, action: Action): NextDayResult {
  if (state.finished) {
    return { state, day: null, supply: null, outcome: state.outcome, advanced: false }
  }

  /* Reroute is a state-only operation: swap route + buckets, emit no day. */
  if (action.kind === 'reroute') {
    if (!state.graph || !state.endId) {
      throw new Error('nextDay({kind:"reroute"}) requires state.graph and state.endId')
    }
    /* Snap current position to the closer endpoint of the current edge. */
    const pos = locateAtDay(state.route.edges, state.dayNum - state.dayOffset)
    const snapIdx = pos.t >= 0.5 ? pos.edgeIdx + 1 : pos.edgeIdx
    const snapNode = state.route.nodes[snapIdx]
    if (!snapNode) {
      throw new Error('nextDay reroute: could not snap to a route node')
    }
    const { route: newRoute } = findRouteWithFallback(
      state.graph, snapNode.id, state.endId, state.season, action.mode, state.party,
    )
    if (!newRoute) {
      /* No alternate route — caller should treat as no-op or follow up with
       * a turn-back. Returning advanced=false signals the action did nothing. */
      return { state, day: null, supply: null, outcome: state.outcome, advanced: false }
    }
    const newBuckets = bucketRoute(newRoute, state.season, action.mode, state.edgeBiomes, state.dayNum, state.resupplyTierFor)
    const nextState: JourneyState = {
      ...state,
      route: newRoute,
      mode: action.mode,
      totalDays: newBuckets.totalDays,
      dayOffset: state.dayNum,
      routeSeed: newBuckets.routeSeed,
      encountersByDay: newBuckets.encountersByDay,
      edgesByDay: newBuckets.edgesByDay,
      resupplyByDay: newBuckets.resupplyByDay,
      routeCivs: newBuckets.routeCivs,
    }
    return { state: nextState, day: null, supply: null, outcome: 'in-progress', advanced: true }
  }

  const d = state.dayNum + 1
  const localDay = d - state.dayOffset
  const isFinalDay = d === state.totalDays
  const rng = mulberry32(state.routeSeed + localDay * 7919)
  const baseEdgesInDay = state.edgesByDay.get(d) || []
  const edgesInDay = action.kind === 'rest' ? [] : baseEdgesInDay

  const totalKm = state.route.totalKm
  const totalDistanceSvg = state.route.totalDistanceSvg
  const kmCovered = edgesInDay.reduce((sum, { edge, portion }) => {
    const edgeKm = totalDistanceSvg > 0 ? totalKm * (edge.distanceSvg / totalDistanceSvg) : 0
    return sum + edgeKm * portion
  }, 0)

  let startLabel: string
  if (d === 1) {
    startLabel = `Depart ${state.route.nodes[0].name}`
  } else {
    const prevLocal = (d - 1) - state.dayOffset
    /* If the prior day was a rest (dayOffset boundary), prevLocal could be 0;
     * that maps to "at the origin of the current route segment". */
    if (prevLocal <= 0) {
      startLabel = `Resume from ${state.route.nodes[0].name}`
    } else {
      const prevPos = locateAtDay(state.route.edges, prevLocal)
      startLabel = `Resume from ${campLabelAt(state.route.nodes, state.route.edges, prevPos.edgeIdx, prevPos.t).replace(/^Camp (?:at|on the) /, '')}`
    }
  }

  let campLabel: string
  if (action.kind === 'rest') {
    /* Rest in place: campLabel matches the prior day's camp (or origin on day 1). */
    if (d === 1) {
      campLabel = `Camp at ${state.route.nodes[0].name}`
    } else {
      const prevLocal = (d - 1) - state.dayOffset
      if (prevLocal <= 0) {
        campLabel = `Camp at ${state.route.nodes[0].name}`
      } else {
        const prevPos = locateAtDay(state.route.edges, prevLocal)
        campLabel = campLabelAt(state.route.nodes, state.route.edges, prevPos.edgeIdx, prevPos.t)
      }
    }
  } else if (isFinalDay) {
    campLabel = `Arrive at ${state.route.nodes[state.route.nodes.length - 1].name}`
  } else {
    const pos = locateAtDay(state.route.edges, localDay)
    campLabel = campLabelAt(state.route.nodes, state.route.edges, pos.edgeIdx, pos.t)
  }

  const day: JourneyDay = {
    dayNum: d,
    kmCovered,
    startLabel,
    campLabel,
    weather: rollWeather(rng, state.season),
    encounters: action.kind === 'rest' ? [] : (state.encountersByDay.get(d) || []),
    notable: action.kind === 'rest'
      ? ['Rest day — no progress.']
      : notableForDay(edgesInDay, d, state.totalDays, state.party),
    edgesTraversed: edgesInDay,
  }
  if (action.kind === 'force-march' && !state.party.forcedMarch) {
    /* Engine party.forcedMarch already emits its own notable; only add
     * the per-day version when the party isn't on a baseline forced march. */
    day.notable.push('Force-march — supplies burn faster, exhaustion +1.')
  }
  if (action.kind === 'ration') {
    day.notable.push('Half-ration — supplies stretch, exhaustion +1.')
  }
  if (state.departureDayOfYear !== undefined && state.departureDayOfYear > 0) {
    const doy = ((state.departureDayOfYear - 1 + d - 1) % 365) + 1
    day.dayOfYear = doy
    const events = getEventsForDay(doy)
    day.calendarEvents = state.routeCivs.size > 0
      ? events.filter(ev => ev.civilization === 'all' || state.routeCivs.has(ev.civilization))
      : events
  }

  /* Supply burn. Resupply tier applies to camp on day d (state-derived). */
  const aridity: AridityLevel = classifyAridity(edgesInDay, state.biomeForEdge)
  const resupplyTier: ResupplyTier = state.resupplyByDay.get(d) ?? 'none'
  const burn = applyDailyBurn(
    state.rationsLeft, state.waterLeft, state.supplyConstants,
    state.party, state.season, aridity, resupplyTier, burnModsForAction(action),
  )

  /* Exhaustion. Floor at 0; rest never drops below 0. */
  const exhaustion = Math.max(0, state.exhaustionLevel + exhaustionDeltaForAction(action))
  if (exhaustion > 0) day.exhaustionLevel = exhaustion

  /* Terminal state. Supply outage doesn't auto-terminate (legacy parity);
   * callers read supply.warning to react. Only turn-back / arrival do. */
  let outcome: DayOutcome = 'in-progress'
  let finished = false
  if (action.kind === 'turn-back') {
    outcome = 'aborted'
    finished = true
    day.notable.push(`Turn back on day ${d}.`)
  } else if (isFinalDay) {
    outcome = 'arrived'
    finished = true
  }

  const supply: SupplyDay = {
    dayNum: d,
    rationsLeft: burn.rationsLeft,
    waterLeft: burn.waterLeft,
    rationsBurnedToday: burn.rationsBurnedToday,
    waterBurnedToday: burn.waterBurnedToday,
    warning: burn.warning,
  }

  const nextState: JourneyState = {
    ...state,
    dayNum: d,
    rationsLeft: burn.rationsLeft,
    waterLeft: burn.waterLeft,
    exhaustionLevel: exhaustion,
    finished,
    outcome,
  }

  return { state: nextState, day, supply, outcome, advanced: true }
}

/* ─── Public API (UI-facing) ─── */

export function buildDailyBreakdown(
  route: JourneyRoute,
  season?: Season,
  mode: RouteMode = 'direct',
  edgeBiomes?: (string | undefined)[],
  departureDayOfYear?: number,
  party?: PartyConfig
): JourneyDay[] {
  let state = initJourneyState({ route, season, mode, edgeBiomes, departureDayOfYear, party })
  const days: JourneyDay[] = []
  /* Hard cap on iterations as a defensive floor — totalDays is the natural bound. */
  let safety = state.totalDays + 1
  while (!state.finished && safety-- > 0) {
    const result = nextDay(state, { kind: 'continue' })
    if (result.day) days.push(result.day)
    state = result.state
  }
  return days
}

/* Allow other modules to reach the encounter-bucketing logic when needed
 * (kept as named exports rather than a sub-module to keep this file the
 * single home for journey-step semantics). */
export { generateEncounters }
/* Re-export aridity/burn types so sim consumers can import everything
 * step-related from one place. */
export type { AridityLevel } from './journey-supply'
