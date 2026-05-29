import { useState, useMemo, useRef, useEffect, type ReactNode } from 'react'
import type { GeoJSONCollection } from '../App'
import {
  NodeIcon as NodeIconSvg, IconScroll, IconMountain, IconArrow, IconCompass, IconCalendar,
  IconFlower, IconSun, IconLeafFall, IconSnowflake, IconWarning, IconCloudRain, IconPin,
} from './icons'
import { buildGraph, findRoute, findMultiStopRoute, findRouteWithFallback, findComparisonRoutes, getJourneyNodes, getRouteDifficulty, DEFAULT_PARTY, isDefaultParty, type JourneyNode, type JourneyRoute, type Season, type RouteMode, type ComparisonRoutes, type PartyConfig } from '../utils/journey-graph'
import { generateEncounters, encounterTypeIcon, encounterSeverityLabel, type Encounter } from '../utils/encounters'
import { rollOneOff } from '../utils/encounter-roller'
import { buildDailyBreakdown } from '../utils/journey-days'
import { formatDayOfYear, CALENDAR_EVENT_COLORS, CALENDAR_EVENT_ICONS, type CalendarEventType } from '../utils/calendar'
import { loadSavedJourneys, addSavedJourney, deleteSavedJourney, renameSavedJourney, clearSavedJourneys, type SavedJourney } from '../utils/journey-saved'
import {
  DEFAULT_SUPPLY,
  isDefaultSupply,
  computeSupplyTimeline,
  summarizeSupplyPressure,
  type SupplyConfig,
} from '../utils/journey-supply'
import PartyConfigBlock from './journey-planner/PartyConfig'
import SupplyConfigBlock from './journey-planner/SupplyConfig'
import JourneyDaysTab from './journey-planner/JourneyDaysTab'
import { computeModeRiskWarning } from '../utils/journey-mode-risk'
import { computeEncounterDensityWarning } from '../utils/journey-encounter-density'
import { computeRecommendedMode } from '../utils/journey-mode-recommend'
import { formatDistance } from '../utils/measure'
import { buildHash } from '../utils/url-hash'
import type { MapAnnotation } from '../utils/annotations'
import { exportRouteGmNotes } from '../utils/annotations'
import { getRouteHexLabels, getBiomeAtPoint } from '../utils/hex-grid'
import { DEFAULT_HEX_SIZE } from '../utils/hex-overlay'

