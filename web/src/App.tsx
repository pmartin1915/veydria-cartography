import { useState, useEffect, useCallback, useRef } from 'react'
import MapViewer from './components/MapViewer'
import InfoPanel from './components/InfoPanel'
import SearchBar from './components/SearchBar'
import LayerControls from './components/LayerControls'

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
}

function App() {
  const [geojson, setGeojson] = useState<GeoJSONCollection | null>(null)
  const [selectedFeature, setSelectedFeature] = useState<GeoJSONFeature | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadProgress, setLoadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS)
  const [searchOpen, setSearchOpen] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [coordinateUpdates, setCoordinateUpdates] = useState<Record<string, {name: string, category: string, coords: [number, number]}>>({})
  const mapRef = useRef<{ flyToFeature: (feature: GeoJSONFeature) => void; flyToFeatureById: (featureId: string) => boolean } | null>(null)

  useEffect(() => {
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
        const hash = window.location.hash
        const match = hash.match(/^#feature=(.+)$/)
        if (match) {
          const featureId = decodeURIComponent(match[1])
          // Delay to let MapViewer mount
          setTimeout(() => {
            const found = data.features.find((f) => {
              const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
              return id === featureId
            })
            if (found) {
              setSelectedFeature(found)
              setPanelOpen(true)
              mapRef.current?.flyToFeatureById(featureId)
            }
          }, 600)
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
      window.history.replaceState(null, '', `#feature=${id}`)
    }
  }, [])

  const handleClosePanel = useCallback(() => {
    setPanelOpen(false)
    setTimeout(() => setSelectedFeature(null), 300)
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

  const handleLayerToggle = useCallback((layer: keyof LayerVisibility) => {
    setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }))
  }, [])

  const handleSearchSelect = useCallback((feature: GeoJSONFeature) => {
    setSelectedFeature(feature)
    setPanelOpen(true)
    setSearchOpen(false)
    mapRef.current?.flyToFeature(feature)
    const id = (feature as unknown as Record<string, unknown>).id as string || (feature.properties.id as string)
    if (id) {
      window.history.replaceState(null, '', `#feature=${id}`)
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

  // Keyboard shortcut: Ctrl+K or / for search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && !searchOpen && document.activeElement === document.body)) {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (e.key === 'Escape') {
        setSearchOpen(false)
        handleClosePanel()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen, handleClosePanel])

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
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">VEYDRIA</h1>
          <span className="app-subtitle">Continental Reference Map</span>
        </div>
        <div className="header-right">
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

      <main className="app-main">
        {geojson && (
          <MapViewer
            ref={mapRef}
            geojson={geojson}
            layers={layers}
            onFeatureClick={handleFeatureClick}
            selectedFeatureId={selectedFeature?.properties?.id as string | undefined}
            isEditMode={isEditMode}
            onCoordinateUpdate={handleCoordinateUpdate}
          />
        )}

        <LayerControls
          layers={layers}
          onToggle={handleLayerToggle}
          isEditMode={isEditMode}
          onToggleEditMode={() => setIsEditMode(prev => !prev)}
        />

        <InfoPanel
          feature={selectedFeature}
          open={panelOpen}
          onClose={handleClosePanel}
        />

        {isEditMode && Object.keys(coordinateUpdates).length > 0 && (
          <div className="coordinate-panel" style={{
            position: 'absolute', top: 16, right: 16, background: 'var(--bg-card)', 
            border: '1px solid var(--border-accent)', padding: 12, borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 1000, color: 'var(--text-primary)',
            maxHeight: '400px', overflowY: 'auto', width: '300px'
          }}>
            <h3 style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-accent)', marginBottom: 8, marginTop: 0 }}>Modified Coordinates</h3>
            <pre style={{ fontSize: 10, background: 'var(--bg-deep)', padding: 8, borderRadius: 4, margin: 0, whiteSpace: 'pre-wrap' }}>
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
          </div>
        )}

        {searchOpen && geojson && (
          <SearchBar
            features={geojson.features}
            onSelect={handleSearchSelect}
            onClose={() => setSearchOpen(false)}
          />
        )}
      </main>
    </div>
  )
}

export default App
