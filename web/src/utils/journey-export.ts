/**
 * journey-export.ts — Build the per-route markdown export.
 *
 * Extracted from JourneyPlanner.handleCopyMarkdown so the same document can be
 * produced for the GM (full) and for players (stripped). The `playerSafe` flag
 * removes GM-only content — encounters, mode-risk/density warnings, per-day
 * encounters, and GM notes — mirroring exactly what the share-mode UI hides.
 */

import {
  getRouteDifficulty,
  isDefaultParty,
  straitAnnotation,
  type JourneyRoute,
  type Season,
  type RouteMode,
  type PartyConfig,
} from './journey-graph'
import { generateEncounters, encounterTypeIcon, encounterSeverityLabel } from './encounters'
import { buildDailyBreakdown } from './journey-days'
import { formatDayOfYear } from './calendar'
import {
  isDefaultSupply,
  computeSupplyTimeline,
  summarizeSupplyPressure,
  type SupplyConfig,
} from './journey-supply'
import { computeModeRiskWarning } from './journey-mode-risk'
import { computeEncounterDensityWarning } from './journey-encounter-density'
import { exportRouteGmNotes, type MapAnnotation } from './annotations'

export function formatDays(days: number): string {
  if (days < 0.5) {
    const hours = Math.round(days * 24)
    return `~${hours} hour${hours !== 1 ? 's' : ''}`
  }
  if (days < 2) {
    return `~${Math.round(days * 10) / 10} day`
  }
  return `~${Math.round(days)} days`
}

export interface BuildRouteMarkdownOptions {
  route: JourneyRoute
  season?: Season
  mode: RouteMode
  edgeBiomes?: (string | undefined)[]
  party: PartyConfig
  supply: SupplyConfig
  departureDayOfYear?: number
  annotations: MapAnnotation[]
  /** Bare URL (no hash) for the "Exported from" footer. */
  sourceUrl: string
  /**
   * When true, strip GM-only sections (encounters, mode-risk/density warnings,
   * per-day encounters, GM notes). Route, bottlenecks, seasonal warnings,
   * supply pressure, and the day-by-day breakdown stay — they are the same
   * facts a player sees in the share-mode UI.
   */
  playerSafe?: boolean
}

