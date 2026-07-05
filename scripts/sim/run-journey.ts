/**
 * run-journey.ts — Shared journey-run code path used by both Phase 1
 * (sim-journey.ts, the single-shot CLI) and Phase 2 (sim-batch.ts, the
 * grid runner). Owning this in one place keeps the Trace shape and the
 * supply/encounter accounting identical across all sim entry points.
 *
 * No engine forks. We import the same pure utils the UI calls and
 * compose them. Anything this file measures is what a real GM sees.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import {
  buildGraph,
  findRouteWithFallback,
  type PartyConfig,
  type Season,
  type RouteMode,
} from '../../web/src/utils/journey-graph'
import {
  buildDailyBreakdown,
  initJourneyState,
  nextDay,
  type Action,
  type JourneyDay,
} from '../../web/src/utils/journey-days'
import {
  computeSupplyTimeline,
  getResupplyTier,
  type ResupplyTier,
  type SupplyConfig,
  type SupplyDay,
} from '../../web/src/utils/journey-supply'
import { getPolicy, type PolicyName } from './policies'

export type Graph = ReturnType<typeof buildGraph>

// getResupplyTier now lives in web/src/utils/journey-supply.ts (2026-07-04) so the
// app and every sim entry point share one definition. Re-exported here so existing
// importers of this module (trail-run.ts, passage-run.ts) don't need to change
// their import path.
export { getResupplyTier }

export interface JourneyInputs {
  from: string
  to: string
  season?: Season
  mode: RouteMode
  depart?: number
  party: PartyConfig
  supply: SupplyConfig
  /** Phase 3: optional decision policy. Omit for legacy continue-only path. */
  policy?: PolicyName
}

export interface Trace {
  inputs: JourneyInputs
  route: {
    found: boolean
    totalKm: number
    estimatedDays: number
    bottlenecks: string[]
    seasonalWarnings: string[]
    pivotIds: string[]
    nodeIds: string[]
    edgeCount: number
  } | null
  days: Array<{
    dayNum: number
    kmCovered: number
    startLabel: string
    campLabel: string
    weather: string
    notable: string[]
    encounters: Array<{ type: string; severity: string; biome?: string; beat: string }>
    calendarEvents: Array<{ name: string; civ?: string }>
    rationsLeft: number
    waterLeft: number
    rationsBurnedToday: number
    waterBurnedToday: number
    supplyWarning?: string
    /** Phase 3: action the policy picked for this day. Absent on legacy traces. */
    action?: Action['kind']
    /** Phase 3: cumulative exhaustion at end of day. Absent if zero. */
    exhaustionLevel?: number
    /** Phase 4: which resupply tier actually fired this day. Absent on no-restore days. */
    resupplyFired?: 'water' | 'rations' | 'full'
  }>
  summary: {
    daysCount: number
    completed: boolean
    finishedReason: 'arrived' | 'water-out' | 'rations-out' | 'no-route' | 'aborted'
    encountersTotal: number
    encountersByType: Record<string, number>
    encountersBySeverity: Record<string, number>
    calendarEventsTotal: number
    rationsLowDay: number | null
    waterLowDay: number | null
    rationsOutDay: number | null
    waterOutDay: number | null
    finalRationsLeft: number
    finalWaterLeft: number
    /** Phase 4: count of nodes on the route where getResupplyTier === 'full'
     * (civilization or caravanserai). Tests the resupply-asymmetry theory: do
     * direct routes geometrically bypass full-restore stops? */
    civStopsOnRoute: number
    /** Phase 4: count of nodes on the route with any non-'none' resupply tier
     * (adds ports + oases on top of civStopsOnRoute). */
    resupplyStopsOnRoute: number
    /** Phase 4: longest km-stretch between full-restore nodes on the route
     * (including route start and end as boundary closers). Probes whether
     * direct-mode routes cluster their full stops near the endpoints, leaving
     * a long mid-route gap that raw stop-count can't surface. */
    maxResupplyGapKm: number
    /** Phase 4: count of days where applyDailyBurn's restore branch actually
     * fired at the 'full' tier (civilization or caravanserai camp). Distinguishes
     * "stop existed on route" (civStopsOnRoute, static) from "stop mechanically
     * helped" (this, dynamic). */
    resupplyFiresFullCount: number
    /** Phase 4: count of days where the restore branch fired at the 'water' tier
     * (oasis or port camp). Tracked separately because water-tier doesn't help
     * the rations budget. */
    resupplyFiresWaterCount: number
    /** Phase 3: which policy drove this run, if any. */
    policy?: PolicyName
  }
}

export function loadGeojson(): Parameters<typeof buildGraph>[0] {
  const here = dirname(fileURLToPath(import.meta.url))
  const path = resolve(here, '../../web/public/veydria-spatial.geojson')
  return JSON.parse(readFileSync(path, 'utf-8'))
}

