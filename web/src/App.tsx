import { useState, useEffect, useCallback, useRef } from 'react'
import MapViewer from './components/MapViewer'
import InfoPanel from './components/InfoPanel'
import SearchBar from './components/SearchBar'
import LayerControls from './components/LayerControls'
import KeyboardHelp from './components/KeyboardHelp'
import JourneyPlanner from './components/JourneyPlanner'
import { parseHash, buildHash, clampZoom } from './utils/url-hash'
import type { JourneyRoute } from './utils/journey-graph'
import { formatDistance, type MeasureStats } from './utils/measure'
import { parsePatchYaml, applyPatches } from './utils/patch-parser'
import type { MapAnnotation } from './utils/annotations'
import { loadAnnotations, addAnnotation, updateAnnotation, deleteAnnotation, exportAnnotationsMarkdown } from './utils/annotations'

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
  trade_route: boolean
  landmark: boolean
  river: boolean
  faction_control: boolean
  terrain_cost: boolean
}

export interface LayerOpacity {
  terrain_cell: number
  civilization: number
  water: number
  chokepoint: number
  port: number
  oasis: number
  contested_site: number
  trade_route: number
  landmark: number
  river: number
  faction_control: number
  terrain_cost: number
}

const DEFAULT_LAYERS: LayerVisibility = {
  terrain_cell: true,
  civilization: true,
  water: true,
  chokepoint: true,
  port: true,
  oasis: true,
  contested_site: true,
  trade_route: true,
  landmark: true,
  river: true,
  faction_control: false,
  terrain_cost: false,
}