interface JourneyPlannerProps {
  geojson: GeoJSONCollection
  active: boolean
  defaultStartId?: string
  defaultEndId?: string
  onClose: () => void
  onRouteComputed: (route: JourneyRoute | null) => void
  annotations?: MapAnnotation[]
  onFlyToAnnotation?: (annotation: MapAnnotation) => void
  onSelectFeatureById?: (featureId: string) => void
  onExportAnnotations?: () => void
  shareMode?: boolean
  hexSize?: number
  /** Dominant biome of the currently selected hex, if any. Passed to the
   *  encounter roller so biome-specific beats surface in the right terrain. */
  selectedBiome?: string | null
  /** Initial season (typically seeded from URL hash on first mount). */
  defaultSeason?: Season
  /** Optional callback fired whenever the season selection changes. */
  onSeasonChange?: (season: Season | undefined) => void
  /** Initial mode (typically seeded from URL hash on first mount). */
  defaultMode?: RouteMode
  /** Optional callback fired whenever the route mode changes. */
  onModeChange?: (mode: RouteMode) => void
  onComparisonRoutesComputed?: (routes: ComparisonRoutes) => void
  /** Initial party config (typically seeded from URL hash on first mount). */
  defaultParty?: PartyConfig
  /** Optional callback fired whenever the party config changes. */
  onPartyChange?: (party: PartyConfig) => void
  /** Initial supply config (typically seeded from URL hash on first mount). */
  defaultSupply?: SupplyConfig
  /** Optional callback fired whenever the supply config changes. */
  onSupplyChange?: (supply: SupplyConfig) => void
  /** Fog-of-war: stamp every hex the current route touches as explored. */
  onMarkRouteExplored?: (hexLabels: string[]) => void
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

function NodeIcon({ category }: { category: string }) {
  return <span className="journey-node-icon"><NodeIconSvg category={category} /></span>
}

// Picker label format: "<Civ> · <category>" when the node carries a civ tag,
// or just "<category>" otherwise. Disambiguates same-name ports (Tavakh-Qarat
// vs Tavakh-Rubāṭ) without needing a separate UI affordance — F7 audit fix.
function formatNodeCategory(n: JourneyNode): string {
  const cat = n.category.replace('_', ' ')
  if (!n.civ) return cat
  // Render the civ slug as a display name: "ngaru_bon" → "Ngaru Bon".
  const civLabel = n.civ.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  return `${civLabel} · ${cat}`
}

// F7 audit fix: annotate the Halkar Straits when an edge crosses to/from
// Oravan from any mainland civ. Oravan is the only archipelago in the
// canon, so any cross-civ edge touching it is a sea crossing of the same
// strait.
function straitAnnotation(from: JourneyNode | undefined, to: JourneyNode | undefined): string | null {
  if (!from || !to) return null
  // Oravan is the only archipelago, so an edge with EXACTLY ONE Oravan
  // endpoint is a sea crossing of the Halkar Straits — true even when the
  // other endpoint is an untagged contested node (e.g. the mid-strait
  // sandbar Tavakh-Rubāṭ). Keying on civ presence here would miss that
  // crossing now that contested sites are deliberately civ-less (F5).
  const fromOravan = from.civ === 'oravan'
  const toOravan = to.civ === 'oravan'
  if (fromOravan === toOravan) return null
  return 'Halkar Straits'
}

export default function JourneyPlanner({ geojson, active, defaultStartId, defaultEndId, onClose, onRouteComputed, annotations = [], onFlyToAnnotation, onSelectFeatureById, onExportAnnotations, shareMode = false, hexSize = DEFAULT_HEX_SIZE, selectedBiome = null, defaultSeason, onSeasonChange, defaultMode, onModeChange, onComparisonRoutesComputed, defaultParty, onPartyChange, defaultSupply, onSupplyChange, onMarkRouteExplored }: JourneyPlannerProps) {
  const [startId, setStartId] = useState('')
  const [endId, setEndId] = useState('')
  const [route, setRoute] = useState<JourneyRoute | null>(null)
  const [startSearch, setStartSearch] = useState('')
  const [endSearch, setEndSearch] = useState('')
  const [startOpen, setStartOpen] = useState(false)
  const [endOpen, setEndOpen] = useState(false)
  const [exportToast, setExportToast] = useState<string | null>(null)
  const [season, setSeason] = useState<Season | undefined>(defaultSeason)
  const [mode, setMode] = useState<RouteMode>(defaultMode ?? 'direct')
  const [party, setParty] = useState<PartyConfig>(defaultParty ?? DEFAULT_PARTY)
  const [partyOpen, setPartyOpen] = useState(false)
  const [supply, setSupply] = useState<SupplyConfig>(defaultSupply ?? DEFAULT_SUPPLY)
  const [supplyOpen, setSupplyOpen] = useState(false)
  const [waypoints, setWaypoints] = useState<string[]>([])
  const [wpSearch, setWpSearch] = useState('')
  const [wpOpenIdx, setWpOpenIdx] = useState<number | null>(null)
  const [savedJourneys, setSavedJourneys] = useState<SavedJourney[]>(loadSavedJourneys)
  const [savedOpen, setSavedOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [routeTab, setRouteTab] = useState<'route' | 'days' | 'encounters'>('route')
  const [attempted, setAttempted] = useState(false)
  const [autoPivots, setAutoPivots] = useState<JourneyNode[]>([])
  const [annotationsOpen, setAnnotationsOpen] = useState(false)
  const [oneOffRolls, setOneOffRolls] = useState<Encounter[]>([])
  const [selectedSegmentIdx, setSelectedSegmentIdx] = useState(0)
  const [compareMode, setCompareMode] = useState(false)
  const [comparisonRoutes, setComparisonRoutes] = useState<ComparisonRoutes>({ direct: null, safest: null, cheapest: null })
  const [departureDayOfYear, setDepartureDayOfYear] = useState<number | undefined>(undefined)
  const [highlightCrisisEvents, setHighlightCrisisEvents] = useState(false)
  // Reset impromptu rolls and segment selection whenever the route identity
  // changes — they're mid-session state bound to a specific trip.
  const routeSig = route ? route.nodes.map(n => n.id).join('|') : ''
  useEffect(() => { setOneOffRolls([]); setSelectedSegmentIdx(0) }, [routeSig])
  const startRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const wpRefs = useRef<(HTMLDivElement | null)[]>([])
  const exportToastTimeoutRef = useRef<number | null>(null)
  const didAutoComputeRef = useRef(false)

  const nodes = useMemo(() => getJourneyNodes(geojson), [geojson])
  const graph = useMemo(() => buildGraph(geojson), [geojson])
  const routeHexLabels = useMemo(() => {
    if (!route || route.nodes.length === 0) return []
    return getRouteHexLabels(route.nodes, hexSize)
  }, [route, hexSize])

  const edgeBiomes = useMemo(() => {
    if (!route) return undefined
    return route.edges.map(edge => {
      const fromNode = route.nodes.find(n => n.id === edge.from)
      const toNode = route.nodes.find(n => n.id === edge.to)
      if (!fromNode || !toNode) return undefined
      const mx = (fromNode.x + toNode.x) / 2
      const my = (fromNode.y + toNode.y) / 2
      return getBiomeAtPoint(mx, my, geojson.features) || undefined
    })
  }, [route, geojson])

  const SEASONS: { key: Season; label: string; icon: ReactNode }[] = [
    { key: 'spring', label: 'Spring', icon: <IconFlower /> },
    { key: 'summer', label: 'Summer', icon: <IconSun /> },
    { key: 'autumn', label: 'Autumn', icon: <IconLeafFall /> },
    { key: 'winter', label: 'Winter', icon: <IconSnowflake /> },
  ]

  const MODES: { key: RouteMode; label: string; desc: string }[] = [
    { key: 'direct', label: 'Direct', desc: 'Shortest distance' },
    { key: 'fastest', label: 'Fastest', desc: 'Favour trade routes' },
    { key: 'safest', label: 'Safest', desc: 'Avoid chokepoints' },
    { key: 'cheapest', label: 'Cheapest', desc: 'Minimise tolls' },
  ]

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (startRef.current && !startRef.current.contains(e.target as Node)) setStartOpen(false)
      if (endRef.current && !endRef.current.contains(e.target as Node)) setEndOpen(false)
      for (let i = 0; i < wpRefs.current.length; i++) {
        const ref = wpRefs.current[i]
        if (ref && !ref.contains(e.target as Node)) {
          setWpOpenIdx(prev => prev === i ? null : prev)
        }
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Cleanup export toast timeout
  useEffect(() => {
    return () => {
      if (exportToastTimeoutRef.current) clearTimeout(exportToastTimeoutRef.current)
    }
  }, [])

  // Auto-compute route from URL defaults on first mount
  useEffect(() => {
    if (!active || didAutoComputeRef.current) return
    if (defaultStartId && defaultEndId && nodes.some(n => n.id === defaultStartId) && nodes.some(n => n.id === defaultEndId)) {
      didAutoComputeRef.current = true
      setStartId(defaultStartId)
      setEndId(defaultEndId)
      const result = findRoute(graph, defaultStartId, defaultEndId, undefined, 'direct', party)
      setRoute(result)
      onRouteComputed(result)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, defaultStartId, defaultEndId, nodes, graph, onRouteComputed])

  // Auto-recompute when stops/season/mode change. Debounced so a fast
  // dropdown selection doesn't churn through partial states.
  useEffect(() => {
    if (!active || !startId || !endId) return
    const t = window.setTimeout(() => {
      const stops = [startId, ...waypoints.filter(Boolean), endId]
      let result: JourneyRoute | null
      let pivots: JourneyNode[] = []
      if (stops.length > 2) {
        result = findMultiStopRoute(graph, stops, season, mode, party)
      } else {
        const fb = findRouteWithFallback(graph, startId, endId, season, mode, party)
        result = fb.route
        pivots = fb.pivots
      }
      setRoute(result)
      setAutoPivots(pivots)
      setAttempted(true)
      onRouteComputed(result)

      // Comparison routes: only for simple A→B (no waypoints) and when enabled
      if (compareMode && stops.length === 2) {
        const comparisons = findComparisonRoutes(graph, startId, endId, season, party)
        setComparisonRoutes(comparisons)
        onComparisonRoutesComputed?.(comparisons)
      } else if (!compareMode) {
        setComparisonRoutes({ direct: null, safest: null, cheapest: null })
        onComparisonRoutesComputed?.({ direct: null, safest: null, cheapest: null })
      }
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, startId, endId, waypoints, season, mode, party, graph, compareMode])

  // Reset route when closed
  useEffect(() => {
    if (!active) {
      didAutoComputeRef.current = false
      setRoute(null)
      onRouteComputed(null)
      setComparisonRoutes({ direct: null, safest: null, cheapest: null })
      onComparisonRoutesComputed?.({ direct: null, safest: null, cheapest: null })
      setCompareMode(false)
      setStartId('')
      setEndId('')
      setStartSearch('')
      setEndSearch('')
      setWaypoints([])
      setWpSearch('')
      setWpOpenIdx(null)
      setSeason(undefined)
      setMode('direct')
      setParty(DEFAULT_PARTY)
      setPartyOpen(false)
      setExportToast(null)
      setDepartureDayOfYear(undefined)
    }
  }, [active, onRouteComputed])

  const filteredStart = useMemo(() => {
    const q = startSearch.toLowerCase()
    return nodes.filter(n => n.name.toLowerCase().includes(q) || n.category.includes(q))
  }, [nodes, startSearch])

  const filteredEnd = useMemo(() => {
    const q = endSearch.toLowerCase()
    return nodes.filter(n => n.name.toLowerCase().includes(q) || n.category.includes(q))
  }, [nodes, endSearch])

  const startNode = nodes.find(n => n.id === startId)
  const endNode = nodes.find(n => n.id === endId)

  function computeRoute(s?: Season, m?: RouteMode, p: PartyConfig = party) {
    if (!startId || !endId) return
    const stops = [startId, ...waypoints.filter(Boolean), endId]
    let result: JourneyRoute | null
    let pivots: JourneyNode[] = []
    if (stops.length > 2) {
      // User specified waypoints — honour them exactly.
      result = findMultiStopRoute(graph, stops, s, m, p)
    } else {
      const fb = findRouteWithFallback(graph, startId, endId, s, m, p)
      result = fb.route
      pivots = fb.pivots
    }
    setRoute(result)
    setAutoPivots(pivots)
    setAttempted(true)
    onRouteComputed(result)
  }

  function handleFindRoute() {
    computeRoute(season, mode)
  }

  function handleClear() {
    setRoute(null)
    onRouteComputed(null)
    setStartId('')
    setEndId('')
    setStartSearch('')
    setEndSearch('')
    setWaypoints([])
    setWpSearch('')
    setWpOpenIdx(null)
    setAttempted(false)
    setAutoPivots([])
    setDepartureDayOfYear(undefined)
  }

  function handleAddWaypoint() {
    setWaypoints(prev => [...prev, ''])
    setWpOpenIdx(waypoints.length)
    setWpSearch('')
  }

  function handleRemoveWaypoint(idx: number) {
    setWaypoints(prev => prev.filter((_, i) => i !== idx))
    setRoute(null)
    onRouteComputed(null)
    setAttempted(false)
    setAutoPivots([])
  }

  function handleSetWaypoint(idx: number, nodeId: string) {
    setWaypoints(prev => {
      const next = [...prev]
      next[idx] = nodeId
      return next
    })
    setWpOpenIdx(null)
    setWpSearch('')
    setRoute(null)
    onRouteComputed(null)
    setAttempted(false)
    setAutoPivots([])
  }

  function showExportToast(msg: string) {
    setExportToast(msg)
    if (exportToastTimeoutRef.current) clearTimeout(exportToastTimeoutRef.current)
    exportToastTimeoutRef.current = window.setTimeout(() => setExportToast(null), 2000)
  }

  async function handleCopyLink() {
    if (!route) return
    const url = new URL(window.location.href)
    url.hash = buildHash({
      journeyFrom: route.nodes[0]?.id,
      journeyTo: route.nodes[route.nodes.length - 1]?.id,
      partyPace: party.pace,
      partyMount: party.mount,
      partySize: party.size,
      partyForce: party.forcedMarch,
      supplyRations: supply.rationsPerPerson,
      supplyWater: supply.waterPerPerson,
      supplyEnc: supply.encumbrance,
      supplyPack: supply.packAnimals,
    })
    try {
      await navigator.clipboard.writeText(url.toString())
      showExportToast('Journey link copied')
    } catch {
      showExportToast('Failed to copy link')
    }
  }

  async function handleCopyJSON() {
    if (!route) return
    const payload = {
      journey: {
        from: route.nodes[0]?.name,
        to: route.nodes[route.nodes.length - 1]?.name,
        distanceKm: Math.round(route.totalKm),
        estimatedDays: Math.round(route.estimatedDays),
        path: route.nodes.map(n => n.name),
        segments: route.edges.map(e => ({
          name: e.name,
          type: e.type,
          bottleneck: e.bottleneck,
          seasonal: e.seasonal,
        })),
        warnings: [...route.bottlenecks, ...route.seasonalWarnings],
      },
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      showExportToast('Journey JSON copied')
    } catch {
      showExportToast('Failed to copy JSON')
    }
  }

  async function handleCopyMarkdown() {
    if (!route) return
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
    const modeRiskWarning = computeModeRiskWarning(mode, supply)
    const densityWarning = computeEncounterDensityWarning(mode, encounters)
    const allWarnings = [...route.bottlenecks, ...route.seasonalWarnings]
    if (modeRiskWarning) allWarnings.push(modeRiskWarning)
    if (densityWarning) allWarnings.push(densityWarning)
    if (allWarnings.length > 0) {
      md += `\n### Warnings\n\n`
      for (const w of allWarnings) {
        md += `[!] ${w}\n`
      }
    }

    if (encounters.length > 0) {
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
        if (day.encounters.length > 0) {
          for (const enc of day.encounters) {
            const biomeTag = enc.biome ? ` · ${enc.biome}` : ''
            md += `- ${encounterTypeIcon(enc.type)} ${enc.type} (${encounterSeverityLabel(enc.severity)}${biomeTag}): ${enc.beat}\n`
          }
        }
        md += `- Camp: ${day.campLabel}\n\n`
      }
    }

    const gmNotes = exportRouteGmNotes(annotations, route.nodes)
    if (gmNotes) {
      md += gmNotes
    }

    md += `\n---\n*Exported from [Veydria Cartography](${window.location.href.split('#')[0]})*`

    try {
      await navigator.clipboard.writeText(md)
      showExportToast('Markdown copied to clipboard')
    } catch {
      showExportToast('Failed to copy markdown')
    }
  }

  function handleSwap() {
    const tmp = startId
    setStartId(endId)
    setEndId(tmp)
    setStartSearch(endNode?.name || '')
    setEndSearch(startNode?.name || '')
    setRoute(null)
    onRouteComputed(null)
    setAttempted(false)
    setAutoPivots([])
  }

  function handleSeasonChange(newSeason: Season | undefined) {
    setSeason(newSeason)
    onSeasonChange?.(newSeason)
    if (startId && endId) {
      computeRoute(newSeason, mode)
    }
  }

  function handleModeChange(newMode: RouteMode) {
    setMode(newMode)
    onModeChange?.(newMode)
    if (startId && endId) {
      computeRoute(season, newMode)
    }
  }

  function handlePartyChange(next: PartyConfig) {
    setParty(next)
    onPartyChange?.(next)
    if (startId && endId) {
      computeRoute(season, mode, next)
    }
  }

  function handleSupplyChange(next: SupplyConfig) {
    // Supply does not affect routing — no recompute needed.
    setSupply(next)
    onSupplyChange?.(next)
  }

  function handleSaveRoute() {
    if (!route) return
    const fromName = route.nodes[0]?.name || ''
    const toName = route.nodes[route.nodes.length - 1]?.name || ''
    const waypoints = route.nodes.slice(1, -1).map(n => n.name)
    const defaultName = waypoints.length > 0
      ? `${fromName} → ${waypoints.join(' → ')} → ${toName}`
      : `${fromName} → ${toName}`
    const entry: SavedJourney = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      savedAt: Date.now(),
      name: defaultName,
      fromName,
      toName,
      waypoints,
      season,
      mode,
      totalKm: route.totalKm,
      estimatedDays: route.estimatedDays,
      nodeIds: route.nodes.map(n => n.id),
      edgeCount: route.edges.length,
      bottlenecks: route.bottlenecks,
      seasonalWarnings: route.seasonalWarnings,
      party,
      supply,
    }
    const updated = addSavedJourney(entry)
    setSavedJourneys(updated)
    showExportToast('Saved to My journeys')
  }

  function handleMarkRouteExplored() {
    if (!route || !onMarkRouteExplored) return
    const labels = getRouteHexLabels(route.nodes, hexSize)
    if (labels.length === 0) return
    onMarkRouteExplored(labels)
    showExportToast(`Marked ${labels.length} hex${labels.length === 1 ? '' : 'es'} explored`)
  }

  function handleLoadSaved(entry: SavedJourney) {
    if (entry.nodeIds.length < 2) return
    const [start, ...rest] = entry.nodeIds
    const end = rest[rest.length - 1]
    const wps = rest.slice(0, -1)
    setStartId(start)
    setEndId(end)
    setWaypoints(wps)
    setSeason(entry.season)
    setMode(entry.mode)
    const loadedParty = entry.party ?? DEFAULT_PARTY
    setParty(loadedParty)
    onPartyChange?.(loadedParty)
    const loadedSupply = entry.supply ?? DEFAULT_SUPPLY
    setSupply(loadedSupply)
    onSupplyChange?.(loadedSupply)
    setStartSearch('')
    setEndSearch('')
    setWpSearch('')
    setWpOpenIdx(null)
    const result = wps.length > 0
      ? findMultiStopRoute(graph, entry.nodeIds, entry.season, entry.mode, loadedParty)
      : findRoute(graph, start, end, entry.season, entry.mode, loadedParty)
    setRoute(result)
    onRouteComputed(result)
    showExportToast('Journey restored')
  }

  function handleDeleteSaved(id: string) {
    const updated = deleteSavedJourney(id)
    setSavedJourneys(updated)
  }

  function handleClearSaved() {
    const updated = clearSavedJourneys()
    setSavedJourneys(updated)
    showExportToast('My journeys cleared')
  }

  if (!active) return null

  return (
    <div className="journey-planner">
      <div className="journey-planner-header">
        <h3 className="journey-planner-title">
          <span className="journey-planner-icon"><IconCompass /></span>
          Journey Planner
        </h3>
        <div className="journey-header-actions">
          <button
            className={`journey-history-toggle ${savedOpen ? 'active' : ''}`}
            onClick={() => setSavedOpen(!savedOpen)}
            title="My journeys"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
            <span>{savedJourneys.length}</span>
          </button>
          <button className="journey-planner-close" onClick={onClose} title="Close (Esc)">×</button>
        </div>
      </div>

      {/* My journeys panel */}
      {savedOpen && (
        <div className="journey-history-panel">
          <div className="journey-history-header">
            <span className="journey-history-title">My journeys</span>
            {savedJourneys.length > 0 && (
              <button className="journey-history-clear" onClick={handleClearSaved}>Clear all</button>
            )}
          </div>
          {savedJourneys.length === 0 && (
            <div className="journey-history-empty">No saved journeys yet. Compute a route and click Save.</div>
          )}
          <div className="journey-history-list">
            {savedJourneys.map(entry => (
              <div key={entry.id} className="journey-history-item">
                <div className="journey-history-info">
                  {renamingId === entry.id ? (
                    <input
                      className="journey-history-name-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => {
                        setSavedJourneys(renameSavedJourney(entry.id, renameValue))
                        setRenamingId(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          setSavedJourneys(renameSavedJourney(entry.id, renameValue))
                          setRenamingId(null)
                        }
                        if (e.key === 'Escape') {
                          setRenamingId(null)
                        }
                      }}
                      autoFocus
                    />
                  ) : (
                    <div
                      className="journey-history-name"
                      onClick={() => {
                        setRenamingId(entry.id)
                        setRenameValue(entry.name || '')
                      }}
                      title="Click to rename"
                    >
                      {entry.name || `${entry.fromName} → ${entry.waypoints.length > 0 ? entry.waypoints.join(' → ') + ' → ' : ''}${entry.toName}`}
                    </div>
                  )}
                  <div className="journey-history-meta">
                    {entry.season && <span className="journey-history-season">{entry.season}</span>}
                    <span className="journey-history-mode">{entry.mode}</span>
                    <span>{Math.round(entry.totalKm)} km</span>
                    <span>~{formatDays(entry.estimatedDays)}</span>
                  </div>
                </div>
                <div className="journey-history-actions">
                  <button className="journey-history-load" onClick={() => handleLoadSaved(entry)} title="Load journey">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M12 3l9 9-9 9"/></svg>
                  </button>
                  <button className="journey-history-delete" onClick={() => handleDeleteSaved(entry.id)} title="Delete">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="journey-planner-body">
        {/* Season selector */}
        <div className="journey-seasons">
          <span className="journey-seasons-label">Season</span>
          <div className="journey-seasons-row">
            <button
              className={`journey-season-btn ${season === undefined ? 'active' : ''}`}
              onClick={() => handleSeasonChange(undefined)}
              title="All seasons"
            >
              <IconCalendar /> Any
            </button>
            {SEASONS.map(s => (
              <button
                key={s.key}
                className={`journey-season-btn ${season === s.key ? 'active' : ''}`}
                onClick={() => handleSeasonChange(s.key)}
                title={s.label}
              >
                {s.icon} {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Route mode selector — recommends `safest` (badge on the recommended
            button) when Mode Risk or Encounter Density predicates fire. GM-only;
            shareMode users see the bare selector. */}
        {(() => {
          const recEncounters = (!shareMode && route)
            ? generateEncounters(route, season, mode, edgeBiomes)
            : []
          const rec = !shareMode ? computeRecommendedMode(mode, supply, recEncounters) : null
          return (
            <div className="journey-modes">
              <span className="journey-modes-label">Route priority</span>
              <div className="journey-modes-row">
                {MODES.map(m => {
                  const isRecommended = rec !== null && rec.mode === m.key && rec.mode !== mode
                  return (
                    <button
                      key={m.key}
                      className={`journey-mode-btn ${mode === m.key ? 'active' : ''} ${isRecommended ? 'recommended' : ''}`}
                      onClick={() => handleModeChange(m.key)}
                      title={isRecommended ? `Recommended: ${rec!.reason}` : m.desc}
                    >
                      {m.label}
                      {isRecommended && <span className="journey-mode-rec-badge">Recommended</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })()}

        <PartyConfigBlock
          party={party}
          open={partyOpen}
          onToggleOpen={() => setPartyOpen(o => !o)}
          onChange={handlePartyChange}
        />

        <SupplyConfigBlock
          supply={supply}
          open={supplyOpen}
          onToggleOpen={() => setSupplyOpen(o => !o)}
          onChange={handleSupplyChange}
        />

        {/* Compare routes toggle */}
        {!shareMode && waypoints.length === 0 && (
          <div className="journey-compare-toggle">
            <button
              className={`journey-compare-btn ${compareMode ? 'active' : ''}`}
              onClick={() => setCompareMode(prev => !prev)}
              title="Overlay Direct, Safest, and Cheapest routes on the map"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 20V10M12 20V4M6 20v-6" />
              </svg>
              <span>Compare routes</span>
            </button>
          </div>
        )}

        {/* Departure day-of-year */}
        {!shareMode && (
          <div className="journey-departure">
            <label className="journey-departure-label">Departure</label>
            <div className="journey-departure-row">
              <input
                type="range"
                min={1}
                max={365}
                value={departureDayOfYear ?? 1}
                onChange={(e) => setDepartureDayOfYear(Number(e.target.value))}
                className="journey-departure-slider"
                disabled={departureDayOfYear === undefined}
              />
              <button
                className={`journey-departure-toggle ${departureDayOfYear !== undefined ? 'active' : ''}`}
                onClick={() => setDepartureDayOfYear(prev => prev === undefined ? 120 : undefined)}
                title={departureDayOfYear !== undefined ? 'Clear departure date' : 'Set departure date for calendar events'}
              >
                {departureDayOfYear !== undefined ? formatDayOfYear(departureDayOfYear) : 'Any'}
              </button>
            </div>
          </div>
        )}

        {/* Calendar event legend */}
        {departureDayOfYear !== undefined && (
          <div className="journey-calendar-legend">
            <div className="journey-calendar-legend-header">
              <span className="journey-calendar-legend-label">Event key</span>
              <button
                type="button"
                className={`journey-calendar-legend-toggle ${highlightCrisisEvents ? 'active' : ''}`}
                onClick={() => setHighlightCrisisEvents(v => !v)}
                title="Highlight events that are crisis leverage windows"
              >
                ⚡ Crisis
              </button>
            </div>
            <div className="journey-calendar-legend-grid">
              {(Object.keys(CALENDAR_EVENT_COLORS) as CalendarEventType[]).map(type => (
                <div key={type} className="journey-calendar-legend-item" title={type}>
                  <span className="journey-calendar-legend-dot" style={{ backgroundColor: CALENDAR_EVENT_COLORS[type] }} />
                  <span className="journey-calendar-legend-icon">{CALENDAR_EVENT_ICONS[type]}</span>
                  <span className="journey-calendar-legend-name">{type}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Start selector */}
        <div className="journey-field" ref={startRef}>
          <label className="journey-field-label">From</label>
          <div className="journey-dropdown">
            <button
              className="journey-dropdown-trigger"
              onClick={() => setStartOpen(!startOpen)}
            >
              {startNode ? (
                <>
                  <NodeIcon category={startNode.category} />
                  <span>{startNode.name}</span>
                  <span className="journey-dropdown-cat">{startNode.category.replace('_', ' ')}</span>
                </>
              ) : (
                <span className="journey-dropdown-placeholder">Select starting point...</span>
              )}
              <span className={`journey-dropdown-arrow ${startOpen ? 'open' : ''}`}>▾</span>
            </button>
            {startOpen && (
              <div className="journey-dropdown-menu">
                <input
                  type="text"
                  className="journey-dropdown-search"
                  placeholder="Search..."
                  value={startSearch}
                  onChange={(e) => setStartSearch(e.target.value)}
                  autoFocus
                />
                <div className="journey-dropdown-list">
                  {filteredStart.map(n => (
                    <button
                      key={n.id}
                      className={`journey-dropdown-item ${n.id === startId ? 'selected' : ''}`}
                      onClick={() => {
                        setStartId(n.id)
                        setStartSearch('')
                        setStartOpen(false)
                        setRoute(null)
                        onRouteComputed(null)
                        setAttempted(false)
                        setAutoPivots([])
                      }}
                    >
                      <NodeIcon category={n.category} />
                      <span className="journey-dropdown-item-name">{n.name}</span>
                      <span className="journey-dropdown-item-cat">{formatNodeCategory(n)}</span>
                    </button>
                  ))}
                  {filteredStart.length === 0 && (
                    <div className="journey-dropdown-empty">No matches</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Swap button */}
        <div className="journey-swap-row">
          <button
            className="journey-swap-btn"
            onClick={handleSwap}
            disabled={!startId && !endId}
            title="Swap start and end"
          >
            ⇅
          </button>
        </div>

        {/* End selector */}
        <div className="journey-field" ref={endRef}>
          <label className="journey-field-label">To</label>
          <div className="journey-dropdown">
            <button
              className="journey-dropdown-trigger"
              onClick={() => setEndOpen(!endOpen)}
            >
              {endNode ? (
                <>
                  <NodeIcon category={endNode.category} />
                  <span>{endNode.name}</span>
                  <span className="journey-dropdown-cat">{endNode.category.replace('_', ' ')}</span>
                </>
              ) : (
                <span className="journey-dropdown-placeholder">Select destination...</span>
              )}
              <span className={`journey-dropdown-arrow ${endOpen ? 'open' : ''}`}>▾</span>
            </button>
            {endOpen && (
              <div className="journey-dropdown-menu">
                <input
                  type="text"
                  className="journey-dropdown-search"
                  placeholder="Search..."
                  value={endSearch}
                  onChange={(e) => setEndSearch(e.target.value)}
                  autoFocus
                />
                <div className="journey-dropdown-list">
                  {filteredEnd.map(n => (
                    <button
                      key={n.id}
                      className={`journey-dropdown-item ${n.id === endId ? 'selected' : ''}`}
                      onClick={() => {
                        setEndId(n.id)
                        setEndSearch('')
                        setEndOpen(false)
                        setRoute(null)
                        onRouteComputed(null)
                        setAttempted(false)
                        setAutoPivots([])
                      }}
                    >
                      <NodeIcon category={n.category} />
                      <span className="journey-dropdown-item-name">{n.name}</span>
                      <span className="journey-dropdown-item-cat">{formatNodeCategory(n)}</span>
                    </button>
                  ))}
                  {filteredEnd.length === 0 && (
                    <div className="journey-dropdown-empty">No matches</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Waypoints */}
        {waypoints.map((wpId, idx) => {
          const wpNode = nodes.find(n => n.id === wpId)
          const isOpen = wpOpenIdx === idx
          const filteredWp = wpSearch.toLowerCase()
            ? nodes.filter(n => (n.name.toLowerCase().includes(wpSearch.toLowerCase()) || n.category.includes(wpSearch.toLowerCase())) && n.id !== startId && n.id !== endId && !waypoints.slice(0, idx).includes(n.id))
            : nodes.filter(n => n.id !== startId && n.id !== endId && !waypoints.slice(0, idx).includes(n.id))
          return (
            <div className="journey-field" key={idx} ref={el => { wpRefs.current[idx] = el }}>
              <div className="journey-field-header">
                <label className="journey-field-label">Via {idx + 1}</label>
                <button className="journey-wp-remove" onClick={() => handleRemoveWaypoint(idx)} title="Remove waypoint">×</button>
              </div>
              <div className="journey-dropdown">
                <button className="journey-dropdown-trigger" onClick={() => setWpOpenIdx(isOpen ? null : idx)}>
                  {wpNode ? (
                    <>
                      <NodeIcon category={wpNode.category} />
                      <span>{wpNode.name}</span>
                      <span className="journey-dropdown-cat">{wpNode.category.replace('_', ' ')}</span>
                    </>
                  ) : (
                    <span className="journey-dropdown-placeholder">Select waypoint...</span>
                  )}
                  <span className={`journey-dropdown-arrow ${isOpen ? 'open' : ''}`}>▾</span>
                </button>
                {isOpen && (
                  <div className="journey-dropdown-menu">
                    <input
                      type="text"
                      className="journey-dropdown-search"
                      placeholder="Search..."
                      value={wpSearch}
                      onChange={(e) => setWpSearch(e.target.value)}
                      autoFocus
                    />
                    <div className="journey-dropdown-list">
                      {filteredWp.map(n => (
                        <button
                          key={n.id}
                          className={`journey-dropdown-item ${n.id === wpId ? 'selected' : ''}`}
                          onClick={() => handleSetWaypoint(idx, n.id)}
                        >
                          <NodeIcon category={n.category} />
                          <span className="journey-dropdown-item-name">{n.name}</span>
                          <span className="journey-dropdown-item-cat">{formatNodeCategory(n)}</span>
                        </button>
                      ))}
                      {filteredWp.length === 0 && <div className="journey-dropdown-empty">No matches</div>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        <button
          className="journey-add-wp"
          onClick={handleAddWaypoint}
          disabled={!startId || !endId || waypoints.length >= 4}
        >
          + Add waypoint
        </button>

        {/* Actions */}
        <div className="journey-actions">
          <button
            className="journey-btn journey-btn--primary"
            onClick={handleFindRoute}
            disabled={!startId || !endId}
          >
            Find Route
          </button>
          <button
            className="journey-btn"
            onClick={handleClear}
            disabled={!startId && !endId && !route}
          >
            Clear
          </button>
        </div>

        {/* Route results */}
        {route && (
          <div className="journey-route">
            <div className="journey-route-actions">
              <button className="journey-export-btn" onClick={handleSaveRoute} title="Save to history">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                Save
              </button>
              {onMarkRouteExplored && (
                <button
                  className="journey-export-btn"
                  onClick={handleMarkRouteExplored}
                  title="Stamp every hex this route touches as explored (fog of war)"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>
                  Mark explored
                </button>
              )}
              <button className="journey-export-btn" onClick={handleCopyLink} title="Copy shareable link">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                Link
              </button>
              <button className="journey-export-btn" onClick={handleCopyMarkdown} title="Copy as markdown">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                Markdown
              </button>
              <button className="journey-export-btn" onClick={handleCopyJSON} title="Copy route JSON">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
                JSON
              </button>
            </div>
            <div className="journey-route-stats">
              <div className="journey-stat">
                <span className="journey-stat-label">Distance</span>
                <span className="journey-stat-value">{formatDistance(route.totalDistanceSvg)}</span>
              </div>
              <div className="journey-stat">
                <span className="journey-stat-label">Est. Travel</span>
                <span className="journey-stat-value">{formatDays(route.estimatedDays)}</span>
              </div>
              <div className="journey-stat">
                <span className="journey-stat-label">Segments</span>
                <span className="journey-stat-value">{route.edges.length}</span>
              </div>
            </div>
            <div className="journey-difficulty">
              {(() => {
                const diff = getRouteDifficulty(route)
                return <span className={`journey-difficulty-badge ${diff.class}`}>{diff.label}</span>
              })()}
            </div>

            {/* Comparison stats: side-by-side Direct / Safest / Cheapest */}
            {compareMode && comparisonRoutes && (
              <div className="journey-comparison-stats">
                {(() => {
                  const entries = [
                    { key: 'direct' as const, label: 'Direct', color: '#4a9a3a', route: comparisonRoutes.direct },
                    { key: 'safest' as const, label: 'Safest', color: '#3a7ca5', route: comparisonRoutes.safest },
                    { key: 'cheapest' as const, label: 'Cheapest', color: '#c4a862', route: comparisonRoutes.cheapest },
                  ]
                  const valid = entries.filter(e => e.route)
                  const bestDistance = valid.length > 0 ? Math.min(...valid.map(e => e.route!.totalDistanceSvg)) : Infinity
                  const bestDays = valid.length > 0 ? Math.min(...valid.map(e => e.route!.estimatedDays)) : Infinity
                  const bestSegments = valid.length > 0 ? Math.min(...valid.map(e => e.route!.edges.length)) : Infinity
                  return entries.map(({ key, label, color, route: cr }) => (
                    <div
                      key={key}
                      className={`journey-comparison-card ${key === mode ? 'journey-comparison-active' : ''}`}
                      style={{ '--comparison-color': color } as React.CSSProperties}
                      onClick={() => {
                        if (cr && key !== mode) {
                          setMode(key as RouteMode)
                          onModeChange?.(key as RouteMode)
                        }
                      }}
                      title={cr ? `Click to switch to ${label} route` : 'No route found'}
                    >
                      <div className="journey-comparison-card-header">
                        <span className="journey-comparison-dot" style={{ backgroundColor: color }} />
                        <span className="journey-comparison-label">{label}</span>
                        {key === mode && <span className="journey-comparison-current">active</span>}
                      </div>
                      {cr ? (
                        <div className="journey-comparison-card-body">
                          <div className="journey-comparison-stat">
                            <span className="journey-comparison-stat-label">Distance</span>
                            <span className="journey-comparison-stat-value">
                              {formatDistance(cr.totalDistanceSvg)}
                              {cr.totalDistanceSvg === bestDistance && (
                                <span className="journey-comparison-trophy" title="Shortest distance">★</span>
                              )}
                            </span>
                          </div>
                          <div className="journey-comparison-stat">
                            <span className="journey-comparison-stat-label">Travel</span>
                            <span className="journey-comparison-stat-value">
                              {formatDays(cr.estimatedDays)}
                              {cr.estimatedDays === bestDays && (
                                <span className="journey-comparison-trophy" title="Fastest route">★</span>
                              )}
                            </span>
                          </div>
                          <div className="journey-comparison-stat">
                            <span className="journey-comparison-stat-label">Segments</span>
                            <span className="journey-comparison-stat-value">
                              {cr.edges.length}
                              {cr.edges.length === bestSegments && (
                                <span className="journey-comparison-trophy" title="Fewest segments">★</span>
                              )}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="journey-comparison-no-route">No route</div>
                      )}
                    </div>
                  ))
                })()}
              </div>
            )}

            {routeHexLabels.length > 0 && (
              <div className="journey-route-hexes">
                <span className="journey-route-hexes-label">Hex path</span>
                <span className="journey-route-hexes-value">{routeHexLabels.join(' → ')}</span>
                <span className="journey-route-hexes-count">{routeHexLabels.length} hex{routeHexLabels.length !== 1 ? 'es' : ''}</span>
              </div>
            )}

            {autoPivots.length > 0 && (
              <div className="journey-auto-pivot">
                No direct route — auto-routed via {autoPivots.map(p => p.name).join(' and ')}.
              </div>
            )}

            {/* Tabs */}
            <div className="journey-tabs">
              <button
                className={`journey-tab ${routeTab === 'route' ? 'active' : ''}`}
                onClick={() => setRouteTab('route')}
              >
                Route
              </button>
              <button
                className={`journey-tab ${routeTab === 'days' ? 'active' : ''}`}
                onClick={() => setRouteTab('days')}
              >
                Days
              </button>
              {!shareMode && (
                <button
                  className={`journey-tab ${routeTab === 'encounters' ? 'active' : ''}`}
                  onClick={() => setRouteTab('encounters')}
                >
                  Encounters
                </button>
              )}
            </div>

            {routeTab === 'route' && (
              <>
            {/* Bottlenecks */}
            {route.bottlenecks.length > 0 && (
              <div className="journey-bottlenecks">
                <div className="journey-bottlenecks-title"><IconWarning /> Bottlenecks & Risks</div>
                {route.bottlenecks.map((b, i) => (
                  <div key={i} className="journey-bottleneck">{b}</div>
                ))}
              </div>
            )}

            {route.bottlenecks.length === 0 && (
              <div className="journey-no-bottlenecks">✓ No major bottlenecks on this route</div>
            )}

            {/* Seasonal warnings */}
            {route.seasonalWarnings.length > 0 && (
              <div className="journey-bottlenecks" style={{ background: 'rgba(232, 200, 64, 0.06)', borderColor: 'rgba(232, 200, 64, 0.25)' }}>
                <div className="journey-bottlenecks-title" style={{ color: 'var(--color-port)' }}><IconCloudRain /> Seasonal Restrictions</div>
                {route.seasonalWarnings.map((w, i) => (
                  <div key={i} className="journey-bottleneck">{w}</div>
                ))}
              </div>
            )}

            {/* Mode-risk warning (direct + caravan empirical risk) — GM only, hidden in share mode */}
            {!shareMode && (() => {
              const modeRisk = computeModeRiskWarning(mode, supply)
              if (!modeRisk) return null
              return (
                <div className="journey-bottlenecks" style={{ background: 'rgba(232, 200, 64, 0.06)', borderColor: 'rgba(232, 200, 64, 0.25)' }}>
                  <div className="journey-bottlenecks-title" style={{ color: 'var(--color-port)' }}><IconWarning /> Mode Risk</div>
                  <div className="journey-bottleneck">{modeRisk}</div>
                </div>
              )
            })()}

            {/* Encounter-density warning (sibling to mode risk) — GM only, hidden in share mode */}
            {!shareMode && (() => {
              const densityEncounters = generateEncounters(route, season, mode, edgeBiomes)
              const densityWarning = computeEncounterDensityWarning(mode, densityEncounters)
              if (!densityWarning) return null
              return (
                <div className="journey-bottlenecks" style={{ background: 'rgba(232, 200, 64, 0.06)', borderColor: 'rgba(232, 200, 64, 0.25)' }}>
                  <div className="journey-bottlenecks-title" style={{ color: 'var(--color-port)' }}><IconWarning /> Encounter Density</div>
                  <div className="journey-bottleneck">{densityWarning}</div>
                </div>
              )
            })()}

                {/* Path timeline */}
            <div className="journey-route-path">
              <div className="journey-path-line" />
              {route.nodes.map((node, i) => (
                <div key={node.id} className="journey-path-node">
                  <div className={`journey-path-dot ${i === 0 ? 'start' : i === route.nodes.length - 1 ? 'end' : 'waypoint'}`} />
                  <div className="journey-path-info">
                    <span className="journey-path-name">
                      <NodeIcon category={node.category} />
                      {node.name}
                    </span>
                    {i < route.edges.length && (() => {
                      const strait = straitAnnotation(node, route.nodes[i + 1])
                      return (
                        <span className="journey-path-edge">
                          {route.edges[i].type === 'trade_route' && <IconScroll />}
                          {route.edges[i].type === 'chokepoint' && <IconMountain />}
                          {(route.edges[i].type === 'intra_civ' || route.edges[i].type === 'civ_link') && <IconArrow />}
                          {' '}{strait ? `⚓ ${strait} · ${route.edges[i].name}` : route.edges[i].name}
                        </span>
                      )
                    })()}
                  </div>
                </div>
              ))}
            </div>
              </>
            )}

            {routeTab === 'days' && (
              <JourneyDaysTab
                route={route}
                season={season}
                mode={mode}
                edgeBiomes={edgeBiomes}
                departureDayOfYear={departureDayOfYear}
                party={party}
                supply={supply}
                shareMode={shareMode}
                highlightCrisisEvents={highlightCrisisEvents}
                onSelectSegment={(idx) => setSelectedSegmentIdx(idx)}
                onSwitchToEncounters={() => setRouteTab('encounters')}
              />
            )}

            {!shareMode && routeTab === 'encounters' && (
              <div className="journey-encounters">
                {(() => {
                  const encounters = generateEncounters(route, season, mode, edgeBiomes)
                  const handleRoll = () => {
                    if (route.edges.length === 0) return
                    const edge = route.edges[selectedSegmentIdx] ?? route.edges[0]
                    const edgeType = edge.type === 'civ_link' ? 'intra_civ' : edge.type as 'trade_route' | 'chokepoint' | 'intra_civ'
                    const biome = edgeBiomes?.[selectedSegmentIdx] || selectedBiome || undefined
                    const rolled = rollOneOff({ edgeType, season, biome })
                    if (rolled) setOneOffRolls(prev => [rolled, ...prev])
                  }
                  const activeEdge = route.edges[selectedSegmentIdx] ?? route.edges[0]
                  return (
                    <>
                      <div className="journey-encounters-header">
                        <span className="journey-encounters-count">
                          {encounters.length} beat{encounters.length !== 1 ? 's' : ''}
                          {oneOffRolls.length > 0 && ` + ${oneOffRolls.length} impromptu`}
                        </span>
                        <button
                          type="button"
                          className="journey-encounter-roll-btn"
                          onClick={handleRoll}
                          title={`Roll for ${activeEdge?.name ?? 'current segment'} (${activeEdge?.type.replace('_', '-') ?? 'unknown'})`}
                        >
                          ⟳ Roll one-off
                        </button>
                      </div>
                      {route.edges.length > 1 && (
                        <div className="journey-segment-chips">
                          {route.edges.map((edge, i) => (
                            <button
                              key={i}
                              type="button"
                              className={`journey-segment-chip ${i === selectedSegmentIdx ? 'active' : ''}`}
                              onClick={() => setSelectedSegmentIdx(i)}
                              title={`${edge.name} (${edge.type.replace('_', '-')})`}
                            >
                              {edge.type === 'trade_route' && <IconScroll />}
                              {edge.type === 'chokepoint' && <IconMountain />}
                              {(edge.type === 'intra_civ' || edge.type === 'civ_link') && <IconArrow />}
                              <span className="journey-segment-chip-label">{edge.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {oneOffRolls.map((enc, i) => (
                        <div key={`oneoff-${oneOffRolls.length - i}`} className={`journey-encounter journey-encounter--impromptu ${enc.severity}`}>
                          <div className="journey-encounter-meta">
                            <span className="journey-encounter-icon">{encounterTypeIcon(enc.type)}</span>
                            <span className="journey-encounter-type">{enc.type}</span>
                            <span className={`journey-encounter-severity ${enc.severity}`}>{encounterSeverityLabel(enc.severity)}</span>
                            {enc.biome && <span className="journey-encounter-biome">{enc.biome}</span>}
                            <span className="journey-encounter-segment journey-encounter-segment--impromptu">Impromptu</span>
                          </div>
                          <div className="journey-encounter-beat">{enc.beat}</div>
                        </div>
                      ))}
                      {encounters.length === 0 && oneOffRolls.length === 0 && (
                        <div className="journey-encounters-empty">No encounters generated. Try Roll one-off.</div>
                      )}
                      {encounters.map((enc, i) => (
                        <div key={i} className={`journey-encounter ${enc.severity}`}>
                          <div className="journey-encounter-meta">
                            <span className="journey-encounter-icon">{encounterTypeIcon(enc.type)}</span>
                            <span className="journey-encounter-type">{enc.type}</span>
                            <span className={`journey-encounter-severity ${enc.severity}`}>{encounterSeverityLabel(enc.severity)}</span>
                            {enc.biome && <span className="journey-encounter-biome">{enc.biome}</span>}
                            {route.edges[enc.segmentIdx] && (
                              <span className="journey-encounter-segment">{route.edges[enc.segmentIdx].name}</span>
                            )}
                          </div>
                          <div className="journey-encounter-beat">{enc.beat}</div>
                        </div>
                      ))}
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        )}

        {attempted && route === null && startId && endId && (
          <div className="journey-no-route">
            No route found between these locations, even after trying intermediate civilizations. Add a manual waypoint to bridge the gap.
          </div>
        )}

        {/* Annotations list — GM only */}
        {!shareMode && <div className="journey-annotations-section">
          <button
            className={`journey-annotations-toggle ${annotationsOpen ? 'active' : ''}`}
            onClick={() => setAnnotationsOpen(!annotationsOpen)}
          >
            <span className="journey-annotations-icon"><IconPin /></span>
            <span className="journey-annotations-title">Campaign Notes</span>
            <span className="journey-annotations-count">{annotations.length}</span>
            <span className={`journey-annotations-chevron ${annotationsOpen ? 'open' : ''}`}>▾</span>
          </button>
          {annotationsOpen && (
            <div className="journey-annotations-panel">
              {annotations.length === 0 && (
                <div className="journey-annotations-empty">
                  No pins yet. Click the Pin button in the header, then click the map to drop one.
                </div>
              )}
              {annotations.length > 0 && (
                <>
                  <div className="journey-annotations-list">
                    {annotations.map(ann => (
                      <button
                        key={ann.id}
                        className="journey-annotation-item"
                        onClick={() => {
                          onFlyToAnnotation?.(ann)
                          if (ann.featureId) onSelectFeatureById?.(ann.featureId)
                        }}
                        title={ann.featureName ? `Fly to pin · linked to ${ann.featureName}` : 'Fly to pin'}
                      >
                        <span
                          className="journey-annotation-dot"
                          style={{ background: ann.color }}
                        />
                        <span className="journey-annotation-label">{ann.label}</span>
                        {ann.featureName && (
                          <span className="journey-annotation-linked">Linked: {ann.featureName}</span>
                        )}
                        {ann.body && (
                          <span className="journey-annotation-snippet">
                            {ann.body.slice(0, 40)}{ann.body.length > 40 ? '…' : ''}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  {onExportAnnotations && (
                    <button
                      className="journey-annotation-export"
                      onClick={onExportAnnotations}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                      </svg>
                      Export Notes
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>}

        {/* Export toast */}
        {exportToast && (
          <div className="journey-export-toast">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <span>{exportToast}</span>
          </div>
        )}
      </div>
    </div>
  )
}
