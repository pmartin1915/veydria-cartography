import { useState, useEffect, useCallback, useRef, useReducer, useMemo, type MouseEvent as ReactMouseEvent } from 'react'
import MapViewer, { type MapViewerHandle } from './components/MapViewer'
import InfoPanel from './components/InfoPanel'
import SearchBar from './components/SearchBar'
import LayerControls from './components/LayerControls'
import KeyboardHelp from './components/KeyboardHelp'
import FactionGraph from './components/FactionGraph'
import JourneyPlanner from './components/JourneyPlanner'
import HexCoordChip from './components/HexCoordChip'
import HexInfoPanel from './components/HexInfoPanel'
import type { AxialCoord, HexCell } from './utils/hex-grid'
import { axialDistance, hexLineBetween, labelHex, parseHexLabel } from './utils/hex-grid'
import { parseHash, buildHash, buildShareUrl, clampZoom } from './utils/url-hash'
import type { JourneyRoute, Season, RouteMode, ComparisonRoutes } from './utils/journey-graph'
import { formatDistance, type MeasureStats } from './utils/measure'
import { parsePatchYaml, applyPatches } from './utils/patch-parser'
import { BUILT_IN_PRESETS } from './utils/layer-presets'
import type { MapAnnotation } from './utils/annotations'
import { loadAnnotations, addAnnotation, updateAnnotation, deleteAnnotation, exportAnnotationsMarkdown, createHexAnnotation } from './utils/annotations'
import { downloadCampaignLog } from './utils/campaign-log'
import { getAllFeatureNotes } from './utils/feature-notes'
import { getStarredIds, toggleStarred } from './utils/feature-stars'
import {
  getPrepOrder,
  setPrepOrder as savePrepOrder,
  getPrepDoneIds,
  togglePrepDone,
  syncPrepOrder,
  syncPrepDone,
} from './utils/session-prep'
import { loadSavedJourneys } from './utils/journey-saved'
import { captureMapPng, copyPngToClipboard, downloadPng, suggestSnapshotFilename } from './utils/map-snapshot'
import { tourReducer, isTourCompleted, markTourCompleted, type TourStep } from './utils/tour'
import { type TimeOfDay, loadTimeOfDay, saveTimeOfDay, cycleTimeOfDay, TIME_OF_DAY_LABELS } from './utils/time-of-day'
import { useMediaQuery } from './utils/media-query'
import { useToast } from './utils/use-toast'
import TourOverlay from './components/TourOverlay'
import SettingsModal from './components/SettingsModal'
import SessionPrepPanel from './components/SessionPrepPanel'

// GeoJSON types
export interface GeoJSONFeature {
  type: 'Feature'
  geometry: {
    type: string
    coordinates: number[] | number[][] | number[][][]
  }
  properties: Record<string, unknown>
}

export interface GeoJSONCollection {
  type: 'FeatureCollection'
  metadata?: Record<string, unknown>
  features: GeoJSONFeature[]
}

// Lore index types
export interface LoreEntry {
  title: string
  category: string
  source: string
  summary: string
}

export type LoreIndex = Record<string, LoreEntry[]>

// Layer visibility state
export interface LayerVisibility {
  terrain_cell: boolean
  civilization: boolean
  water: boolean
  chokepoint: boolean
  port: boolean
  oasis: boolean
  contested_site: boolean
  hex_grid: boolean
  trade_route: boolean
  landmark: boolean
  river: boolean
  faction_control: boolean
  terrain_cost: boolean
  biome_colors: boolean
}

export interface LayerOpacity {
  terrain_cell: number
  civilization: number
  water: number
  chokepoint: number
  port: number
  oasis: number
  contested_site: number
  hex_grid: number
  trade_route: number
  landmark: number
  river: number
  faction_control: number
  terrain_cost: number
  biome_colors: number
}

const DEFAULT_LAYERS: LayerVisibility = {
  terrain_cell: true,
  civilization: true,
  water: true,
  chokepoint: true,
  port: true,
  oasis: true,
  contested_site: true,
  hex_grid: false,
  trade_route: true,
  landmark: true,
  river: true,
  faction_control: false,
  terrain_cost: false,
  biome_colors: false,
}

const DEFAULT_OPACITY: LayerOpacity = {
  terrain_cell: 0.85,
  civilization: 0.15,
  water: 0.5,
  chokepoint: 1,
  port: 1,
  oasis: 1,
  contested_site: 1,
  hex_grid: 0.7,
  trade_route: 0.75,
  landmark: 1,
  river: 0.6,
  faction_control: 1,
  terrain_cost: 0.75,
  biome_colors: 1,
}