export function runJourney(inputs: JourneyInputs, graph: Graph): Trace {
  const { route, pivots } = findRouteWithFallback(
    graph,
    inputs.from,
    inputs.to,
    inputs.season,
    inputs.mode,
    inputs.party,
  )

  if (!route) {
    return {
      inputs,
      route: null,
      days: [],
      summary: {
        daysCount: 0,
        completed: false,
        finishedReason: 'no-route',
        encountersTotal: 0,
        encountersByType: {},
        encountersBySeverity: {},
        calendarEventsTotal: 0,
        rationsLowDay: null,
        waterLowDay: null,
        rationsOutDay: null,
        waterOutDay: null,
        finalRationsLeft: inputs.supply.rationsPerPerson,
        finalWaterLeft: inputs.supply.waterPerPerson,
        civStopsOnRoute: 0,
        resupplyStopsOnRoute: 0,
        maxResupplyGapKm: 0,
        resupplyFiresFullCount: 0,
        resupplyFiresWaterCount: 0,
        ...(inputs.policy ? { policy: inputs.policy } : {}),
      },
    }
  }

  let days: JourneyDay[]
  let supply: SupplyDay[]
  let perDayActions: Array<Action['kind']> | undefined
  let outcomeOverride: 'aborted' | undefined

  if (inputs.policy) {
    /* Phase 3: policy-driven stepping. nextDay tracks supply directly so the
     * post-loop computeSupplyTimeline is unnecessary; we still emit days[]
     * and supply[] arrays with the same shape so the trace mapping is uniform. */
    const policyFn = getPolicy(inputs.policy)
    let state = initJourneyState({
      route,
      season: inputs.season,
      mode: inputs.mode,
      edgeBiomes: undefined,
      departureDayOfYear: inputs.depart,
      party: inputs.party,
      supply: inputs.supply,
      graph,
      endId: inputs.to,
      resupplyTierFor: getResupplyTier,
    })
    const collected: JourneyDay[] = []
    const collectedSupply: SupplyDay[] = []
    const actions: Array<Action['kind']> = []
    /* Hard iteration cap: at most 2× the route's day budget to bound runaway
     * loops (rest can in principle extend a journey indefinitely). */
    const safetyMax = (state.totalDays + 1) * 2
    let safety = safetyMax
    while (!state.finished && safety-- > 0) {
      const action = policyFn(state)
      const step = nextDay(state, action)
      if (!step.advanced) {
        /* Reroute returned no-route, or finished mid-flight. Break to avoid spin. */
        break
      }
      if (step.day) collected.push(step.day)
      if (step.supply) collectedSupply.push(step.supply)
      /* Reroute emits no day but should still be recorded in the action log. */
      if (action.kind === 'reroute') actions.push('reroute')
      else if (step.day) actions.push(action.kind)
      state = step.state
    }
    days = collected
    supply = collectedSupply
    perDayActions = actions
    if (state.outcome === 'aborted') outcomeOverride = 'aborted'
  } else {
    /* Legacy continue-only path. Byte-identical output to pre-Phase-3. */
    days = buildDailyBreakdown(
      route,
      inputs.season,
      inputs.mode,
      undefined,
      inputs.depart,
      inputs.party,
    )

    const nameToTier = new Map<string, ResupplyTier>()
    for (const n of route.nodes) {
      nameToTier.set(n.name, getResupplyTier(n.category))
    }
    const dayToTier = new Map<number, ResupplyTier>()
    for (const d of days) {
      let name: string | undefined
      if (d.campLabel.startsWith('Camp at ')) name = d.campLabel.slice('Camp at '.length)
      else if (d.campLabel.startsWith('Arrive at ')) name = d.campLabel.slice('Arrive at '.length)
      if (!name) continue
      const tier = nameToTier.get(name)
      if (tier && tier !== 'none') dayToTier.set(d.dayNum, tier)
    }

    supply = computeSupplyTimeline(
      days,
      inputs.party,
      inputs.supply,
      undefined,
      inputs.season,
      dayToTier.size > 0 ? (dayNum) => dayToTier.get(dayNum) ?? 'none' : undefined,
      inputs.mode,
    )
  }

  const firstWith = (pred: (s: (typeof supply)[number]) => boolean): number | null => {
    const hit = supply.find(pred)
    return hit ? hit.dayNum : null
  }
  const rationsOutDay = firstWith(s => s.rationsLeft <= 0)
  const waterOutDay = firstWith(s => s.waterLeft <= 0)
  const rationsLowDay = firstWith(s => s.rationsLeft <= 2 && s.rationsLeft > 0)
  const waterLowDay = firstWith(s => s.waterLeft <= 2 && s.waterLeft > 0)

  const arrivalDay = days.length
  const ranOutBeforeArrival =
    (rationsOutDay !== null && rationsOutDay < arrivalDay) ||
    (waterOutDay !== null && waterOutDay < arrivalDay)
  const finishedReason: Trace['summary']['finishedReason'] = outcomeOverride === 'aborted'
    ? 'aborted'
    : ranOutBeforeArrival
      ? (waterOutDay !== null && (rationsOutDay === null || waterOutDay <= rationsOutDay)
          ? 'water-out'
          : 'rations-out')
      : 'arrived'

  const encountersByType: Record<string, number> = {}
  const encountersBySeverity: Record<string, number> = {}
  let encountersTotal = 0
  let calendarEventsTotal = 0
  for (const d of days) {
    encountersTotal += d.encounters.length
    for (const e of d.encounters) {
      encountersByType[e.type] = (encountersByType[e.type] || 0) + 1
      encountersBySeverity[e.severity] = (encountersBySeverity[e.severity] || 0) + 1
    }
    calendarEventsTotal += d.calendarEvents?.length ?? 0
  }

  let civStopsOnRoute = 0
  let resupplyStopsOnRoute = 0
  /* Track the longest km-stretch between full-restore nodes. Walk in order,
   * accumulating each inbound edge's km onto a running gap; when the
   * destination node is full-tier, capture-and-reset. After the walk, any
   * trailing gap (route ended without a full node) still counts. */
  let maxResupplyGapKm = 0
  let currentGapKm = 0
  const kmPerSvg = route.totalDistanceSvg > 0 ? route.totalKm / route.totalDistanceSvg : 0
  for (let i = 0; i < route.nodes.length; i++) {
    const tier = getResupplyTier(route.nodes[i].category)
    if (tier === 'full') civStopsOnRoute++
    if (tier !== 'none') resupplyStopsOnRoute++
    if (i > 0) currentGapKm += route.edges[i - 1].distanceSvg * kmPerSvg
    if (tier === 'full') {
      if (currentGapKm > maxResupplyGapKm) maxResupplyGapKm = currentGapKm
      currentGapKm = 0
    }
  }
  if (currentGapKm > maxResupplyGapKm) maxResupplyGapKm = currentGapKm

  /* Phase 4 dynamic probe: count days where applyDailyBurn's restore branch
   * actually fired, split by tier. Sourced from SupplyDay.resupplyFired which
   * applyDailyBurn now echoes alongside the restore. */
  let resupplyFiresFullCount = 0
  let resupplyFiresWaterCount = 0
  for (const s of supply) {
    if (s.resupplyFired === 'full') resupplyFiresFullCount++
    else if (s.resupplyFired === 'water') resupplyFiresWaterCount++
  }

  const tracedDays: Trace['days'] = days.map((d, i) => {
    const row: Trace['days'][number] = {
      dayNum: d.dayNum,
      kmCovered: round(d.kmCovered),
      startLabel: d.startLabel,
      campLabel: d.campLabel,
      weather: d.weather,
      notable: d.notable,
      encounters: d.encounters.map(e => ({
        type: e.type,
        severity: e.severity,
        biome: e.biome,
        beat: e.beat,
      })),
      calendarEvents: (d.calendarEvents ?? []).map(c => ({ name: c.name, civ: (c as { civ?: string }).civ })),
      rationsLeft: round(supply[i].rationsLeft),
      waterLeft: round(supply[i].waterLeft),
      rationsBurnedToday: round(supply[i].rationsBurnedToday),
      waterBurnedToday: round(supply[i].waterBurnedToday),
      supplyWarning: supply[i].warning,
    }
    /* Phase 3: only add policy fields when a policy ran. Preserves
     * byte-identical legacy traces. */
    if (perDayActions) {
      row.action = perDayActions[i]
    }
    if (d.exhaustionLevel !== undefined && d.exhaustionLevel > 0) {
      row.exhaustionLevel = d.exhaustionLevel
    }
    if (supply[i].resupplyFired !== undefined) {
      row.resupplyFired = supply[i].resupplyFired
    }
    return row
  })

  return {
    inputs,
    route: {
      found: true,
      totalKm: round(route.totalKm),
      estimatedDays: round(route.estimatedDays),
      bottlenecks: route.bottlenecks,
      seasonalWarnings: route.seasonalWarnings,
      pivotIds: pivots.map(p => p.id),
      nodeIds: route.nodes.map(n => n.id),
      edgeCount: route.edges.length,
    },
    days: tracedDays,
    summary: {
      daysCount: days.length,
      completed: finishedReason === 'arrived',
      finishedReason,
      encountersTotal,
      encountersByType,
      encountersBySeverity,
      calendarEventsTotal,
      rationsLowDay,
      waterLowDay,
      rationsOutDay,
      waterOutDay,
      finalRationsLeft: round(supply[supply.length - 1]?.rationsLeft ?? inputs.supply.rationsPerPerson),
      finalWaterLeft: round(supply[supply.length - 1]?.waterLeft ?? inputs.supply.waterPerPerson),
      civStopsOnRoute,
      resupplyStopsOnRoute,
      maxResupplyGapKm: round(maxResupplyGapKm),
      resupplyFiresFullCount,
      resupplyFiresWaterCount,
      ...(inputs.policy ? { policy: inputs.policy } : {}),
    },
  }
}

export function buildGraphFromGeojson(): Graph {
  return buildGraph(loadGeojson())
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