/** Assemble the markdown for a single route. Pure — no DOM/clipboard access. */
export function buildRouteMarkdown(opts: BuildRouteMarkdownOptions): string {
  const {
    route,
    season,
    mode,
    edgeBiomes,
    party,
    supply,
    departureDayOfYear,
    annotations,
    sourceUrl,
    playerSafe = false,
  } = opts

  const fromName = route.nodes[0]?.name || 'Unknown'
  const toName = route.nodes[route.nodes.length - 1]?.name || 'Unknown'
  const wpNames = route.nodes.slice(1, -1).map(n => n.name)
  const routeTitle = wpNames.length > 0
    ? `${fromName} → ${wpNames.join(' → ')} → ${toName}`
    : `${fromName} → ${toName}`

  const diff = getRouteDifficulty(route)
  let md = `## Journey: ${routeTitle}\n\n`
  md += `**Distance:** ${Math.round(route.totalKm)} km  \n`
  md += `**Estimated Travel:** ${formatDays(route.estimatedDays)}  \n`
  md += `**Mode:** ${mode}  \n`
  if (!isDefaultParty(party)) {
    const partyBits: string[] = [party.mount]
    if (party.pace !== 'normal') partyBits.push(`${party.pace} pace`)
    partyBits.push(`${party.size} party`)
    if (party.forcedMarch) partyBits.push('forced march')
    md += `**Party:** ${partyBits.join(' · ')}  \n`
  }
  if (!isDefaultSupply(supply)) {
    const supplyBits: string[] = [
      `${supply.rationsPerPerson}d rations`,
      `${supply.waterPerPerson}d water`,
    ]
    if (supply.encumbrance !== 'normal') supplyBits.push(`${supply.encumbrance} load`)
    if (supply.packAnimals !== 'none') supplyBits.push(`pack: ${supply.packAnimals}`)
    md += `**Supply:** ${supplyBits.join(' · ')}  \n`
  }
  md += `**Difficulty:** ${diff.label}  \n`
  if (season) md += `**Season:** ${season}  \n`
  md += `\n### Route\n\n`

  for (let i = 0; i < route.nodes.length; i++) {
    const node = route.nodes[i]
    md += `${i + 1}. **${node.name}** (${node.category.replace('_', ' ')})\n`
    if (i < route.edges.length) {
      const edge = route.edges[i]
      const edgeKm = route.totalDistanceSvg > 0
        ? Math.round(route.totalKm * (edge.distanceSvg / route.totalDistanceSvg))
        : 0
      const edgeDays = edge.segmentDays ? ` · ~${edge.segmentDays.toFixed(1)} days` : ''
      const icon = edge.type === 'trade_route' ? '≡' :
                   edge.type === 'chokepoint' ? '▲' : '→'
      const strait = straitAnnotation(node, route.nodes[i + 1])
      const edgeLabel = strait ? `⚓ ${strait} · ${edge.name}` : edge.name
      md += `   ${icon} ${edgeLabel} (${edge.type.replace('_', '-')}) · ${edgeKm} km${edgeDays}\n`
    }
  }

  const encounters = generateEncounters(route, season, mode, edgeBiomes)
  const allWarnings = [...route.bottlenecks, ...route.seasonalWarnings]
  if (!playerSafe) {
    // Mode-risk and density warnings are GM tuning hints, not player facts.
    const modeRiskWarning = computeModeRiskWarning(mode, supply)
    const densityWarning = computeEncounterDensityWarning(mode, encounters)
    if (modeRiskWarning) allWarnings.push(modeRiskWarning)
    if (densityWarning) allWarnings.push(densityWarning)
  }
  if (allWarnings.length > 0) {
    md += `\n### Warnings\n\n`
    for (const w of allWarnings) {
      md += `[!] ${w}\n`
    }
  }

  if (!playerSafe && encounters.length > 0) {
    md += `\n### Encounters\n\n`
    for (const enc of encounters) {
      const segName = route.edges[enc.segmentIdx]?.name || 'Unknown segment'
      const biomeTag = enc.biome ? ` · ${enc.biome}` : ''
      md += `**${encounterTypeIcon(enc.type)} ${enc.type}** · ${encounterSeverityLabel(enc.severity)}${biomeTag} · *${segName}*\n\n`
      md += `${enc.beat}\n\n`
    }
  }

  const days = buildDailyBreakdown(route, season, mode, undefined, departureDayOfYear, party)
  if (days.length > 0) {
    // Supply pressure — only emit when a threshold is actually crossed.
    const biomeForEdge = edgeBiomes
      ? (e: typeof route.edges[number]) => edgeBiomes[route.edges.indexOf(e)]
      : undefined
    const supplyTimeline = computeSupplyTimeline(days, party, supply, biomeForEdge, season)
    const pressure = summarizeSupplyPressure(supplyTimeline)
    const pressureLines: string[] = []
    if (pressure.rationsLowDay !== null) pressureLines.push(`Rations critical on day ${pressure.rationsLowDay}.`)
    if (pressure.rationsOutDay !== null) pressureLines.push(`Rations exhausted on day ${pressure.rationsOutDay} — forage or turn back.`)
    if (pressure.waterLowDay !== null) pressureLines.push(`Water critical on day ${pressure.waterLowDay}.`)
    if (pressure.waterOutDay !== null) pressureLines.push(`Water exhausted on day ${pressure.waterOutDay} — find water or turn back.`)
    if (pressureLines.length > 0) {
      md += `\n### Supply pressure\n\n`
      for (const l of pressureLines) md += `[!] ${l}\n`
    }

    md += `\n### Day-by-Day\n\n`
    for (const day of days) {
      const doyLabel = day.dayOfYear !== undefined ? ` · ${formatDayOfYear(day.dayOfYear)}` : ''
      md += `**Day ${day.dayNum}**${doyLabel} · ${Math.round(day.kmCovered)} km\n\n`
      md += `- Start: ${day.startLabel}\n`
      md += `- Weather: ${day.weather}\n`
      if (day.calendarEvents && day.calendarEvents.length > 0) {
        for (const ev of day.calendarEvents) {
          const effectLine = ev.effect ? ` — ${ev.effect}` : ''
          md += `- 📅 **${ev.name}** (${ev.type})${effectLine}\n`
        }
      }
      if (day.notable.length > 0) {
        for (const n of day.notable) md += `- Notable: ${n}\n`
      }
      if (!playerSafe && day.encounters.length > 0) {
        for (const enc of day.encounters) {
          const biomeTag = enc.biome ? ` · ${enc.biome}` : ''
          md += `- ${encounterTypeIcon(enc.type)} ${enc.type} (${encounterSeverityLabel(enc.severity)}${biomeTag}): ${enc.beat}\n`
        }
      }
      md += `- Camp: ${day.campLabel}\n\n`
    }
  }

  if (!playerSafe) {
    const gmNotes = exportRouteGmNotes(annotations, route.nodes)
    if (gmNotes) {
      md += gmNotes
    }
  }

  md += `\n---\n*Exported from [Veydria Cartography](${sourceUrl})*`

  return md
}
