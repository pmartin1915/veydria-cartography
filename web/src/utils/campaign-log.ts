/**
 * campaign-log.ts — Assemble a full campaign log markdown document
 *
 * Bundles active journey, saved journeys, pins, and hex notes into a single
 * downloadable `.md` file for session prep or archiving.
 */

import type { JourneyRoute, Season, RouteMode } from './journey-graph'
import { getRouteDifficulty } from './journey-graph'
import { buildDailyBreakdown } from './journey-days'
import { generateEncounters, encounterTypeIcon, encounterSeverityLabel } from './encounters'
import type { SavedJourney } from './journey-saved'
import type { MapAnnotation } from './annotations'
import { hasCrisis, formatCrisisRef } from './calendar'

export interface CampaignLogInput {
  activeJourney?: {
    route: JourneyRoute
    season?: Season
    mode: RouteMode
    edgeBiomes?: (string | undefined)[]
  }
  savedJourneys: SavedJourney[]
  annotations: MapAnnotation[]
  featureNotes?: { featureId: string; note: string }[]
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
  edgeBiomes?: (string | undefined)[]
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
  if (encounters.length > 0) {
    md += `\n#### Encounters\n\n`
    for (const enc of encounters) {
      const segName = route.edges[enc.segmentIdx]?.name || 'Unknown segment'
      const biomeTag = enc.biome ? ` · ${enc.biome}` : ''
      md += `**${encounterTypeIcon(enc.type)} ${enc.type}** · ${encounterSeverityLabel(enc.severity)}${biomeTag} · *${segName}*\n\n`
      md += `${enc.beat}\n\n`
    }
  }

  const days = buildDailyBreakdown(route, season, mode)
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
          if (hasCrisis(ev) && ev.crises) {
            md += ` — ⚡ Leverage: ${ev.crises.map(formatCrisisRef).join(', ')}`
          }
          md += '\n'
        }
      }
      if (day.encounters.length > 0) {
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
  const { activeJourney, savedJourneys, annotations, featureNotes } = input
  let md = `# Veydria Campaign Log\n\n`
  md += `*Generated on ${new Date().toLocaleDateString()} from [Veydria Cartography](${baseUrl()})*\n\n`
  md += `---\n\n`

  if (activeJourney) {
    md += `## Active Journey\n\n`
    md += exportJourneyMarkdown(
      activeJourney.route,
      activeJourney.season,
      activeJourney.mode,
      activeJourney.edgeBiomes
    )
    md += `\n---\n\n`
  }

  if (savedJourneys.length > 0) {
    md += `## Saved Journeys (${savedJourneys.length})\n\n`
    for (let i = 0; i < savedJourneys.length; i++) {
      const sj = savedJourneys[i]
      md += `### ${i + 1}. ${sj.name || `${sj.fromName} → ${sj.toName}`}\n\n`
      md += `- **Distance:** ${Math.round(sj.totalKm)} km · **Travel:** ${formatDays(sj.estimatedDays)} · **Mode:** ${sj.mode}`
      if (sj.season) md += ` · **Season:** ${sj.season}`
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
    md += `---\n\n`
  }

  // Annotations excluding hex notes
  const pins = annotations.filter(a => !a.hexLabel)
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
  if (featureNotes && featureNotes.length > 0) {
    md += `## Feature Notes\n\n`
    for (const { featureId, note } of featureNotes) {
      md += `### ${featureId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}\n\n`
      md += `${note}\n\n`
    }
    md += `---\n\n`
  }

  // Hex notes grouped by hex label
  const hexNotes = annotations.filter(a => a.hexLabel)
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
 * Generate the campaign log and trigger a browser download.
 */
export function downloadCampaignLog(input: CampaignLogInput): void {
  const md = generateCampaignLog(input)
  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const date = new Date().toISOString().slice(0, 10)
  a.download = `veydria-campaign-log-${date}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
