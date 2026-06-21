/**
 * campaign-log.ts — Assemble a full campaign log markdown document
 *
 * Bundles active journey, saved journeys, pins, and hex notes into a single
 * downloadable `.md` file for session prep or archiving.
 */

import type { JourneyRoute, Season, RouteMode, PartyConfig, JourneyEdge } from './journey-graph'
import { getRouteDifficulty, isDefaultParty, describeParty } from './journey-graph'
import { buildDailyBreakdown } from './journey-days'
import { generateEncounters, encounterTypeIcon, encounterSeverityLabel } from './encounters'
import { listPartyNames, journeysForParty, type SavedJourney } from './journey-saved'
import type { MapAnnotation } from './annotations'
import { hasCrisis, formatCrisisRef } from './calendar'
import type { SupplyConfig } from './journey-supply'
import {
  computeSupplyTimeline,
  isDefaultSupply,
  describeSupply,
  summarizeSupplyPressure,
} from './journey-supply'
import { saveTextFile, type FileExportResult } from '../persistence/file-export'

export interface CampaignLogInput {
  activeJourney?: {
    route: JourneyRoute
    season?: Season
    mode: RouteMode
    edgeBiomes?: (string | undefined)[]
    party?: PartyConfig
    supply?: SupplyConfig
  }
  savedJourneys: SavedJourney[]
  annotations: MapAnnotation[]
  featureNotes?: { featureId: string; note: string }[]
  /**
   * When true, produce a player-safe log: strips encounters, per-day encounters,
   * crisis-leverage refs, and all GM annotations (campaign-note pins, feature
   * notes, hex notes). Route facts, bottlenecks, seasonal warnings, supply
   * pressure, and the day-by-day breakdown remain.
   */
  playerSafe?: boolean
}

function formatDays(days: number): string {
  if (days < 0.5) {
    const hours = Math.round(days * 24)
    return `~${hours} hour${hours !== 1 ? 's' : ''}`
  }
  if (days < 2) {
    return `~${Math.round(days * 10) / 10} day`
  }
  return `~${Math.round(days)} days`
}

function baseUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.href.split('#')[0]
  }
  return 'https://veydria.com'
}

/**
 * Export a single journey as markdown.
 *
 * Extracted from JourneyPlanner so it can be reused in campaign logs.
 * Does NOT include the trailing "Exported from" footer — callers add that
 * if they want it.
 */
