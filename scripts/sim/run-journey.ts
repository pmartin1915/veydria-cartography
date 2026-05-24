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
import { buildDailyBreakdown } from '../../web/src/utils/journey-days'
import { computeSupplyTimeline, type SupplyConfig } from '../../web/src/utils/journey-supply'

export type Graph = ReturnType<typeof buildGraph>

export interface JourneyInputs {
  from: string
  to: string
  season?: Season
  mode: RouteMode
  depart?: number
  party: PartyConfig
  supply: SupplyConfig
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
  }>
  summary: {
    daysCount: number
    completed: boolean
    finishedReason: 'arrived' | 'water-out' | 'rations-out' | 'no-route'
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
      },
    }
  }

  const days = buildDailyBreakdown(
    route,
    inputs.season,
    inputs.mode,
    undefined, // edgeBiomes — arid penalty stays unapplied (matches Phase 1)
    inputs.depart,
    inputs.party,
  )

  const supply = computeSupplyTimeline(
    days,
    inputs.party,
    inputs.supply,
    undefined,
    inputs.season,
  )

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
  const finishedReason: Trace['summary']['finishedReason'] = ranOutBeforeArrival
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

  const tracedDays: Trace['days'] = days.map((d, i) => ({
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
  }))

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
    },
  }
}

export function buildGraphFromGeojson(): Graph {
  return buildGraph(loadGeojson())
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
