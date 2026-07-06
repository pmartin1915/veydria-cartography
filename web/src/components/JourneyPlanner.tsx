import { useState, useMemo, useRef, useEffect, useReducer, useCallback } from 'react'
import type { GeoJSONCollection } from '../App'
import { IconCompass, IconPin } from './icons'
import TourOverlay from './TourOverlay'
import { tourReducer, isTourCompleted, JOURNEY_TUTORIAL_KEY, MAIN_TOUR_KEY, PASSAGE_TUTORIAL_KEY, type TourStep, type TourState, type TourAction } from '../utils/tour'
import { buildGraph, findRoute, findMultiStopRoute, findRouteWithFallback, findComparisonRoutes, getJourneyNodes, isSeaLeg, DEFAULT_PARTY, type JourneyNode, type JourneyRoute, type Season, type RouteMode, type ComparisonRoutes, type PartyConfig } from '../utils/journey-graph'
import { generateEncounters, type Encounter } from '../utils/encounters'
import { resolveSighting } from '../utils/sea-sightings'
import { loadSavedJourneys, addSavedJourney, deleteSavedJourney, renameSavedJourney, clearSavedJourneysForParty, listPartyNames, journeysForParty, sanitizePartyName, DEFAULT_PARTY_NAME, type SavedJourney } from '../utils/journey-saved'
import { DEFAULT_SUPPLY, type SupplyConfig } from '../utils/journey-supply'
import JourneyDaysTab from './journey-planner/JourneyDaysTab'
import SavedJourneysPanel from './journey-planner/SavedJourneysPanel'
import ActivePartySelect from './journey-planner/ActivePartySelect'
import JourneyControls from './journey-planner/JourneyControls'
import JourneyResults from './journey-planner/JourneyResults'
import JourneyRouteTab from './journey-planner/JourneyRouteTab'
import JourneyEncountersTab from './journey-planner/JourneyEncountersTab'
import TravelVignette from './journey-planner/TravelVignette'
import NodeIcon from './journey-planner/NodeIcon'
import PassageMode from './journey-planner/PassageMode'
import TrailMode from './journey-planner/TrailMode'
import { buildHash } from '../utils/url-hash'
import type { MapAnnotation } from '../utils/annotations'
import { getRouteHexLabels, getBiomeAtPoint } from '../utils/hex-grid'
import { DEFAULT_HEX_SIZE } from '../utils/hex-overlay'
import { buildRouteMarkdown } from '../utils/journey-export'

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
  /** Initial active party name (Tier 2c; typically seeded from URL hash). */
  defaultPartyName?: string
  /** True while the first-run map tour is running. The journey tutorial defers
   *  its auto-launch until the map tour is done so the two overlays never race
   *  (the map tour's "journey" step flips this planner open). */
  mainTourActive?: boolean
  /** Fired when Passage mode is entered or exited. */
  onPassageActiveChange?: (active: boolean) => void
  /** Fired with the current route-node index while Passage mode is active; null when inactive. */
  onPassagePositionChange?: (nodeIndex: number | null) => void
  /** Trail mode run seed (dev/debug; seeded from the URL hash) — makes a live run reproducible. */
  defaultTrailSeed?: number
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