function App() {
  const [geojson, setGeojson] = useState<GeoJSONCollection | null>(null)
  const [loreIndex, setLoreIndex] = useState<LoreIndex>({})
  const [selectedFeature, setSelectedFeature] = useState<GeoJSONFeature | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadProgress, setLoadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS)
  const [opacities, setOpacities] = useState<LayerOpacity>(DEFAULT_OPACITY)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchExiting, setSearchExiting] = useState(false)
  const searchExitTimerRef = useRef<number | null>(null)

  const openSearch = useCallback(() => {
    if (searchExitTimerRef.current) {
      clearTimeout(searchExitTimerRef.current)
      searchExitTimerRef.current = null
    }
    setSearchExiting(false)
    setSearchOpen(true)
  }, [])

  const closeSearch = useCallback(() => {
    if (searchExiting || !searchOpen) return
    setSearchExiting(true)
    searchExitTimerRef.current = window.setTimeout(() => {
      setSearchOpen(false)
      setSearchExiting(false)
      searchExitTimerRef.current = null
    }, 120)
  }, [searchOpen, searchExiting])
  const [isEditMode, setIsEditMode] = useState(false)
  const [measureMode, setMeasureMode] = useState(false)
  const [coordinateUpdates, setCoordinateUpdates] = useState<Record<string, {name: string, category: string, coords: [number, number]}>>({})
  const mapRef = useRef<MapViewerHandle | null>(null)

  // Viewport-aware deep-linking
  const initialHashRef = useRef(parseHash(window.location.hash))
  const viewportRef = useRef(initialHashRef.current)
  const hashUpdateTimeoutRef = useRef<number | null>(null)
  const panelCloseTimeoutRef = useRef<number | null>(null)
  const flyToTimeoutRef = useRef<number | null>(null)

  // Toasts with graceful exit animation
  const [shareToast, shareToastLeaving, showShareToast] = useToast(2000)
  const [patchToast, patchToastLeaving, showPatchToast] = useToast(3000)
  const [annotationToast, annotationToastLeaving, showAnnotationToast] = useToast(2000)
  const [logToast, logToastLeaving, showLogToast] = useToast(2000)
  const [measureStats, setMeasureStats] = useState<MeasureStats | null>(null)
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const [sessionPrepOpen, setSessionPrepOpen] = useState(false)
  const [journeyMode, setJourneyMode] = useState(false)
  const [starredIds, setStarredIds] = useState<string[]>(() => getStarredIds())
  const [prepOrder, setPrepOrderState] = useState<string[]>(() => getPrepOrder())
  const [prepDoneIds, setPrepDoneIds] = useState<string[]>(() => getPrepDoneIds())

  const tourSteps: TourStep[] = useMemo(() => [
    {
      id: 'welcome',
      title: 'Welcome to Veydria',
      body: 'Veydria is a fantasy continent wrapped around the Aethelian Basin. This map holds 3,052 features. Let me show you the six things you\u2019ll actually use.',
    },
    {
      id: 'layers',
      targetSelector: '[data-tour="layers"]',
      title: 'Layers',
      body: 'Toggle map layers on and off. Try a preset \u2014 Politics view is a good start.',
      placement: 'right',
      onEnter: () => {
        // Programmatically apply Politics preset
        const preset = BUILT_IN_PRESETS.find(p => p.id === 'politics')
        if (preset) setLayers(preset.layers)
      },
    },
    {
      id: 'search',
      targetSelector: '[data-tour="search"]',
      title: 'Search',
      body: 'Anything in the world is two keystrokes away. Press Cmd-K (or Ctrl-K) and type a city name.',
      placement: 'bottom',
      onEnter: () => openSearch(),
      onLeave: () => closeSearch(),
    },
    {
      id: 'info-panel',
      targetSelector: '[data-tour="info-panel"]',
      title: 'Feature lore cards',
      body: 'Click any feature for its lore card. Notice related features at the bottom \u2014 you can chain through them.',
      placement: 'left',
      onEnter: () => {
        // Programmatically open the Aethelian Basin, or fall back to any
        // water / civilization feature so the tour step still has a target
        // even if the canonical ID drifts.
        const ok = handleSelectFeatureById('aethelian_basin')
        if (!ok && geojson) {
          const fallback = geojson.features.find((f) => f.properties.category === 'water')
            || geojson.features.find((f) => f.properties.category === 'civilization')
            || geojson.features[0]
          if (fallback) {
            const id = (fallback as unknown as Record<string, unknown>).id as string || (fallback.properties.id as string)
            if (id) {
              setSelectedFeature(fallback)
              setPanelOpen(true)
              setSelectedHex(null)
              viewportRef.current = { ...viewportRef.current, featureId: id, hexLabel: undefined, hexNote: undefined }
              const hash = buildHash(viewportRef.current)
              window.history.replaceState(null, '', hash)
            }
          }
        }
      },
    },
    {
      id: 'journey',
      targetSelector: '[data-tour="journey"]',
      title: 'Journey planner',
      body: 'Pick two places and the planner finds a route, breaks it into days, and rolls weather and encounters per leg.',
      placement: 'bottom',
      onEnter: () => setJourneyMode(true),
      onLeave: () => setJourneyMode(false),
    },
    {
      id: 'pins',
      targetSelector: '[data-tour="pin"]',
      title: 'Session notes',
      body: 'Drop a pin near a feature and it auto-links. Use these for NPCs, scenes, and loot.',
      placement: 'bottom',
      onEnter: () => setPinMode(true),
      onLeave: () => setPinMode(false),
    },
    {
      id: 'share',
      targetSelector: '[data-tour="share"]',
      title: 'Player view',
      body: 'Toggle this and your annotations and encounter notes hide. Send the URL to your players.',
      placement: 'bottom',
    },
    {
      id: 'done',
      title: 'That\u2019s the tour',
      body: 'Press ? for keyboard help any time. Have fun exploring Veydria.',
    },
  ], [])

  const [tourState, tourDispatch] = useReducer(
    (state: { active: boolean; stepIndex: number }, action: { type: string }) =>
      tourReducer(state, action as import('./utils/tour').TourAction, tourSteps.length),
    { active: false, stepIndex: 0 }
  )

  const cleanupTour = useCallback(() => {
    closeSearch()
    setJourneyMode(false)
    setPinMode(false)
    setPanelOpen(false)
    setSelectedFeature(null)
    setSelectedHex(null)
    setGraphOpen(false)
    setKeyboardHelpOpen(false)
  }, [])

  const [journeyRoute, setJourneyRoute] = useState<JourneyRoute | null>(null)
  const [comparisonRoutes, setComparisonRoutes] = useState<ComparisonRoutes>({ direct: null, safest: null, cheapest: null })
  const [journeySeason, setJourneySeason] = useState<Season | undefined>(undefined)
  const [journeyModeState, setJourneyModeState] = useState<RouteMode>('direct')
  const [pinMode, setPinMode] = useState(false)
  const [annotations, setAnnotations] = useState<MapAnnotation[]>(loadAnnotations)

  const [hoverHex, setHoverHex] = useState<{ hex: HexCell; descriptors: string[] } | null>(null)
  const [selectedHex, setSelectedHex] = useState<{ hex: HexCell; descriptors: string[] } | null>(null)
  const [hexMeasureMode, setHexMeasureMode] = useState(false)
  const [hexMeasurePoints, setHexMeasurePoints] = useState<AxialCoord[]>([])
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(() => loadTimeOfDay())
  const [hexSize, setHexSize] = useState<number>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('veydria.hexSize') : null
    const n = stored ? Number.parseInt(stored, 10) : NaN
    return [30, 50, 70].includes(n) ? n : 50
  })
  useEffect(() => {
    try { window.localStorage.setItem('veydria.hexSize', String(hexSize)) } catch { /* quota / private mode */ }
  }, [hexSize])
  const shareMode = !!initialHashRef.current.share
  const isMobile = useMediaQuery('(max-width: 768px)')
  const mobilePlayerMode = shareMode && isMobile

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      if (hashUpdateTimeoutRef.current) clearTimeout(hashUpdateTimeoutRef.current)
      if (panelCloseTimeoutRef.current) clearTimeout(panelCloseTimeoutRef.current)
      if (flyToTimeoutRef.current) clearTimeout(flyToTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    // Fetch lore index in parallel with geojson
    fetch('/veydria-lore.json')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.features) setLoreIndex(data.features as LoreIndex)
      })
      .catch(() => { /* lore index is optional */ })

    fetch('/veydria-spatial.geojson')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load GeoJSON: ${res.status}`)
        const contentLength = +(res.headers.get('content-length') || 0)
        const reader = res.body?.getReader()
        if (!reader || !contentLength) {
          return res.json()
        }
        const chunks: Uint8Array[] = []
        let received = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          received += value.length
          setLoadProgress(Math.round((received / contentLength) * 100))
        }
        const all = new Uint8Array(received)
        let pos = 0
        for (const chunk of chunks) {
          all.set(chunk, pos)
          pos += chunk.length
        }
        const text = new TextDecoder().decode(all)
        return JSON.parse(text) as GeoJSONCollection
      })
      .then((data: GeoJSONCollection) => {
        setGeojson(data)
        setLoading(false)
        // Handle deep-linking after data loads
        const hashState = initialHashRef.current
        const featureId = hashState.featureId
        const hasExplicitViewport = hashState.zoom !== undefined && hashState.centerX !== undefined && hashState.centerY !== undefined

        if (featureId) {
          flyToTimeoutRef.current = window.setTimeout(() => {
            const found = data.features.find((f) => {
              const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
              return id === featureId
            })
            if (found) {
              setSelectedFeature(found)
              setPanelOpen(true)
              // Only fly to feature if no explicit viewport was requested
              if (!hasExplicitViewport) {
                mapRef.current?.flyToFeatureById(featureId)
              }
            }
          }, 600)
        }

        // Handle journey deep-linking
        const journeyFrom = hashState.journeyFrom
        const journeyTo = hashState.journeyTo
        if (journeyFrom && journeyTo) {
          setJourneyMode(true)
        }

        // Handle hex deep-linking. Needs hex_grid layer on; the overlay only
        // resolves labels when visible (lookup map is rebuilt on visibility
        // toggle but the cells array is always present, so getHexByLabel is
        // safe regardless). Fly happens slightly after feature fly to avoid
        // a tug-of-war when both are set in the same hash.
        const hexLabel = hashState.hexLabel || hashState.hexNote
        if (hexLabel) {
          setLayers((prev) => prev.hex_grid ? prev : { ...prev, hex_grid: true })
          window.setTimeout(() => {
            mapRef.current?.selectHexByLabel(hexLabel)
          }, featureId ? 1100 : 700)
        }

        // Hex measure deep-link. Both endpoints required; if only one is
        // present in the URL we ignore it (insufficient to enter measure
        // mode meaningfully). Coords come from parseHexLabel — pure math,
        // no overlay dependency — so we can prime state before the map
        // is ready, then fit-bounds once it is.
        const hexA = hashState.hexA
        const hexB = hashState.hexB
        if (hexA && hexB) {
          const coordA = parseHexLabel(hexA)
          const coordB = parseHexLabel(hexB)
          if (coordA && coordB) {
            setLayers((prev) => prev.hex_grid ? prev : { ...prev, hex_grid: true })
            setHexMeasureMode(true)
            setHexMeasurePoints([coordA, coordB])
            window.setTimeout(() => {
              mapRef.current?.fitBoundsToHexes([hexA, hexB])
            }, hexLabel ? 1300 : (featureId ? 1100 : 700))
          }
        }

        // Auto-start guided tour for first-time visitors, but only if there's
        // no deep-link state (the user is following a specific link, not
        // exploring organically), we're not in share mode, and the viewport
        // is wide enough for the tour card to be readable.
        const hasDeepLink = !!(featureId || hexLabel || hashState.hexA || hashState.hexB || journeyFrom || journeyTo)
        if (!hasDeepLink && !hashState.share && !isTourCompleted() && window.innerWidth >= 768) {
          window.setTimeout(() => {
            tourDispatch({ type: 'START' })
          }, 1200)
        }
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const handleFeatureClick = useCallback((feature: GeoJSONFeature) => {
    setSelectedFeature(feature)
    setPanelOpen(true)
    // The hex panel is a sibling bottom sheet on mobile; only one at a time.
    setSelectedHex(null)
    // Update URL hash for deep-linking. Feature and hex selections are
    // mutually exclusive in the URL — same rule as the bottom sheet.
    const id = (feature as unknown as Record<string, unknown>).id as string || (feature.properties.id as string)
    if (id) {
      viewportRef.current = { ...viewportRef.current, featureId: id, hexLabel: undefined, hexNote: undefined }
      const hash = buildHash(viewportRef.current)
      window.history.replaceState(null, '', hash)
    }
  }, [])

  const handleClosePanel = useCallback(() => {
    setPanelOpen(false)
    if (panelCloseTimeoutRef.current) clearTimeout(panelCloseTimeoutRef.current)
    panelCloseTimeoutRef.current = window.setTimeout(() => setSelectedFeature(null), 300)
    viewportRef.current = { ...viewportRef.current, featureId: undefined }
    const hash = buildHash(viewportRef.current)
    window.history.replaceState(null, '', hash || window.location.pathname + window.location.search)
  }, [])

  const handleToggleStar = useCallback((featureId: string) => {
    const nowStarred = toggleStarred(featureId)
    const newStarred = getStarredIds()
    setStarredIds(newStarred)
    const newOrder = syncPrepOrder(newStarred)
    setPrepOrderState(newOrder)
    const newDone = syncPrepDone(newStarred)
    setPrepDoneIds(newDone)
    showAnnotationToast(nowStarred ? 'Starred' : 'Unstarred')
  }, [])

  const handleLayerToggle = useCallback((layer: keyof LayerVisibility) => {
    setLayers((prev) => {
      const next = { ...prev, [layer]: !prev[layer] }
      // Faction overlay and terrain cost tint the terrain_cell layer, so make
      // sure that layer is visible when either overlay is being enabled.
      if ((layer === 'faction_control' || layer === 'terrain_cost') && next[layer]) {
        next.terrain_cell = true
      }
      return next
    })
  }, [])

  const handleOpacityChange = useCallback((layer: keyof LayerOpacity, value: number) => {
    setOpacities((prev) => ({ ...prev, [layer]: value }))
  }, [])

  const handleSearchSelect = useCallback((feature: GeoJSONFeature) => {
    setSelectedFeature(feature)
    setPanelOpen(true)
    closeSearch()
    setSelectedHex(null)
    mapRef.current?.flyToFeature(feature)
    const id = (feature as unknown as Record<string, unknown>).id as string || (feature.properties.id as string)
    if (id) {
      viewportRef.current = { ...viewportRef.current, featureId: id, hexLabel: undefined, hexNote: undefined }
      const hash = buildHash(viewportRef.current)
      window.history.replaceState(null, '', hash)
    }
  }, [closeSearch])

  const handleSelectFeatureById = useCallback((featureId: string): boolean => {
    if (!geojson) return false
    const feature = geojson.features.find((f) => {
      const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
      return id === featureId
    })
    if (!feature) return false
    setSelectedFeature(feature)
    setPanelOpen(true)
    setSelectedHex(null)
    viewportRef.current = { ...viewportRef.current, featureId, hexLabel: undefined, hexNote: undefined }
    const hash = buildHash(viewportRef.current)
    window.history.replaceState(null, '', hash)
    return true
  }, [geojson])

  const handleCoordinateUpdate = useCallback((featureId: string, name: string, category: string, newCoords: [number, number]) => {
    setCoordinateUpdates((prev) => ({
      ...prev,
      [featureId]: { name, category, coords: newCoords }
    }))
  }, [])

  const handleExportPatch = useCallback(() => {
    const entries = Object.entries(coordinateUpdates)
    if (entries.length === 0) return

    const patches = entries.map(([id, data]) =>
      `  - id: ${id}\n    category: ${data.category}\n    coords: [${data.coords[0].toFixed(1)}, ${data.coords[1].toFixed(1)}]`
    ).join('\n')

    const yaml = `patches:\n${patches}\nmetadata:\n  source: web-edit-mode\n  generated: ${new Date().toISOString()}\n`

    const blob = new Blob([yaml], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `veydria-coordinate-patch-${new Date().toISOString().slice(0, 10)}.yaml`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [coordinateUpdates])

  const handleApplyPatch = useCallback(async (file: File) => {
    if (!geojson) return
    const text = await file.text()
    const patches = parsePatchYaml(text)
    if (patches.length === 0) {
      showPatchToast('No valid patches found in file')
      return
    }
    const result = applyPatches(geojson, patches)
    // Imperatively update marker positions to avoid a full 3000-layer rebuild
    for (const idx of result.mutatedFeatures) {
      const feature = result.newFeatures[idx]
      const id = (feature as unknown as Record<string, unknown>).id as string || (feature.properties.id as string)
      if (id && feature.geometry.type === 'Point') {
        mapRef.current?.updateFeaturePosition(id, feature.geometry.coordinates as [number, number])
      }
    }
    // New features array reference triggers React re-renders in SearchBar / InfoPanel
    setGeojson({ ...geojson, features: result.newFeatures as GeoJSONFeature[] })
    showPatchToast(`Applied ${result.applied} patch${result.applied !== 1 ? 'es' : ''}${result.skipped > 0 ? `, skipped ${result.skipped}` : ''}`)
  }, [geojson])

  // Drop hex measure endpoints from the URL. Called from every code path
  // that flips hexMeasureMode off, so the URL doesn't lie about the mode.
  const clearHexMeasureFromHash = useCallback(() => {
    if (!viewportRef.current.hexA && !viewportRef.current.hexB) return
    viewportRef.current = { ...viewportRef.current, hexA: undefined, hexB: undefined }
    window.history.replaceState(null, '', buildHash(viewportRef.current))
  }, [])

  const handleToggleMeasureMode = useCallback(() => {
    setMeasureMode(prev => {
      const next = !prev
      if (next) {
        setPinMode(false)
        setHexMeasureMode(false)
        setHexMeasurePoints([])
        clearHexMeasureFromHash()
      }
      return next
    })
  }, [clearHexMeasureFromHash])

  const handleTogglePinMode = useCallback(() => {
    setPinMode(prev => {
      const next = !prev
      if (next) {
        setMeasureMode(false)
        setJourneyMode(false)
        setHexMeasureMode(false)
        setHexMeasurePoints([])
        clearHexMeasureFromHash()
      }
      return next
    })
  }, [clearHexMeasureFromHash])

  const handleToggleHexMeasureMode = useCallback(() => {
    setHexMeasureMode(prev => {
      const next = !prev
      if (next) {
        setMeasureMode(false)
        setPinMode(false)
        setJourneyMode(false)
        setSelectedHex(null)
        setLayers((prevLayers) => prevLayers.hex_grid ? prevLayers : { ...prevLayers, hex_grid: true })
        // Entering: clear single-hex / feature deep-link, no endpoints yet.
        viewportRef.current = {
          ...viewportRef.current,
          featureId: undefined,
          hexLabel: undefined,
          hexNote: undefined,
          hexA: undefined,
          hexB: undefined,
        }
        window.history.replaceState(null, '', buildHash(viewportRef.current))
      } else {
        setHexMeasurePoints([])
        clearHexMeasureFromHash()
      }
      return next
    })
  }, [clearHexMeasureFromHash])

  const handleCycleTimeOfDay = useCallback(() => {
    setTimeOfDay(prev => {
      const next = cycleTimeOfDay(prev)
      saveTimeOfDay(next)
      return next
    })
  }, [])

  const handleToggleJourneyMode = useCallback(() => {
    setJourneyMode(prev => {
      const next = !prev
      if (next) {
        setPinMode(false)
        setHexMeasureMode(false)
        setHexMeasurePoints([])
        clearHexMeasureFromHash()
      }
      return next
    })
  }, [clearHexMeasureFromHash])

  const handleReorderPrep = useCallback((ids: string[]) => {
    savePrepOrder(ids)
    setPrepOrderState(ids)
  }, [])

  const handleTogglePrepDone = useCallback((featureId: string) => {
    togglePrepDone(featureId)
    setPrepDoneIds(getPrepDoneIds())
  }, [])

  const handleStartSession = useCallback(() => {
    setSessionPrepOpen(false)
    setMeasureMode(false)
    setPinMode(false)
    setHexMeasureMode(false)
    setHexMeasurePoints([])
    clearHexMeasureFromHash()
    setJourneyMode(false)
    setJourneyRoute(null)
    setComparisonRoutes({ direct: null, safest: null, cheapest: null })
    setJourneySeason(undefined)
    setJourneyModeState('direct')
    mapRef.current?.clearJourneyRoute()
    setPanelOpen(false)
    setSelectedFeature(null)
    setSelectedHex(null)
    viewportRef.current = {
      ...viewportRef.current,
      featureId: undefined,
      hexLabel: undefined,
      hexNote: undefined,
      journeyFrom: undefined,
      journeyTo: undefined,
      hexA: undefined,
      hexB: undefined,
    }
    window.history.replaceState(null, '', buildHash(viewportRef.current) || window.location.pathname + window.location.search)
    // Fit map to starred features if any; otherwise fly to a default view.
    window.setTimeout(() => {
      if (starredIds.length > 0 && geojson) {
        const features = geojson.features.filter((f) => {
          const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
          return id && starredIds.includes(id)
        })
        if (features.length > 0) {
          mapRef.current?.fitBoundsToFeatures(features)
        }
      } else {
        mapRef.current?.clearMeasurePoints?.()
      }
    }, 100)
    showAnnotationToast('Session started — good luck!')
  }, [clearHexMeasureFromHash, starredIds, geojson])

  const handleHexMeasureClear = useCallback(() => {
    setHexMeasurePoints([])
    clearHexMeasureFromHash()
  }, [clearHexMeasureFromHash])

  const handleHexMeasureUndo = useCallback(() => {
    setHexMeasurePoints(prev => {
      if (prev.length === 2) {
        viewportRef.current = {
          ...viewportRef.current,
          hexB: undefined,
          featureId: undefined,
          hexLabel: undefined,
          hexNote: undefined,
        }
        window.history.replaceState(null, '', buildHash(viewportRef.current))
        return [prev[0]]
      }
      return prev
    })
  }, [])

  // Path derived from the two clicked endpoints. Empty array means nothing
  // to render. We pass null (not []) to clear, so the overlay can distinguish.
  const hexMeasurePath = hexMeasurePoints.length === 2
    ? hexLineBetween(hexMeasurePoints[0], hexMeasurePoints[1]).map(labelHex)
    : hexMeasurePoints.length === 1
      ? [labelHex(hexMeasurePoints[0])]
      : null
  const hexMeasureDistance = hexMeasurePoints.length === 2
    ? axialDistance(hexMeasurePoints[0], hexMeasurePoints[1])
    : 0

  const handleAnnotationAdd = useCallback((annotation: MapAnnotation) => {
    setAnnotations(prev => addAnnotation(prev, annotation))
    setPinMode(false)
  }, [])

  const handleAnnotationUpdate = useCallback((id: string, updates: Partial<Omit<MapAnnotation, 'id' | 'createdAt'>>) => {
    setAnnotations(prev => updateAnnotation(prev, id, updates))
  }, [])

  const handleAnnotationDelete = useCallback((id: string) => {
    setAnnotations(prev => deleteAnnotation(prev, id))
  }, [])

  const handleExportAnnotations = useCallback(async () => {
    const md = exportAnnotationsMarkdown(annotations)
    try {
      await navigator.clipboard.writeText(md)
      showAnnotationToast('Campaign notes copied')
    } catch {
      showAnnotationToast('Failed to copy notes')
    }
  }, [annotations])

  const handleMeasureUpdate = useCallback((stats: MeasureStats) => {
    setMeasureStats(stats)
  }, [])

  const handleMeasureUndo = useCallback(() => {
    mapRef.current?.undoMeasurePoint()
  }, [])

  const handleMeasureClear = useCallback(() => {
    mapRef.current?.clearMeasurePoints()
  }, [])

  const handleJourneyRouteComputed = useCallback((route: JourneyRoute | null) => {
    setJourneyRoute(route)
    if (!route) {
      setJourneySeason(undefined)
      setJourneyModeState('direct')
      mapRef.current?.clearJourneyRoute()
      viewportRef.current = { ...viewportRef.current, journeyFrom: undefined, journeyTo: undefined }
    } else {
      const startId = route.nodes[0]?.id
      const endId = route.nodes[route.nodes.length - 1]?.id
      viewportRef.current = { ...viewportRef.current, journeyFrom: startId, journeyTo: endId }
    }
    // Trigger hash update
    if (hashUpdateTimeoutRef.current) clearTimeout(hashUpdateTimeoutRef.current)
    hashUpdateTimeoutRef.current = window.setTimeout(() => {
      const hash = buildHash(viewportRef.current)
      if (hash !== window.location.hash) {
        window.history.replaceState(null, '', hash || window.location.pathname + window.location.search)
      }
    }, 300)
  }, [])

  const handleComparisonRoutesComputed = useCallback((routes: ComparisonRoutes) => {
    setComparisonRoutes(routes)
  }, [])

  const handleJourneyClose = useCallback(() => {
    setJourneyMode(false)
    setJourneyRoute(null)
    setComparisonRoutes({ direct: null, safest: null, cheapest: null })
    setJourneySeason(undefined)
    setJourneyModeState('direct')
    mapRef.current?.clearJourneyRoute()
    viewportRef.current = { ...viewportRef.current, journeyFrom: undefined, journeyTo: undefined }
    if (hashUpdateTimeoutRef.current) clearTimeout(hashUpdateTimeoutRef.current)
    hashUpdateTimeoutRef.current = window.setTimeout(() => {
      const hash = buildHash(viewportRef.current)
      if (hash !== window.location.hash) {
        window.history.replaceState(null, '', hash || window.location.pathname + window.location.search)
      }
    }, 300)
  }, [])

  // Report viewport changes from MapViewer (throttled)
  const handleViewportChange = useCallback((viewport: { zoom: number; centerX: number; centerY: number }) => {
    viewportRef.current = { ...viewportRef.current, ...viewport }
    if (hashUpdateTimeoutRef.current) clearTimeout(hashUpdateTimeoutRef.current)
    hashUpdateTimeoutRef.current = window.setTimeout(() => {
      const hash = buildHash(viewportRef.current)
      if (hash !== window.location.hash) {
        window.history.replaceState(null, '', hash || window.location.pathname + window.location.search)
      }
    }, 300)
  }, [])

  // Exit player view: strip share=1 and reload so the full GM chrome renders.
  const handleExitPlayerView = useCallback(() => {
    const hash = buildHash({ ...viewportRef.current, share: undefined })
    window.location.hash = hash
    window.location.reload()
  }, [])

  // Share button: copy current URL to clipboard. If `playerView` is true,
  // the URL has share=1 set, which strips annotations/encounters/edit
  // controls when opened.
  const handleDownloadCampaignLog = useCallback(() => {
    downloadCampaignLog({
      activeJourney: journeyRoute
        ? { route: journeyRoute, season: journeySeason, mode: journeyModeState }
        : undefined,
      savedJourneys: loadSavedJourneys(),
      annotations,
      featureNotes: getAllFeatureNotes(),
    })
    showLogToast('Campaign log downloaded')
  }, [journeyRoute, journeySeason, journeyModeState, annotations])

  // Share button: copy current URL to clipboard. If `playerView` is true,
  // the URL has share=1 set, which strips annotations/encounters/edit
  // controls when opened.
  const handleShare = useCallback(async (playerView = false) => {
    const url = buildShareUrl({ ...viewportRef.current, share: playerView || undefined })
    try {
      await navigator.clipboard.writeText(url)
      showShareToast(playerView ? 'Player-view link copied' : 'Link copied to clipboard')
    } catch {
      // Fallback for browsers without clipboard API
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      showShareToast(playerView ? 'Player-view link copied' : 'Link copied to clipboard')
    }
  }, [])

  // Snapshot button: capture the visible map as a PNG. Tries clipboard
  // first (one-click for Discord paste); falls back to a download.
  // Shift+click captures a player-facing variant (annotation pins
  // excluded), so a GM can produce a clean export without toggling
  // share-mode first.
  const handleSnapshot = useCallback(async (e?: ReactMouseEvent) => {
    const container = document.querySelector('.leaflet-container') as HTMLElement | null
    if (!container) {
      showShareToast('Map not ready for snapshot')
      return
    }
    const playerVariant = !!e?.shiftKey
    showShareToast(playerVariant ? 'Capturing player snapshot…' : 'Capturing snapshot…')
    try {
      const dataUrl = await captureMapPng({ target: container, excludeAnnotations: playerVariant })
      const copied = await copyPngToClipboard(dataUrl)
      const label = playerVariant ? 'Player snapshot' : 'Snapshot'
      if (copied) {
        showShareToast(`${label} copied to clipboard`)
      } else {
        downloadPng(dataUrl, suggestSnapshotFilename())
        showShareToast(`${label} downloaded`)
      }
    } catch {
      showShareToast('Snapshot failed')
    }
  }, [])

  // Refs for keyboard handler to avoid re-binding on every state change
  const searchOpenRef = useRef(searchOpen)
  const measureModeRef = useRef(measureMode)
  const journeyModeRef = useRef(journeyMode)
  const pinModeRef = useRef(pinMode)
  const hexMeasureModeRef = useRef(hexMeasureMode)
  const sessionPrepOpenRef = useRef(sessionPrepOpen)
  useEffect(() => { searchOpenRef.current = searchOpen || searchExiting }, [searchOpen, searchExiting])
  useEffect(() => { measureModeRef.current = measureMode }, [measureMode])
  useEffect(() => { journeyModeRef.current = journeyMode }, [journeyMode])
  useEffect(() => { pinModeRef.current = pinMode }, [pinMode])
  useEffect(() => { hexMeasureModeRef.current = hexMeasureMode }, [hexMeasureMode])
  useEffect(() => { sessionPrepOpenRef.current = sessionPrepOpen }, [sessionPrepOpen])

  // Keyboard shortcut: Ctrl+K or / for search, M for measure mode, Shift+? for help
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && !searchOpenRef.current && document.activeElement === document.body)) {
        e.preventDefault()
        openSearch()
      }
      if (e.key === 'm' && !searchOpenRef.current && document.activeElement === document.body) {
        e.preventDefault()
        handleToggleMeasureMode()
      }
      if (e.key === 'p' && !searchOpenRef.current && document.activeElement === document.body) {
        e.preventDefault()
        handleTogglePinMode()
      }
      if (e.key === 'j' && !searchOpenRef.current && document.activeElement === document.body) {
        e.preventDefault()
        handleToggleJourneyMode()
      }
      if (e.key === 'h' && !searchOpenRef.current && document.activeElement === document.body) {
        e.preventDefault()
        handleToggleHexMeasureMode()
      }
      if (e.key === 't' && !searchOpenRef.current && document.activeElement === document.body) {
        e.preventDefault()
        handleCycleTimeOfDay()
      }
      if (e.key === 's' && !searchOpenRef.current && document.activeElement === document.body) {
        e.preventDefault()
        setSessionPrepOpen(prev => !prev)
      }
      if (e.key === '?' && e.shiftKey) {
        e.preventDefault()
        setKeyboardHelpOpen(prev => !prev)
      }
      if (e.key === 'Backspace' && hexMeasureModeRef.current) {
        e.preventDefault()
        setHexMeasurePoints(prev => {
          if (prev.length === 2) {
            viewportRef.current = {
              ...viewportRef.current,
              hexB: undefined,
              featureId: undefined,
              hexLabel: undefined,
              hexNote: undefined,
            }
            window.history.replaceState(null, '', buildHash(viewportRef.current))
            return [prev[0]]
          }
          return prev
        })
      }
      if (e.key === 'Escape') {
        const target = e.target as HTMLElement
        const tag = target?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          target.blur()
          return
        }
        closeSearch()
        setKeyboardHelpOpen(false)
        handleClosePanel()
        if (measureModeRef.current) setMeasureMode(false)
        if (journeyModeRef.current) setJourneyMode(false)
        if (pinModeRef.current) setPinMode(false)
        setHexMeasureMode(false)
        setHexMeasurePoints([])
        clearHexMeasureFromHash()
        setSessionPrepOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleClosePanel, handleToggleMeasureMode, handleTogglePinMode, handleToggleJourneyMode, handleToggleHexMeasureMode, handleCycleTimeOfDay, clearHexMeasureFromHash, closeSearch, openSearch])

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-parchment" />
        <div className="loading-content">
          <div className="loading-glow" />
          <svg className="loading-compass" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="32" cy="32" r="28" stroke-opacity="0.3" />
            <circle cx="32" cy="32" r="22" stroke-opacity="0.15" stroke-dasharray="2 3" />
            <path d="M32 8 L36 28 L32 32 L28 28 Z" fill="var(--text-accent)" fill-opacity="0.8" stroke="none" />
            <path d="M32 56 L28 36 L32 32 L36 36 Z" fill="var(--text-muted)" fill-opacity="0.5" stroke="none" />
            <line x1="32" y1="4" x2="32" y2="10" />
            <line x1="32" y1="54" x2="32" y2="60" />
            <line x1="4" y1="32" x2="10" y2="32" />
            <line x1="54" y1="32" x2="60" y2="32" />
          </svg>
          <h1 className="loading-title">VEYDRIA</h1>
          <div className="loading-subtitle">Loading continental data...</div>
          <div className="loading-bar">
            <div className="loading-bar-fill" style={{ width: `${Math.max(8, loadProgress)}%` }} />
          </div>
          <div className="loading-percent">{loadProgress}%</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <h1 className="loading-title">VEYDRIA</h1>
          <div className="error-message">
            <p>{error}</p>
            <p className="error-hint">
              Run <code>python pipeline.py export-geojson</code> in the generator directory,
              then copy <code>output/veydria-spatial.geojson</code> to <code>web/public/</code>
            </p>
          </div>
        </div>
      </div>
    )
  }

  const featureCount = geojson?.features.length ?? 0

  return (
    <div className={`app ${shareMode ? 'share-mode' : ''} ${mobilePlayerMode ? 'mobile-player-mode' : ''}`}>
      {shareMode && !mobilePlayerMode && (
        <div className="player-view-banner" role="status" aria-live="polite">
          Player view — annotations and encounter notes are hidden
        </div>
      )}
      {mobilePlayerMode && (
        <div className="mobile-player-chrome">
          <div className="mobile-player-pill mobile-player-title">
            <span className="mobile-player-title-text">VEYDRIA</span>
          </div>
          <div className="mobile-player-pill mobile-player-actions">
            <button
              className="mobile-player-btn"
              onClick={() => openSearch()}
              title="Search features"
              aria-label="Search features"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </button>
            <button
              className="mobile-player-btn"
              onClick={() => setKeyboardHelpOpen(true)}
              title="Keyboard shortcuts"
              aria-label="Keyboard shortcuts"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M6 8h.01M6 12h.01M6 16h.01" />
              </svg>
            </button>
            <button
              className="mobile-player-btn mobile-player-btn--exit"
              onClick={handleExitPlayerView}
              title="Exit player view"
              aria-label="Exit player view"
            >
              <span>GM</span>
            </button>
          </div>
        </div>
      )}
      {!mobilePlayerMode && <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">VEYDRIA</h1>
          <span className="app-subtitle">Continental Reference Map</span>
        </div>
        <div className="header-right">
          <button
            className={`search-trigger ${journeyMode ? 'journey-active' : ''}`}
            data-tour="journey"
            onClick={handleToggleJourneyMode}
            title="Toggle journey planner (J)"
            id="journey-trigger"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span>{journeyMode ? 'Planning...' : 'Journey'}</span>
          </button>
          {!shareMode && (
            <button
              className={`search-trigger ${pinMode ? 'active' : ''}`}
              data-tour="pin"
              onClick={handleTogglePinMode}
              title="Toggle pin mode (P)"
              id="pin-trigger"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2C8 2 5 5 5 9c0 4 7 13 7 13s7-9 7-13c0-4-3-7-7-7z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
              <span>{pinMode ? 'Drop pin...' : 'Pin'}</span>
            </button>
          )}
          {!shareMode && (
            <button
              className={`search-trigger ${measureMode ? 'active' : ''}`}
              onClick={handleToggleMeasureMode}
              title="Toggle measure mode (M)"
              id="measure-trigger"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3v18h18" />
                <path d="M7 16l4-6 4 4 6-8" />
              </svg>
              <span>{measureMode ? 'Measuring...' : 'Measure'}</span>
            </button>
          )}
          {!shareMode && (
            <button
              className={`search-trigger ${hexMeasureMode ? 'active' : ''}`}
              onClick={handleToggleHexMeasureMode}
              title="Two-click hex distance"
              id="hex-measure-trigger"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                <polygon points="12,3 21,8 21,16 12,21 3,16 3,8" />
              </svg>
              <span>{hexMeasureMode ? 'Pick hexes...' : 'Hex'}</span>
            </button>
          )}
          <button
            className="search-trigger"
            onClick={() => handleShare(false)}
            title="Copy shareable link"
            id="share-trigger"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            <span>Share</span>
          </button>
          <button
            className="search-trigger"
            onClick={handleSnapshot}
            title="Capture the current map view as PNG  ·  Shift+click for player view (no pins)"
            id="snapshot-trigger"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span>Snapshot</span>
          </button>
          {!shareMode && (
            <button
              className="search-trigger"
              data-tour="share"
              onClick={() => handleShare(true)}
              title="Copy a player-facing link (hides annotations and encounters)"
              id="player-share-trigger"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2" />
              </svg>
              <span>Player Link</span>
            </button>
          )}
          {!shareMode && (
            <button
              className="search-trigger"
              onClick={() => setGraphOpen(true)}
              title="Open the faction relationship graph"
              id="graph-trigger"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="6" cy="6" r="2.5" />
                <circle cx="18" cy="6" r="2.5" />
                <circle cx="12" cy="18" r="2.5" />
                <line x1="6" y1="6" x2="18" y2="6" />
                <line x1="6" y1="6" x2="12" y2="18" />
                <line x1="18" y1="6" x2="12" y2="18" />
              </svg>
              <span>Graph</span>
            </button>
          )}
          {!shareMode && (
            <button
              className="search-trigger"
              onClick={handleDownloadCampaignLog}
              title="Download campaign log as markdown"
              id="log-trigger"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              <span>Log</span>
            </button>
          )}
          {!shareMode && (
            <button
              className={`search-trigger ${sessionPrepOpen ? 'active' : ''}`}
              onClick={() => setSessionPrepOpen(prev => !prev)}
              title="Session prep (S)"
              id="session-prep-trigger"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
              </svg>
              <span>Prep</span>
            </button>
          )}
          <button
            className="search-trigger time-of-day-btn"
            onClick={handleCycleTimeOfDay}
            title={`Cycle time of day — current: ${TIME_OF_DAY_LABELS[timeOfDay]} (T)`}
            id="time-of-day-trigger"
          >
            {timeOfDay === 'day' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            )}
            {timeOfDay === 'dawn' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 10V4M4.93 14.93l1.41-1.41M17.66 14.93l1.41-1.41" />
                <path d="M4 18h16" />
                <circle cx="12" cy="16" r="4" />
              </svg>
            )}
            {timeOfDay === 'dusk' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 14v6M4.93 9.07l1.41 1.41M17.66 9.07l1.41 1.41" />
                <path d="M4 18h16" />
                <circle cx="12" cy="10" r="4" />
              </svg>
            )}
            {timeOfDay === 'night' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
            <span>{TIME_OF_DAY_LABELS[timeOfDay]}</span>
          </button>
          <button
            className="search-trigger"
            onClick={() => setKeyboardHelpOpen(true)}
            title="Keyboard shortcuts (Shift+?)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M6 8h.01M6 12h.01M6 16h.01" />
            </svg>
            <span>Help</span>
          </button>
          <button
            className="search-trigger"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Settings</span>
          </button>
          <button
            className="search-trigger"
            data-tour="search"
            onClick={() => openSearch()}
            title="Search features (Ctrl+K)"
            id="search-trigger"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <span>Search...</span>
            <kbd>⌘K</kbd>
          </button>
          <button
            className="feature-count"
            onClick={() => openSearch()}
            title="Search features (Ctrl+K)"
            type="button"
          >
            {featureCount} features
          </button>
        </div>
      </header>}

      <main className={`app-main ${measureMode ? 'measure-mode' : ''} time-of-day-${timeOfDay}`}>
        {geojson && (
          <MapViewer
            ref={mapRef}
            geojson={geojson}
            layers={layers}
            opacities={opacities}
            onFeatureClick={handleFeatureClick}
            selectedFeatureId={selectedFeature?.properties?.id as string | undefined}
            isEditMode={isEditMode}
            onCoordinateUpdate={handleCoordinateUpdate}
            measureMode={measureMode}
            pinMode={pinMode}
            annotations={shareMode ? [] : annotations}
            onAnnotationAdd={handleAnnotationAdd}
            onAnnotationUpdate={handleAnnotationUpdate}
            onAnnotationDelete={handleAnnotationDelete}
            initialViewport={
              initialHashRef.current.zoom !== undefined &&
              initialHashRef.current.centerX !== undefined &&
              initialHashRef.current.centerY !== undefined
                ? {
                    zoom: clampZoom(initialHashRef.current.zoom),
                    centerX: initialHashRef.current.centerX,
                    centerY: initialHashRef.current.centerY,
                  }
                : undefined
            }
            onViewportChange={handleViewportChange}
            onMeasureUpdate={handleMeasureUpdate}
            route={journeyRoute}
            comparisonRoutes={comparisonRoutes}
            onHoverHex={setHoverHex}
            onSelectHex={(hit) => {
              if (hexMeasureMode) {
                // Two-point measurement. Third click resets to the new point
                // so the path always reflects the most recent pair.
                const next = hexMeasurePoints.length >= 2
                  ? [hit.hex.coord]
                  : [...hexMeasurePoints, hit.hex.coord]
                setHexMeasurePoints(next)
                viewportRef.current = {
                  ...viewportRef.current,
                  hexA: next[0] ? labelHex(next[0]) : undefined,
                  hexB: next[1] ? labelHex(next[1]) : undefined,
                  featureId: undefined,
                  hexLabel: undefined,
                  hexNote: undefined,
                }
                window.history.replaceState(null, '', buildHash(viewportRef.current))
                return
              }
              setSelectedHex(hit)
              setPanelOpen(false)
              viewportRef.current = { ...viewportRef.current, hexLabel: hit.hex.label, hexNote: undefined, featureId: undefined }
              const hash = buildHash(viewportRef.current)
              window.history.replaceState(null, '', hash)
            }}
            hexSize={hexSize}
            selectedHexLabel={selectedHex?.hex.label ?? null}
            hexMeasurePath={hexMeasurePath}
            hexMeasureMode={hexMeasureMode}
          />
        )}

        {layers.hex_grid && (selectedHex || hoverHex) && (
          <HexCoordChip
            label={(selectedHex ?? hoverHex)!.hex.label}
            descriptors={(selectedHex ?? hoverHex)!.descriptors}
          />
        )}

        {selectedHex && (
          <HexInfoPanel
            hex={selectedHex.hex}
            descriptors={selectedHex.descriptors}
            onCentre={() => mapRef.current?.flyToHex(selectedHex.hex.label)}
            onClose={() => {
              setSelectedHex(null)
              viewportRef.current = { ...viewportRef.current, hexLabel: undefined, hexNote: undefined }
              const hash = buildHash(viewportRef.current)
              window.history.replaceState(null, '', hash || window.location.pathname + window.location.search)
            }}
            annotations={shareMode ? [] : annotations}
            onAddAnnotation={(hexLabel, x, y, label, body, color) => {
              const ann = createHexAnnotation(hexLabel, x, y, label || `Note on ${hexLabel}`, body, color)
              setAnnotations(prev => addAnnotation(prev, ann))
              showAnnotationToast('Hex note added')
            }}
            onSelectAnnotation={(ann) => mapRef.current?.flyToAnnotation(ann)}
            highlightNotes={initialHashRef.current.hexNote === selectedHex.hex.label}
          />
        )}

        <LayerControls
          layers={layers}
          opacities={opacities}
          onToggle={handleLayerToggle}
          onOpacityChange={handleOpacityChange}
          onApplyPreset={(preset) => {
            // Merge against current state so a preset only overrides keys it
            // carries; new keys added to LayerVisibility/LayerOpacity after a
            // preset was saved keep their current value rather than going
            // undefined.
            setLayers((prev) => ({ ...prev, ...preset.layers }))
            setOpacities((prev) => ({ ...prev, ...preset.opacities }))
          }}
          isEditMode={isEditMode}
          onToggleEditMode={shareMode ? undefined : () => setIsEditMode(prev => !prev)}
          shareMode={shareMode}
          hexSize={hexSize}
          onHexSizeChange={setHexSize}
        />

        <InfoPanel
          feature={selectedFeature}
          allFeatures={geojson?.features}
          lore={loreIndex}
          open={panelOpen}
          onClose={handleClosePanel}
          onSelectFeature={(f) => {
            setSelectedFeature(f)
            setPanelOpen(true)
            setSelectedHex(null)
            mapRef.current?.flyToFeature(f)
            const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
            if (id) {
              viewportRef.current = { ...viewportRef.current, featureId: id, hexLabel: undefined, hexNote: undefined }
              const hash = buildHash(viewportRef.current)
              window.history.replaceState(null, '', hash)
            }
          }}
          annotations={shareMode ? [] : annotations}
          onSelectAnnotation={(ann) => mapRef.current?.flyToAnnotation(ann)}
          onShare={() => handleShare(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          starredIds={starredIds}
          onToggleStar={handleToggleStar}
        />

        {journeyMode && geojson && (
          <JourneyPlanner
            geojson={geojson}
            active={journeyMode}
            defaultStartId={initialHashRef.current.journeyFrom}
            defaultEndId={initialHashRef.current.journeyTo}
            onClose={handleJourneyClose}
            onRouteComputed={handleJourneyRouteComputed}
            onComparisonRoutesComputed={handleComparisonRoutesComputed}
            annotations={shareMode ? [] : annotations}
            onFlyToAnnotation={(ann) => mapRef.current?.flyToAnnotation(ann)}
            onSelectFeatureById={handleSelectFeatureById}
            onExportAnnotations={handleExportAnnotations}
            shareMode={shareMode}
            hexSize={hexSize}
            selectedBiome={selectedHex?.descriptors[0] ?? null}
            onSeasonChange={setJourneySeason}
            onModeChange={setJourneyModeState}
          />
        )}

        {measureMode && (
          <div className="measure-panel">
            <div className="measure-panel-main">
              <div className="measure-panel-stats">
                <span className="measure-stat">
                  {measureStats ? measureStats.pointCount : 0} point{measureStats?.pointCount !== 1 ? 's' : ''}
                </span>
                {measureStats && measureStats.pointCount >= 2 && (
                  <span className="measure-stat measure-stat--total">
                    Total: {formatDistance(measureStats.totalDistance)}
                  </span>
                )}
              </div>
              <div className="measure-panel-actions">
                <button
                  className="measure-btn"
                  onClick={handleMeasureUndo}
                  disabled={!measureStats || measureStats.pointCount === 0}
                  title="Remove last point (Backspace)"
                >
                  Undo
                </button>
                <button
                  className="measure-btn"
                  onClick={handleMeasureClear}
                  disabled={!measureStats || measureStats.pointCount === 0}
                  title="Clear all points"
                >
                  Clear
                </button>
                <button
                  className="measure-btn measure-btn--primary"
                  onClick={() => setMeasureMode(false)}
                >
                  Done
                </button>
              </div>
            </div>
            <div className="measure-panel-hint">
              Click to place · Backspace to undo · Esc to exit
            </div>
          </div>
        )}

        {hexMeasureMode && (
          <div className="measure-panel">
            <div className="measure-panel-main">
              <div className="measure-panel-stats">
                <span className="measure-stat">
                  {hexMeasurePoints.length === 0 && 'Pick start hex'}
                  {hexMeasurePoints.length === 1 && `${labelHex(hexMeasurePoints[0])} → ?`}
                  {hexMeasurePoints.length === 2 && `${labelHex(hexMeasurePoints[0])} → ${labelHex(hexMeasurePoints[1])}`}
                </span>
                {hexMeasurePoints.length === 2 && (
                  <span className="measure-stat measure-stat--total">
                    {hexMeasureDistance} hex{hexMeasureDistance === 1 ? '' : 'es'}
                  </span>
                )}
              </div>
              <div className="measure-panel-actions">
                <button
                  className="measure-btn"
                  onClick={handleHexMeasureUndo}
                  disabled={hexMeasurePoints.length !== 2}
                  title="Undo last hex (Backspace)"
                >
                  ↩ Undo
                </button>
                <button
                  className="measure-btn"
                  onClick={handleHexMeasureClear}
                  disabled={hexMeasurePoints.length === 0}
                  title="Clear endpoints"
                >
                  Clear
                </button>
                <button
                  className="measure-btn measure-btn--primary"
                  onClick={handleToggleHexMeasureMode}
                >
                  Done
                </button>
              </div>
            </div>
            <div className="measure-panel-hint">
              Click two hexes to measure · Backspace to undo · Click a third to start over
            </div>
          </div>
        )}

        {isEditMode && (
          <div className="coordinate-panel" style={{
            position: 'absolute', top: 16, right: 16, background: 'var(--bg-card)', 
            border: '1px solid var(--border-accent)', padding: 12, borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 1000, color: 'var(--text-primary)',
            maxHeight: '400px', overflowY: 'auto', width: '300px'
          }}>
            <h3 style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-accent)', marginBottom: 8, marginTop: 0 }}>Edit Mode</h3>

            {/* Apply Patch */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Apply Patch</label>
              <input
                type="file"
                accept=".yaml,.yml"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleApplyPatch(file)
                  e.target.value = ''
                }}
                style={{ fontSize: 11, color: 'var(--text-primary)', width: '100%' }}
              />
            </div>

            {Object.keys(coordinateUpdates).length > 0 && (
              <>
                <h4 style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6, marginTop: 0 }}>Modified Coordinates</h4>
                <pre style={{ fontSize: 10, background: 'var(--bg-deep)', padding: 8, borderRadius: 4, margin: 0, whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto' }}>
                  {Object.values(coordinateUpdates).map(update => 
                    `${update.name}:\n  location: [${update.coords[0].toFixed(1)}, ${update.coords[1].toFixed(1)}]`
                  ).join('\n\n')}
                </pre>
                <button 
                  onClick={handleExportPatch} 
                  style={{ marginTop: 8, width: '100%', padding: '6px', background: 'var(--text-accent)', border: 'none', color: 'var(--bg-deep)', cursor: 'pointer', borderRadius: 4, fontWeight: 600, fontSize: 11 }}
                >
                  Export Patch
                </button>
                <button 
                  onClick={() => setCoordinateUpdates({})} 
                  style={{ marginTop: 6, width: '100%', padding: '4px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 4, fontSize: 11 }}
                >
                  Clear All
                </button>
              </>
            )}
          </div>
        )}

        {(searchOpen || searchExiting) && geojson && (
          <SearchBar
            features={geojson.features}
            annotations={annotations}
            starredIds={starredIds}
            onSelect={handleSearchSelect}
            onClose={closeSearch}
            exiting={searchExiting}
          />
        )}

        <KeyboardHelp
          open={keyboardHelpOpen}
          onClose={() => setKeyboardHelpOpen(false)}
          onReplayTour={() => {
            cleanupTour()
            tourDispatch({ type: 'START' })
          }}
        />

        <TourOverlay
          steps={tourSteps}
          state={tourState}
          dispatch={(action) => {
            if (action.type === 'SKIP' || action.type === 'COMPLETE') {
              cleanupTour()
            }
            tourDispatch(action)
          }}
        />

        <FactionGraph
          open={graphOpen}
          geojson={geojson}
          relationships={geojson?.metadata?.relationships}
          onClose={() => setGraphOpen(false)}
          onSelectFaction={(civId) => {
            const feature = geojson?.features.find(f =>
              ((f.properties?.id as string) === civId) ||
              ((f as unknown as { id?: string }).id === civId)
            )
            if (feature) handleFeatureClick(feature)
          }}
        />

        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />

        <SessionPrepPanel
          features={geojson?.features ?? []}
          starredIds={starredIds}
          orderedIds={prepOrder.length > 0 ? prepOrder : undefined}
          doneIds={prepDoneIds}
          open={sessionPrepOpen}
          onClose={() => setSessionPrepOpen(false)}
          onSelectFeature={(f) => {
            setSessionPrepOpen(false)
            setSelectedFeature(f)
            setPanelOpen(true)
            setSelectedHex(null)
            mapRef.current?.flyToFeature(f)
            const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
            if (id) {
              viewportRef.current = { ...viewportRef.current, featureId: id, hexLabel: undefined, hexNote: undefined }
              const hash = buildHash(viewportRef.current)
              window.history.replaceState(null, '', hash)
            }
          }}
          onToggleStar={handleToggleStar}
          onReorder={handleReorderPrep}
          onToggleDone={handleTogglePrepDone}
          onExportCampaignLog={handleDownloadCampaignLog}
          onStartSession={handleStartSession}
        />

        {/* Toast notifications */}
        {(shareToast || shareToastLeaving) && (
          <div className={`toast-notification ${shareToastLeaving ? 'exiting' : ''}`} id="share-toast">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <span>{shareToast}</span>
          </div>
        )}
        {(patchToast || patchToastLeaving) && (
          <div className={`toast-notification ${patchToastLeaving ? 'exiting' : ''}`} id="patch-toast">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <span>{patchToast}</span>
          </div>
        )}
        {(annotationToast || annotationToastLeaving) && (
          <div className={`toast-notification ${annotationToastLeaving ? 'exiting' : ''}`} id="annotation-toast">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2C8 2 5 5 5 9c0 4 7 13 7 13s7-9 7-13c0-4-3-7-7-7z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
            <span>{annotationToast}</span>
          </div>
        )}
        {(logToast || logToastLeaving) && (
          <div className={`toast-notification ${logToastLeaving ? 'exiting' : ''}`} id="log-toast">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <span>{logToast}</span>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