const DEFAULT_OPACITY: LayerOpacity = {
  terrain_cell: 0.85,
  civilization: 0.15,
  water: 0.5,
  chokepoint: 1,
  port: 1,
  oasis: 1,
  contested_site: 1,
  trade_route: 0.75,
  landmark: 1,
  river: 0.6,
  faction_control: 1,
  terrain_cost: 0.75,
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
  const [isEditMode, setIsEditMode] = useState(false)
  const [measureMode, setMeasureMode] = useState(false)
  const [coordinateUpdates, setCoordinateUpdates] = useState<Record<string, {name: string, category: string, coords: [number, number]}>>({})
  const [patchToast, setPatchToast] = useState<string | null>(null)
  const mapRef = useRef<{ flyToFeature: (feature: GeoJSONFeature) => void; flyToFeatureById: (featureId: string) => boolean; flyToAnnotation: (annotation: MapAnnotation) => void; undoMeasurePoint: () => void; clearMeasurePoints: () => void; updateFeaturePosition: (featureId: string, coords: [number, number]) => void; setFactionOverlay: (enabled: boolean) => void; clearJourneyRoute: () => void } | null>(null)

  // Viewport-aware deep-linking
  const initialHashRef = useRef(parseHash(window.location.hash))
  const viewportRef = useRef(initialHashRef.current)
  const hashUpdateTimeoutRef = useRef<number | null>(null)
  const shareToastTimeoutRef = useRef<number | null>(null)
  const patchToastTimeoutRef = useRef<number | null>(null)
  const panelCloseTimeoutRef = useRef<number | null>(null)
  const flyToTimeoutRef = useRef<number | null>(null)
  const annotationToastTimeoutRef = useRef<number | null>(null)
  const [shareToast, setShareToast] = useState<string | null>(null)
  const [measureStats, setMeasureStats] = useState<MeasureStats | null>(null)
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false)
  const [journeyMode, setJourneyMode] = useState(false)
  const [journeyRoute, setJourneyRoute] = useState<JourneyRoute | null>(null)
  const [pinMode, setPinMode] = useState(false)
  const [annotations, setAnnotations] = useState<MapAnnotation[]>(loadAnnotations)
  const [annotationToast, setAnnotationToast] = useState<string | null>(null)
  const shareMode = !!initialHashRef.current.share

  // Cleanup all timeouts on unmount
  useEffect(() => {
    return () => {
      if (hashUpdateTimeoutRef.current) clearTimeout(hashUpdateTimeoutRef.current)
      if (shareToastTimeoutRef.current) clearTimeout(shareToastTimeoutRef.current)
      if (patchToastTimeoutRef.current) clearTimeout(patchToastTimeoutRef.current)
      if (panelCloseTimeoutRef.current) clearTimeout(panelCloseTimeoutRef.current)
      if (flyToTimeoutRef.current) clearTimeout(flyToTimeoutRef.current)
      if (annotationToastTimeoutRef.current) clearTimeout(annotationToastTimeoutRef.current)
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
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const handleFeatureClick = useCallback((feature: GeoJSONFeature) => {
    setSelectedFeature(feature)
    setPanelOpen(true)
    // Update URL hash for deep-linking
    const id = (feature as unknown as Record<string, unknown>).id as string || (feature.properties.id as string)
    if (id) {
      viewportRef.current = { ...viewportRef.current, featureId: id }
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
    setSearchOpen(false)
    mapRef.current?.flyToFeature(feature)
    const id = (feature as unknown as Record<string, unknown>).id as string || (feature.properties.id as string)
    if (id) {
      viewportRef.current = { ...viewportRef.current, featureId: id }
      const hash = buildHash(viewportRef.current)
      window.history.replaceState(null, '', hash)
    }
  }, [])

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
      setPatchToast('No valid patches found in file')
      if (patchToastTimeoutRef.current) clearTimeout(patchToastTimeoutRef.current)
      patchToastTimeoutRef.current = window.setTimeout(() => setPatchToast(null), 3000)
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
    setPatchToast(`Applied ${result.applied} patch${result.applied !== 1 ? 'es' : ''}${result.skipped > 0 ? `, skipped ${result.skipped}` : ''}`)
    if (patchToastTimeoutRef.current) clearTimeout(patchToastTimeoutRef.current)
    patchToastTimeoutRef.current = window.setTimeout(() => setPatchToast(null), 3000)
  }, [geojson])

  const handleToggleMeasureMode = useCallback(() => {
    setMeasureMode(prev => {
      const next = !prev
      if (next) setPinMode(false)
      return next
    })
  }, [])

  const handleTogglePinMode = useCallback(() => {
    setPinMode(prev => {
      const next = !prev
      if (next) {
        setMeasureMode(false)
        setJourneyMode(false)
      }
      return next
    })
  }, [])

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
      setAnnotationToast('Campaign notes copied')
    } catch {
      setAnnotationToast('Failed to copy notes')
    }
    if (annotationToastTimeoutRef.current) clearTimeout(annotationToastTimeoutRef.current)
    annotationToastTimeoutRef.current = window.setTimeout(() => setAnnotationToast(null), 2000)
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

  const handleJourneyClose = useCallback(() => {
    setJourneyMode(false)
    setJourneyRoute(null)
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

  // Share button: copy current URL to clipboard. If `playerView` is true,
  // the URL has share=1 set, which strips annotations/encounters/edit
  // controls when opened.
  const handleShare = useCallback(async (playerView = false) => {
    const hash = buildHash({ ...viewportRef.current, share: playerView || undefined })
    const url = window.location.origin + window.location.pathname + window.location.search + hash
    try {
      await navigator.clipboard.writeText(url)
      setShareToast(playerView ? 'Player-view link copied' : 'Link copied to clipboard')
    } catch {
      // Fallback for browsers without clipboard API
      const input = document.createElement('input')
      input.value = url
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setShareToast(playerView ? 'Player-view link copied' : 'Link copied to clipboard')
    }
    if (shareToastTimeoutRef.current) clearTimeout(shareToastTimeoutRef.current)
    shareToastTimeoutRef.current = window.setTimeout(() => setShareToast(null), 2000)
  }, [])

  // Refs for keyboard handler to avoid re-binding on every state change
  const searchOpenRef = useRef(searchOpen)
  const measureModeRef = useRef(measureMode)
  const journeyModeRef = useRef(journeyMode)
  const pinModeRef = useRef(pinMode)
  useEffect(() => { searchOpenRef.current = searchOpen }, [searchOpen])
  useEffect(() => { measureModeRef.current = measureMode }, [measureMode])
  useEffect(() => { journeyModeRef.current = journeyMode }, [journeyMode])
  useEffect(() => { pinModeRef.current = pinMode }, [pinMode])

  // Keyboard shortcut: Ctrl+K or / for search, M for measure mode, Shift+? for help
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && !searchOpenRef.current && document.activeElement === document.body)) {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (e.key === 'm' && !searchOpenRef.current && document.activeElement === document.body) {
        e.preventDefault()
        setMeasureMode(prev => {
          const next = !prev
          if (next) setPinMode(false)
          return next
        })
      }
      if (e.key === 'p' && !searchOpenRef.current && document.activeElement === document.body) {
        e.preventDefault()
        setPinMode(prev => {
          const next = !prev
          if (next) {
            setMeasureMode(false)
            setJourneyMode(false)
          }
          return next
        })
      }
      if (e.key === 'j' && !searchOpenRef.current && document.activeElement === document.body) {
        e.preventDefault()
        setJourneyMode(prev => {
          const next = !prev
          if (next) setPinMode(false)
          return next
        })
      }
      if (e.key === '?' && e.shiftKey) {
        e.preventDefault()
        setKeyboardHelpOpen(prev => !prev)
      }
      if (e.key === 'Escape') {
        const target = e.target as HTMLElement
        const tag = target?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          target.blur()
          return
        }
        setSearchOpen(false)
        setKeyboardHelpOpen(false)
        handleClosePanel()
        if (measureModeRef.current) setMeasureMode(false)
        if (journeyModeRef.current) setJourneyMode(false)
        if (pinModeRef.current) setPinMode(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleClosePanel])

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
    <div className={`app ${shareMode ? 'share-mode' : ''}`}>
      {shareMode && (
        <div className="player-view-banner" role="status" aria-live="polite">
          Player view — annotations and encounter notes are hidden
        </div>
      )}
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">VEYDRIA</h1>
          <span className="app-subtitle">Continental Reference Map</span>
        </div>
        <div className="header-right">
          <button
            className={`search-trigger ${journeyMode ? 'journey-active' : ''}`}
            onClick={() => {
              setJourneyMode(prev => {
                const next = !prev
                if (next) setPinMode(false)
                return next
              })
            }}
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
          {!shareMode && (
            <button
              className="search-trigger"
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
            onClick={() => setSearchOpen(true)}
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
          <span className="feature-count">{featureCount} features</span>
        </div>
      </header>

      <main className={`app-main ${measureMode ? 'measure-mode' : ''}`}>
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
          />
        )}

        <LayerControls
          layers={layers}
          opacities={opacities}
          onToggle={handleLayerToggle}
          onOpacityChange={handleOpacityChange}
          onApplyPreset={(preset) => {
            setLayers({ ...preset.layers })
            setOpacities({ ...preset.opacities })
          }}
          isEditMode={isEditMode}
          onToggleEditMode={shareMode ? undefined : () => setIsEditMode(prev => !prev)}
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
            mapRef.current?.flyToFeature(f)
            const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
            if (id) {
              viewportRef.current = { ...viewportRef.current, featureId: id }
              const hash = buildHash(viewportRef.current)
              window.history.replaceState(null, '', hash)
            }
          }}
        />

        {journeyMode && geojson && (
          <JourneyPlanner
            geojson={geojson}
            active={journeyMode}
            defaultStartId={initialHashRef.current.journeyFrom}
            defaultEndId={initialHashRef.current.journeyTo}
            onClose={handleJourneyClose}
            onRouteComputed={handleJourneyRouteComputed}
            annotations={shareMode ? [] : annotations}
            onFlyToAnnotation={(ann) => mapRef.current?.flyToAnnotation(ann)}
            onExportAnnotations={handleExportAnnotations}
            shareMode={shareMode}
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

        {searchOpen && geojson && (
          <SearchBar
            features={geojson.features}
            onSelect={handleSearchSelect}
            onClose={() => setSearchOpen(false)}
          />
        )}

        <KeyboardHelp
          open={keyboardHelpOpen}
          onClose={() => setKeyboardHelpOpen(false)}
        />

        {/* Toast notifications */}
        {shareToast && (
          <div className="toast-notification" id="share-toast">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <span>{shareToast}</span>
          </div>
        )}
        {patchToast && (
          <div className="toast-notification" id="patch-toast">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <span>{patchToast}</span>
          </div>
        )}
        {annotationToast && (
          <div className="toast-notification" id="annotation-toast">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2C8 2 5 5 5 9c0 4 7 13 7 13s7-9 7-13c0-4-3-7-7-7z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
            <span>{annotationToast}</span>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