export default function JourneyPlanner({ geojson, active, defaultStartId, defaultEndId, onClose, onRouteComputed, annotations = [], onFlyToAnnotation, onSelectFeatureById, onExportAnnotations, shareMode = false, hexSize = DEFAULT_HEX_SIZE, selectedBiome = null, defaultSeason, onSeasonChange, defaultMode, onModeChange, onComparisonRoutesComputed, defaultParty, onPartyChange, defaultSupply, onSupplyChange, onMarkRouteExplored, defaultPartyName, mainTourActive = false, onPassageActiveChange, onPassagePositionChange, defaultTrailSeed }: JourneyPlannerProps) {
  const [startId, setStartId] = useState('')
  const [endId, setEndId] = useState('')
  const [route, setRoute] = useState<JourneyRoute | null>(null)
  const [startSearch, setStartSearch] = useState('')
  const [endSearch, setEndSearch] = useState('')
  const [startOpen, setStartOpen] = useState(false)
  const [endOpen, setEndOpen] = useState(false)
  const [exportToast, setExportToast] = useState<string | null>(null)
  const [season, setSeason] = useState<Season | undefined>(defaultSeason)
  const [mode, setMode] = useState<RouteMode>(defaultMode ?? 'fastest')
  const [party, setParty] = useState<PartyConfig>(defaultParty ?? DEFAULT_PARTY)
  // Party/Supply live inside the collapsed "Party, supply & options" drawer
  // (see optionsOpen below). Their inner toggles default OPEN so opening the
  // drawer reveals their controls immediately; the toggles remain as
  // height-management affordances within the drawer.
  const [partyOpen, setPartyOpen] = useState(true)
  const [supply, setSupply] = useState<SupplyConfig>(defaultSupply ?? DEFAULT_SUPPLY)
  const [supplyOpen, setSupplyOpen] = useState(true)
  const [waypoints, setWaypoints] = useState<string[]>([])
  const [wpSearch, setWpSearch] = useState('')
  const [wpOpenIdx, setWpOpenIdx] = useState<number | null>(null)
  const [savedJourneys, setSavedJourneys] = useState<SavedJourney[]>(loadSavedJourneys)
  const [savedOpen, setSavedOpen] = useState(false)
  // Multi-party (Tier 2c). Persists across open/close within a session — it's a
  // session-level selector, not transient route state, so it's left out of the
  // reset-on-close effect. New saves are tagged with it; the My-journeys panel
  // is filtered to it; switching loads that party's most-recent journey.
  const [activePartyName, setActivePartyName] = useState(() => sanitizePartyName(defaultPartyName))
  const [routeTab, setRouteTab] = useState<'route' | 'days' | 'encounters'>('route')
  const [attempted, setAttempted] = useState(false)
  const [autoPivots, setAutoPivots] = useState<JourneyNode[]>([])
  const [annotationsOpen, setAnnotationsOpen] = useState(false)
  const [oneOffRolls, setOneOffRolls] = useState<Encounter[]>([])
  const [selectedSegmentIdx, setSelectedSegmentIdx] = useState(0)
  const [compareMode, setCompareMode] = useState(false)
  const [comparisonRoutes, setComparisonRoutes] = useState<ComparisonRoutes>({ direct: null, fastest: null, safest: null, cheapest: null })
  const [departureDayOfYear, setDepartureDayOfYear] = useState<number | undefined>(undefined)
  const [highlightCrisisEvents, setHighlightCrisisEvents] = useState(false)
  const [passageActive, setPassageActive] = useState(false)
  const [trailActive, setTrailActive] = useState(false)
  // "Party, supply & options" drawer — closed by default so the primary route
  // inputs (From/To/season/mode/Find) and the route tabs surface without
  // scrolling past the bulky config sections.
  const [optionsOpen, setOptionsOpen] = useState(false)
  // Reset impromptu rolls and segment selection whenever the route identity
  // changes — they're mid-session state bound to a specific trip.
  const routeSig = route ? route.nodes.map(n => n.id).join('|') : ''
  useEffect(() => { setOneOffRolls([]); setSelectedSegmentIdx(0) }, [routeSig])
  const startRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const wpRefs = useRef<(HTMLDivElement | null)[]>([])
  const exportToastTimeoutRef = useRef<number | null>(null)
  const didAutoComputeRef = useRef(false)
  const tabsRef = useRef<HTMLDivElement>(null)

  // Switch tabs and re-anchor to the (sticky) tab strip. block:'nearest' scrolls
  // only as far as needed to bring the strip into view: at rest the strip sits
  // below the fold so clicking a tab scrolls down to it (you asked for that tab —
  // you see its content); deep in a long list it scrolls up so the strip pins at
  // top; and it's a no-op when the strip already happens to be fully visible.
  const selectRouteTab = (tab: 'route' | 'days' | 'encounters') => {
    setRouteTab(tab)
    tabsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

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

  // Generated once here (deterministic) and shared with the Encounters tab so the
  // vignette can surface the selected leg's at-sea sighting without recomputing.
  const encounters = useMemo(
    () => (route ? generateEncounters(route, season, mode, edgeBiomes) : []),
    [route, season, mode, edgeBiomes],
  )

  // The selected leg's sighting (sea legs only) + whether it's a sea leg, for the
  // travel vignette overlay.
  const selectedLeg = useMemo(() => {
    if (!route || route.edges.length === 0) return { sighting: null as ReturnType<typeof resolveSighting>, isSea: false }
    const idx = Math.max(0, Math.min(selectedSegmentIdx, route.edges.length - 1))
    const edge = route.edges[idx]
    const fromNode = route.nodes.find(n => n.id === edge.from)
    const toNode = route.nodes.find(n => n.id === edge.to)
    const sea = isSeaLeg(fromNode, toNode)
    if (!sea) return { sighting: null, isSea: false }
    const enc = encounters.find(e => e.segmentIdx === idx && resolveSighting(e))
    return { sighting: enc ? resolveSighting(enc) : null, isSea: true }
  }, [route, selectedSegmentIdx, encounters])

  // Party dropdown options: most-recent-first from saved journeys, always
  // including the default and the current active name so you can never get
  // stranded on a party with no way back.
  const partyNames = useMemo(() => {
    const result = listPartyNames(savedJourneys)
    for (const required of [DEFAULT_PARTY_NAME, activePartyName]) {
      if (!result.includes(required)) result.push(required)
    }
    return result
  }, [savedJourneys, activePartyName])

  const activePartyJourneys = useMemo(
    () => journeysForParty(savedJourneys, activePartyName),
    [savedJourneys, activePartyName],
  )

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

  // ── Journey tutorial ─────────────────────────────────────────────────────
  // A planner-scoped walkthrough reusing the map-tour engine (tour.ts +
  // TourOverlay). Lives here, not in App, because its steps drive this
  // component's own state (open the options drawer, switch tabs).

  // Give the tab/export steps something to point at: if the planner is empty,
  // pick two endpoints and let the debounced auto-recompute effect (below)
  // build the route. Never clobber a selection the user already made.
  const seedDemoRoute = useCallback(() => {
    if (startId || endId) return
    const valid = (id?: string) => !!id && nodes.some(n => n.id === id)
    const a = valid(defaultStartId) ? defaultStartId! : nodes[0]?.id
    const b = valid(defaultEndId) ? defaultEndId! : nodes.find(n => n.id !== a)?.id
    if (!a || !b || a === b) return
    setStartId(a)
    setEndId(b)
  }, [startId, endId, defaultStartId, defaultEndId, nodes])

  const journeyTourSteps: TourStep[] = useMemo(() => [
    {
      id: 'welcome',
      title: 'Plan a journey',
      body: 'This planner simulates a trek day-by-day — spending rations and water across terrain, rolling encounters, and telling you whether the party makes it. Here’s the loop.',
      onEnter: seedDemoRoute,
    },
    {
      id: 'from',
      targetSelector: '[data-tour="journey-from"]',
      placement: 'bottom',
      title: 'Where they set out',
      body: 'Pick the party’s starting point. Every node is a real place on the map.',
    },
    {
      id: 'to',
      targetSelector: '[data-tour="journey-to"]',
      placement: 'bottom',
      title: 'Where they’re bound',
      body: 'Pick the destination. The distance and terrain between the two endpoints drive everything that follows.',
    },
    {
      id: 'modes',
      targetSelector: '[data-tour="journey-modes"]',
      placement: 'bottom',
      title: 'Route priority is a tradeoff',
      body: 'Modes aren’t just different paths — each burns supply differently. Safest spends the fewest rations per day; Direct burns ~15% more. Once a route exists, the comparison cards weigh completion odds against days on the road.',
    },
    {
      id: 'find',
      targetSelector: '[data-tour="journey-find"]',
      placement: 'bottom',
      title: 'Compute the route',
      body: 'Find Route runs the simulation. (We’ve filled in a sample trip so you can see the rest.) Clear resets everything.',
    },
    {
      id: 'options',
      targetSelector: '[data-tour="journey-options"]',
      placement: 'top',
      title: 'Party & supply = the fuel',
      body: 'Pace, mounts, party size, and your ration/water stores all feed the burn. A larger or forced-march party drains supplies faster — this is what the daily breakdown spends down.',
      onEnter: () => setOptionsOpen(true),
      // The options config floats as an opaque sheet over the route; close it
      // on leave so the later 'days'/'export' steps aren't hidden behind it.
      onLeave: () => setOptionsOpen(false),
    },
    {
      id: 'days',
      targetSelector: '[data-tour="journey-tab-days"]',
      placement: 'bottom',
      title: 'The day-by-day march',
      body: 'Each leg debits rations and water; stopping at a settlement resupplies. Red shortfall days are where the party runs dry — finding and fixing those is the heart of the planning loop.',
      onEnter: () => setRouteTab('days'),
    },
    {
      id: 'encounters',
      targetSelector: '[data-tour="journey-tab-encounters"]',
      placement: 'bottom',
      title: 'Encounters cost supply',
      body: 'Encounters add story beats and eat into the buffer you just budgeted — a severe one can tip a comfortable trip into a shortfall. Roll them here per segment.',
      onEnter: () => setRouteTab('encounters'),
    },
    {
      id: 'export',
      targetSelector: '[data-tour="journey-export"]',
      placement: 'top',
      title: 'Save it or share it',
      body: 'Save the route to your party’s history, or hand players a stripped, player-safe version. That’s the loop: endpoints → priority → supply, then read the days. Replay this anytime from the “?” in the header.',
      onEnter: () => setRouteTab('route'),
    },
    {
      id: 'set-out',
      targetSelector: '[data-tour="journey-set-out"]',
      placement: 'top',
      title: 'Then live it',
      body: 'Plotting is only half the road. When the party is ready, Set out and travel the crossing a day at a time — supply, weather, and hard choices in real time.',
      onEnter: () => setRouteTab('route'),
    },
  ], [seedDemoRoute])

  const [tutState, tutDispatch] = useReducer(
    (s: TourState, act: TourAction) => tourReducer(s, act, journeyTourSteps.length),
    { active: false, stepIndex: 0 },
  )

  const passageTourSteps: TourStep[] = useMemo(() => [
    {
      id: 'welcome',
      title: 'The crossing begins',
      body: 'You’ve set out. From here the road is lived a day at a time — supply burning, weather turning, the party’s fate in your hands.',
    },
    {
      id: 'ledger',
      targetSelector: '[data-tour="passage-ledger"]',
      placement: 'bottom',
      title: 'Your lifeline',
      body: 'Rations and water, counted in days. Each march spends them; settlements resupply. If a choice cuts your carrying capacity, the lowered cap shows here.',
    },
    {
      id: 'actions',
      targetSelector: '[data-tour="passage-actions"]',
      placement: 'top',
      title: 'How you travel',
      body: 'Each day, choose: Continue marches you onward. Rest, Force-march, and Ration trade supply against time. Turn back ends the crossing while you still can.',
    },
    {
      id: 'journal',
      targetSelector: '[data-tour="passage-journal"]',
      placement: 'top',
      title: 'The record',
      body: 'This is where every day, encounter, and choice gets written as it happens — and hard encounters arrive as cards to decide. Travel well.',
    },
  ], [])

  const [passTutState, passTutDispatch] = useReducer(
    (s: TourState, act: TourAction) => tourReducer(s, act, passageTourSteps.length),
    { active: false, stepIndex: 0 },
  )

  // Auto-launch on first planner open — but only after the map tour is done
  // (and not running), never in share mode, and only on a wide enough viewport
  // for the card. Fires once per mount; the localStorage flag stops re-fires.
  const tutAutoFiredRef = useRef(false)
  useEffect(() => {
    if (!active || tutAutoFiredRef.current) return
    if (shareMode || mainTourActive) return
    if (typeof window !== 'undefined' && window.innerWidth < 768) return
    if (isTourCompleted(JOURNEY_TUTORIAL_KEY) || !isTourCompleted(MAIN_TOUR_KEY)) return
    tutAutoFiredRef.current = true
    const t = window.setTimeout(() => tutDispatch({ type: 'START' }), 600)
    return () => window.clearTimeout(t)
  }, [active, shareMode, mainTourActive])

  // Report whether any immersive mode (Passage or Trail) is active.
  useEffect(() => {
    onPassageActiveChange?.(passageActive || trailActive)
  }, [passageActive, trailActive, onPassageActiveChange])

  // Auto-launch Passage tutorial on first entry into Passage mode.
  const passageTutFiredRef = useRef(false)
  useEffect(() => {
    if (!passageActive || passageTutFiredRef.current) return
    if (shareMode || mainTourActive || tutState.active) return
    if (typeof window !== 'undefined' && window.innerWidth < 768) return
    if (isTourCompleted(PASSAGE_TUTORIAL_KEY)) return
    passageTutFiredRef.current = true
    const t = window.setTimeout(() => passTutDispatch({ type: 'START' }), 600)
    return () => window.clearTimeout(t)
  }, [passageActive, shareMode, mainTourActive, tutState.active])

  // Auto-compute route from URL defaults on first mount
  useEffect(() => {
    if (!active || didAutoComputeRef.current) return
    if (defaultStartId && defaultEndId && nodes.some(n => n.id === defaultStartId) && nodes.some(n => n.id === defaultEndId)) {
      didAutoComputeRef.current = true
      setStartId(defaultStartId)
      setEndId(defaultEndId)
      const result = findRoute(graph, defaultStartId, defaultEndId, undefined, mode, party)
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

      // Comparison routes: only for simple A→B (no waypoints) and when enabled.
      // Waypoints added while Compare is still on must also clear it — otherwise
      // the comparison grid keeps showing stale data once Compare disables.
      if (compareMode && stops.length === 2) {
        const comparisons = findComparisonRoutes(graph, startId, endId, season, party)
        setComparisonRoutes(comparisons)
        onComparisonRoutesComputed?.(comparisons)
      } else {
        setComparisonRoutes({ direct: null, fastest: null, safest: null, cheapest: null })
        onComparisonRoutesComputed?.({ direct: null, fastest: null, safest: null, cheapest: null })
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
      setComparisonRoutes({ direct: null, fastest: null, safest: null, cheapest: null })
      onComparisonRoutesComputed?.({ direct: null, fastest: null, safest: null, cheapest: null })
      setCompareMode(false)
      setStartId('')
      setEndId('')
      setStartSearch('')
      setEndSearch('')
      setWaypoints([])
      setWpSearch('')
      setWpOpenIdx(null)
      setSeason(undefined)
      setMode('fastest')
      setParty(DEFAULT_PARTY)
      setPartyOpen(false)
      setExportToast(null)
      setDepartureDayOfYear(undefined)
      setPassageActive(false)
      setTrailActive(false)
      onPassageActiveChange?.(false)
      onPassagePositionChange?.(null)
    }
  }, [active, onRouteComputed, onPassageActiveChange, onPassagePositionChange])

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
      party: activePartyName,
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

  // playerSafe strips GM-only content (encounters, mode-risk/density warnings,
  // GM notes) — exactly what the share-mode UI hides. The "Markdown" button
  // tracks shareMode (GM gets the full doc, a player on a share link gets the
  // stripped one); the "Player MD" button forces playerSafe so a GM can copy a
  // handout to give players without leaving GM mode.
  async function copyRouteMarkdown(playerSafe: boolean) {
    if (!route) return
    const md = buildRouteMarkdown({
      route,
      season,
      mode,
      edgeBiomes,
      party,
      supply,
      departureDayOfYear,
      annotations,
      sourceUrl: window.location.href.split('#')[0],
      playerSafe,
    })

    try {
      await navigator.clipboard.writeText(md)
      showExportToast(playerSafe ? 'Player handout copied to clipboard' : 'Markdown copied to clipboard')
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

  // Lighter mode switch used by the comparison cards: set the mode and let the
  // debounced auto-recompute effect rebuild the route (matches prior behaviour
  // — the cards never called computeRoute directly).
  function handleSwitchMode(newMode: RouteMode) {
    setMode(newMode)
    onModeChange?.(newMode)
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
      partyName: activePartyName,
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

  function handleRenameSaved(id: string, name: string) {
    setSavedJourneys(renameSavedJourney(id, name))
  }

  function handleClearSaved() {
    // Scoped to the active party — the My-journeys panel only shows that party's
    // journeys, so "Clear all" must not wipe other parties' saved routes.
    const updated = clearSavedJourneysForParty(activePartyName)
    setSavedJourneys(updated)
    showExportToast('My journeys cleared')
  }

  function handleSwitchParty(name: string) {
    const target = sanitizePartyName(name)
    setActivePartyName(target)
    // Swap full state: load this party's most-recent saved journey, if any.
    const latest = journeysForParty(savedJourneys, target)[0]
    if (latest) handleLoadSaved(latest)
  }

  function handleCreateParty(name: string) {
    // A fresh party group — the next Save tags routes with it. No journey loaded.
    setActivePartyName(sanitizePartyName(name))
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
            <span>{activePartyJourneys.length}</span>
          </button>
          {!shareMode && (
            <button
              className="journey-tutorial-btn"
              onClick={() => tutDispatch({ type: 'START' })}
              title="Journey tutorial"
              aria-label="Replay the journey tutorial"
            >
              ?
            </button>
          )}
          <button className="journey-planner-close" onClick={onClose} title="Close (Esc)">×</button>
        </div>
      </div>

      {/* My journeys panel — scoped to the active party (Tier 2c) */}
      {savedOpen && (
        <SavedJourneysPanel
          savedJourneys={activePartyJourneys}
          onLoad={handleLoadSaved}
          onDelete={handleDeleteSaved}
          onRename={handleRenameSaved}
          onClearAll={handleClearSaved}
        />
      )}

      {passageActive && route ? (
        <div className="journey-planner-body passage-mode-body">
          <PassageMode
            route={route}
            season={season}
            mode={mode}
            party={party}
            supply={supply}
            edgeBiomes={edgeBiomes}
            departureDayOfYear={departureDayOfYear}
            nodes={nodes}
            graph={graph}
            endId={endId}
            onExit={() => { setPassageActive(false); onPassageActiveChange?.(false) }}
            onPositionChange={onPassagePositionChange}
          />
        </div>
      ) : trailActive && route ? (
        <div className="journey-planner-body trail-mode-body">
          <TrailMode
            route={route}
            season={season}
            mode={mode}
            party={party}
            supply={supply}
            edgeBiomes={edgeBiomes}
            departureDayOfYear={departureDayOfYear}
            initialSeed={defaultTrailSeed}
            onExit={() => { setTrailActive(false); onPassageActiveChange?.(false) }}
            onPositionChange={onPassagePositionChange}
          />
        </div>
      ) : (
      <div className="journey-planner-body">
        {/* Active party — split-party tracking (Tier 2c). GM-only: a share-link
            recipient sees one party's view, not the switcher. */}
        {!shareMode && (
          <ActivePartySelect
            activePartyName={activePartyName}
            partyNames={partyNames}
            onSwitch={handleSwitchParty}
            onCreate={handleCreateParty}
          />
        )}

        {/* Start selector */}
        <div className="journey-field" ref={startRef} data-tour="journey-from">
          <label className="journey-field-label">From</label>
          <div className="journey-dropdown">
            <button
              data-testid="journey-from"
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
        <div className="journey-field" ref={endRef} data-tour="journey-to">
          <label className="journey-field-label">To</label>
          <div className="journey-dropdown">
            <button
              data-testid="journey-to"
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

        <JourneyControls
          season={season}
          onSeasonChange={handleSeasonChange}
          mode={mode}
          onModeChange={handleModeChange}
          shareMode={shareMode}
          route={route}
          edgeBiomes={edgeBiomes}
          party={party}
          partyOpen={partyOpen}
          onTogglePartyOpen={() => setPartyOpen(o => !o)}
          onPartyChange={handlePartyChange}
          supply={supply}
          supplyOpen={supplyOpen}
          onToggleSupplyOpen={() => setSupplyOpen(o => !o)}
          onSupplyChange={handleSupplyChange}
          onFindRoute={handleFindRoute}
          onClear={handleClear}
          findDisabled={!startId || !endId}
          clearDisabled={!startId && !endId && !route}
          optionsOpen={optionsOpen}
          onToggleOptions={() => setOptionsOpen(o => !o)}
          compareMode={compareMode}
          onToggleCompare={() => setCompareMode(prev => !prev)}
          // Filtered (not raw) so an added-but-unselected "Via" slot doesn't
          // disable Compare — matches the same waypoints.filter(Boolean)
          // convention the route/comparison computation itself uses (line 420, 493).
          waypointsLength={waypoints.filter(Boolean).length}
          departureDayOfYear={departureDayOfYear}
          onSetDeparture={setDepartureDayOfYear}
          highlightCrisisEvents={highlightCrisisEvents}
          onToggleHighlightCrisis={() => setHighlightCrisisEvents(v => !v)}
        />

        {/* Route results */}
        {route && (
          <div className="journey-route">
            {/* Travel vignette — region + attested travel mode of the selected leg */}
            <TravelVignette
              route={route}
              edgeBiomes={edgeBiomes}
              selectedSegmentIdx={selectedSegmentIdx}
              season={season}
              sighting={selectedLeg.sighting}
              isSea={selectedLeg.isSea}
            />

            <div className="journey-route-actions" data-tour="journey-export">
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
              <button className="journey-export-btn" onClick={() => copyRouteMarkdown(shareMode)} title="Copy as markdown">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                Markdown
              </button>
              {!shareMode && (
                <button
                  className="journey-export-btn"
                  onClick={() => copyRouteMarkdown(true)}
                  title="Copy a player-safe handout of this route — no encounters, GM warnings, or GM notes. Paste it into Discord or a VTT."
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/></svg>
                  Player MD
                </button>
              )}
              <button className="journey-export-btn" onClick={handleCopyJSON} title="Copy route JSON">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
                JSON
              </button>
            </div>

            <JourneyResults
              route={route}
              mode={mode}
              compareMode={compareMode}
              comparisonRoutes={comparisonRoutes}
              party={party}
              onSwitchMode={handleSwitchMode}
              routeHexLabels={routeHexLabels}
              autoPivots={autoPivots}
              onSetOut={() => { setPassageActive(true); setTrailActive(false); onPassageActiveChange?.(true) }}
              onSetOutTrail={() => { setTrailActive(true); setPassageActive(false); onPassageActiveChange?.(true) }}
            />

            {/* Tabs */}
            <div className="journey-tabs" ref={tabsRef}>
              <button
                className={`journey-tab ${routeTab === 'route' ? 'active' : ''}`}
                onClick={() => selectRouteTab('route')}
              >
                Route
              </button>
              <button
                className={`journey-tab ${routeTab === 'days' ? 'active' : ''}`}
                onClick={() => selectRouteTab('days')}
                data-tour="journey-tab-days"
              >
                Days
              </button>
              {!shareMode && (
                <button
                  className={`journey-tab ${routeTab === 'encounters' ? 'active' : ''}`}
                  onClick={() => selectRouteTab('encounters')}
                  data-tour="journey-tab-encounters"
                >
                  Encounters
                </button>
              )}
            </div>

            {routeTab === 'route' && (
              <JourneyRouteTab
                route={route}
                mode={mode}
                supply={supply}
                season={season}
                edgeBiomes={edgeBiomes}
                shareMode={shareMode}
              />
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
                onSwitchToEncounters={() => selectRouteTab('encounters')}
              />
            )}

            {!shareMode && routeTab === 'encounters' && (
              <JourneyEncountersTab
                route={route}
                encounters={encounters}
                season={season}
                mode={mode}
                edgeBiomes={edgeBiomes}
                selectedBiome={selectedBiome}
                selectedSegmentIdx={selectedSegmentIdx}
                onSelectSegment={setSelectedSegmentIdx}
                oneOffRolls={oneOffRolls}
                onRollOneOff={(enc) => setOneOffRolls(prev => [enc, ...prev])}
              />
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
      )}

      <TourOverlay
        steps={journeyTourSteps}
        state={tutState}
        dispatch={tutDispatch}
        storageKey={JOURNEY_TUTORIAL_KEY}
      />
      <TourOverlay
        steps={passageTourSteps}
        state={passTutState}
        dispatch={passTutDispatch}
        storageKey={PASSAGE_TUTORIAL_KEY}
      />
    </div>
  )
}