export function exportJourneyMarkdown(
  route: JourneyRoute,
  season?: Season,
  mode: RouteMode = 'direct',
  edgeBiomes?: (string | undefined)[],
  party?: PartyConfig,
  supply?: SupplyConfig,
  playerSafe = false
): string {
  const fromName = route.nodes[0]?.name || 'Unknown'
  const toName = route.nodes[route.nodes.length - 1]?.name || 'Unknown'
  const wpNames = route.nodes.slice(1, -1).map(n => n.name)
  const routeTitle = wpNames.length > 0
    ? `${fromName} → ${wpNames.join(' → ')} → ${toName}`
    : `${fromName} → ${toName}`

  const diff = getRouteDifficulty(route)
  let md = `### Journey: ${routeTitle}\n\n`
  md += `**Distance:** ${Math.round(route.totalKm)} km  \n`
  md += `**Estimated Travel:** ${formatDays(route.estimatedDays)}  \n`
  md += `**Mode:** ${mode}  \n`
  if (party && !isDefaultParty(party)) {
    md += `**Party:** ${describeParty(party)}  \n`
  }
  if (supply && !isDefaultSupply(supply)) {
    md += `**Supply:** ${describeSupply(supply)}  \n`
  }
  md += `**Difficulty:** ${diff.label}  \n`
  if (season) md += `**Season:** ${season}  \n`
  md += `\n#### Route\n\n`

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
      md += `   ${icon} ${edge.name} (${edge.type.replace('_', '-')}) · ${edgeKm} km${edgeDays}\n`
    }
  }

  const allWarnings = [...route.bottlenecks, ...route.seasonalWarnings]
  if (allWarnings.length > 0) {
    md += `\n#### Warnings\n\n`
    for (const w of allWarnings) {
      md += `[!] ${w}\n`
    }
  }

  const encounters = generateEncounters(route, season, mode, edgeBiomes)
  if (!playerSafe && encounters.length > 0) {
    md += `\n#### Encounters\n\n`
    for (const enc of encounters) {
      const segName = route.edges[enc.segmentIdx]?.name || 'Unknown segment'
      const biomeTag = enc.biome ? ` · ${enc.biome}` : ''
      md += `**${encounterTypeIcon(enc.type)} ${enc.type}** · ${encounterSeverityLabel(enc.severity)}${biomeTag} · *${segName}*\n\n`
      md += `${enc.beat}\n\n`
    }
  }

  const days = buildDailyBreakdown(route, season, mode, undefined, undefined, party)

  // Supply pressure subsection — only when supply is configured and a threshold is crossed.
  if (supply && days.length > 0 && party) {
    const biomeForEdge = edgeBiomes
      ? (e: JourneyEdge) => edgeBiomes[route.edges.indexOf(e)]
      : undefined
    const timeline = computeSupplyTimeline(days, party, supply, biomeForEdge, season, undefined, mode)
    const pressure = summarizeSupplyPressure(timeline)
    const lines: string[] = []
    if (pressure.rationsLowDay !== null) lines.push(`Rations critical on day ${pressure.rationsLowDay}.`)
    if (pressure.rationsOutDay !== null) lines.push(`Rations exhausted on day ${pressure.rationsOutDay} — forage or turn back.`)
    if (pressure.waterLowDay !== null) lines.push(`Water critical on day ${pressure.waterLowDay}.`)
    if (pressure.waterOutDay !== null) lines.push(`Water exhausted on day ${pressure.waterOutDay} — find water or turn back.`)
    if (lines.length > 0) {
      md += `\n#### Supply pressure\n\n`
      for (const l of lines) md += `[!] ${l}\n`
    }
  }

  if (days.length > 0) {
    md += `\n#### Day-by-Day\n\n`
    for (const day of days) {
      md += `**Day ${day.dayNum}** · ${Math.round(day.kmCovered)} km\n\n`
      md += `- Start: ${day.startLabel}\n`
      md += `- Weather: ${day.weather}\n`
      if (day.notable.length > 0) {
        for (const n of day.notable) md += `- Notable: ${n}\n`
      }
      if (day.calendarEvents && day.calendarEvents.length > 0) {
        for (const ev of day.calendarEvents) {
          md += `- 📅 **${ev.name}** (${ev.type})`
          if (ev.effect) md += ` — ${ev.effect}`
          // Crisis "leverage" refs are GM plot hooks — keep them out of player exports.
          if (!playerSafe && hasCrisis(ev) && ev.crises) {
            md += ` — ⚡ Leverage: ${ev.crises.map(formatCrisisRef).join(', ')}`
          }
          md += '\n'
        }
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

  return md
}

/**
 * Generate a full campaign-log markdown string.
 */
export function generateCampaignLog(input: CampaignLogInput): string {
  const { activeJourney, savedJourneys, annotations, featureNotes, playerSafe = false } = input
  let md = `# Veydria Campaign Log\n\n`
  md += `*Generated on ${new Date().toLocaleDateString()} from [Veydria Cartography](${baseUrl()})*\n\n`
  md += `---\n\n`

  if (activeJourney) {
    md += `## Active Journey\n\n`
    md += exportJourneyMarkdown(
      activeJourney.route,
      activeJourney.season,
      activeJourney.mode,
      activeJourney.edgeBiomes,
      activeJourney.party,
      activeJourney.supply,
      playerSafe
    )
    md += `\n---\n\n`
  }

  if (savedJourneys.length > 0) {
    md += `## Saved Journeys (${savedJourneys.length})\n\n`
    // Group by party name (Tier 2c). Groups ordered by most-recent save; each
    // group's journeys keep their stored order (most-recent first). Legacy
    // entries with no partyName fold into "Main party".
    for (const partyName of listPartyNames(savedJourneys)) {
      const group = journeysForParty(savedJourneys, partyName)
      md += `### ${partyName}\n\n`
      for (let i = 0; i < group.length; i++) {
        const sj = group[i]
        md += `#### ${i + 1}. ${sj.name || `${sj.fromName} → ${sj.toName}`}\n\n`
        md += `- **Distance:** ${Math.round(sj.totalKm)} km · **Travel:** ${formatDays(sj.estimatedDays)} · **Mode:** ${sj.mode}`
        if (sj.season) md += ` · **Season:** ${sj.season}`
        if (sj.party && !isDefaultParty(sj.party)) md += ` · **Party:** ${describeParty(sj.party)}`
        if (sj.supply && !isDefaultSupply(sj.supply)) md += ` · **Supply:** ${describeSupply(sj.supply)}`
        md += `\n`
        if (sj.waypoints.length > 0) {
          md += `- **Path:** ${sj.fromName} → ${sj.waypoints.join(' → ')} → ${sj.toName}\n`
        } else {
          md += `- **Path:** ${sj.fromName} → ${sj.toName}\n`
        }
        if (sj.bottlenecks.length > 0) {
          md += `- **Bottlenecks:** ${sj.bottlenecks.join('; ')}\n`
        }
        if (sj.seasonalWarnings.length > 0) {
          md += `- **Seasonal warnings:** ${sj.seasonalWarnings.join('; ')}\n`
        }
        md += `\n`
      }
    }
    md += `---\n\n`
  }

  // GM annotations (pins, feature notes, hex notes) are never in player exports.
  // Annotations excluding hex notes
  const pins = playerSafe ? [] : annotations.filter(a => !a.hexLabel)
  if (pins.length > 0) {
    md += `## Campaign Notes (${pins.length} pin${pins.length !== 1 ? 's' : ''})\n\n`
    for (const a of pins) {
      md += `### ${a.label}\n`
      if (a.featureName) md += `*Linked: ${a.featureName}*\n`
      md += `*SVG: (${Math.round(a.x)}, ${Math.round(a.y)})*\n`
      md += `\n`
      if (a.body) md += `${a.body}\n`
      md += `\n---\n\n`
    }
  }

  // Feature notes
  if (!playerSafe && featureNotes && featureNotes.length > 0) {
    md += `## Feature Notes\n\n`
    for (const { featureId, note } of featureNotes) {
      md += `### ${featureId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}\n\n`
      md += `${note}\n\n`
    }
    md += `---\n\n`
  }

  // Hex notes grouped by hex label
  const hexNotes = playerSafe ? [] : annotations.filter(a => a.hexLabel)
  if (hexNotes.length > 0) {
    md += `## Hex Notes\n\n`
    const byHex = new Map<string, MapAnnotation[]>()
    for (const a of hexNotes) {
      if (!a.hexLabel) continue
      const list = byHex.get(a.hexLabel) || []
      list.push(a)
      byHex.set(a.hexLabel, list)
    }
    for (const [hexLabel, notes] of byHex) {
      md += `### Hex ${hexLabel}\n\n`
      for (const a of notes) {
        md += `**${a.label}**`
        if (a.body) md += ` — ${a.body}`
        md += `\n\n`
      }
    }
    md += `---\n\n`
  }

  md += `*Exported from Veydria Cartography*\n`
  return md
}

/**
 * Generate the campaign log and save it — browser download on web, native save
 * dialog on desktop (WebView2's `<a download>` is inert). See `file-export.ts`.
 */
export async function downloadCampaignLog(input: CampaignLogInput): Promise<FileExportResult> {
  const md = generateCampaignLog(input)
  const date = new Date().toISOString().slice(0, 10)
  return saveTextFile(`veydria-campaign-log-${date}.md`, md, 'text/markdown', {
    name: 'Markdown',
    extensions: ['md'],
  })
}
