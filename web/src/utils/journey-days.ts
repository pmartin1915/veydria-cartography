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

import type { JourneyRoute, JourneyEdge, JourneyNode, Season, RouteMode } from './journey-graph'
import { generateEncounters, type Encounter } from './encounters'
import type { CalendarEvent } from './calendar'
import { getEventsForDay } from './calendar'

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

function notableForDay(
  edgesInDay: { edge: JourneyEdge; portion: number }[],
  dayNum: number,
  totalDays: number
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
  if (dayNum === 1) out.unshift('Departure day.')
  if (dayNum === totalDays) out.push('Arrival day.')
  return out
}

/* ─── Public API ─── */

export function buildDailyBreakdown(
  route: JourneyRoute,
  season?: Season,
  mode: RouteMode = 'direct',
  edgeBiomes?: (string | undefined)[],
  departureDayOfYear?: number
): JourneyDay[] {
  if (!route.edges.length || route.estimatedDays <= 0) return []

  const totalDays = Math.max(1, Math.ceil(route.estimatedDays))
  const sig = route.nodes.map(n => n.id).join('|') + '#' + (season || 'any') + '#' + mode + '#days'
  const seed = djb2Hash(sig)

  // Pre-bucket encounters by their edge's midpoint day.
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
    const day = Math.min(totalDays, edgeMidpointDay[enc.segmentIdx] || 1)
    if (!encountersByDay.has(day)) encountersByDay.set(day, [])
    encountersByDay.get(day)!.push(enc)
  }

  // Pre-compute edges traversed within each day (including partial edges).
  const edgesByDay: Map<number, { edge: JourneyEdge; portion: number }[]> = new Map()
  acc = 0
  for (let i = 0; i < route.edges.length; i++) {
    const ed = route.edges[i].segmentDays || 0
    const startT = acc
    const endT = acc + ed
    acc = endT

    const firstDay = Math.max(1, Math.ceil(startT + 0.001))
    const lastDay = Math.min(totalDays, Math.ceil(endT))
    if (firstDay > lastDay) {
      // Edge entirely in a single day; assign to its midpoint day
      const d = edgeMidpointDay[i]
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
      const list = edgesByDay.get(d) || []
      list.push({ edge: route.edges[i], portion })
      edgesByDay.set(d, list)
    }
  }

  const totalKm = route.totalKm
  const days: JourneyDay[] = []
  for (let d = 1; d <= totalDays; d++) {
    const rng = mulberry32(seed + d * 7919)
    const edgesInDay = edgesByDay.get(d) || []
    const kmCovered = edgesInDay.reduce((sum, { edge, portion }) => {
      const edgeKm = route.totalDistanceSvg > 0
        ? totalKm * (edge.distanceSvg / route.totalDistanceSvg)
        : 0
      return sum + edgeKm * portion
    }, 0)

    // Start label = where dawn finds the party. For day 1 this is the
    // origin node; otherwise it's wherever the prior day ended.
    let startLabel: string
    if (d === 1) {
      startLabel = `Depart ${route.nodes[0].name}`
    } else {
      const prevPos = locateAtDay(route.edges, d - 1)
      startLabel = `Resume from ${campLabelAt(route.nodes, route.edges, prevPos.edgeIdx, prevPos.t).replace(/^Camp (?:at|on the) /, '')}`
    }

    let campLabel: string
    if (d === totalDays) {
      campLabel = `Arrive at ${route.nodes[route.nodes.length - 1].name}`
    } else {
      const pos = locateAtDay(route.edges, d)
      campLabel = campLabelAt(route.nodes, route.edges, pos.edgeIdx, pos.t)
    }

    const day: JourneyDay = {
      dayNum: d,
      kmCovered,
      startLabel,
      campLabel,
      weather: rollWeather(rng, season),
      encounters: encountersByDay.get(d) || [],
      notable: notableForDay(edgesInDay, d, totalDays),
      edgesTraversed: edgesInDay,
    }
    if (departureDayOfYear !== undefined && departureDayOfYear > 0) {
      const doy = ((departureDayOfYear - 1 + d - 1) % 365) + 1
      day.dayOfYear = doy
      day.calendarEvents = getEventsForDay(doy)
    }
    days.push(day)
  }

  return days
}
