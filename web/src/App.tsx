import { useState, useEffect, useCallback } from 'react'
import MapViewer from './components/MapViewer'
import InfoPanel from './components/InfoPanel'

// GeoJSON types
interface GeoJSONFeature {
  type: 'Feature'
  geometry: {
    type: string
    coordinates: number[] | number[][] | number[][][]
  }
  properties: Record<string, unknown>
}

interface GeoJSONCollection {
  type: 'FeatureCollection'
  metadata?: Record<string, unknown>
  features: GeoJSONFeature[]
}

function App() {
  const [geojson, setGeojson] = useState<GeoJSONCollection | null>(null)
  const [selectedFeature, setSelectedFeature] = useState<GeoJSONFeature | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/veydria-spatial.geojson')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load GeoJSON: ${res.status}`)
        return res.json()
      })
      .then((data: GeoJSONCollection) => {
        setGeojson(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const handleFeatureClick = useCallback((feature: GeoJSONFeature) => {
    setSelectedFeature(feature)
    setPanelOpen(true)
  }, [])

  const handleClosePanel = useCallback(() => {
    setPanelOpen(false)
    // Delay clearing to allow animation
    setTimeout(() => setSelectedFeature(null), 300)
  }, [])

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <h1 className="loading-title">VEYDRIA</h1>
          <div className="loading-subtitle">Loading continental data...</div>
          <div className="loading-spinner" />
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

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">VEYDRIA</h1>
        <span className="app-subtitle">Continental Reference Map</span>
      </header>

      <main className="app-main">
        {geojson && (
          <MapViewer
            geojson={geojson}
            onFeatureClick={handleFeatureClick}
            selectedFeatureId={selectedFeature?.properties?.id as string | undefined}
          />
        )}

        <InfoPanel
          feature={selectedFeature}
          open={panelOpen}
          onClose={handleClosePanel}
        />
      </main>

      <div className="app-legend">
        <div className="legend-section">
          <span className="legend-dot" style={{ background: '#e8c840' }} />
          <span>Port Zone</span>
        </div>
        <div className="legend-section">
          <span className="legend-dot" style={{ background: '#f44' }} />
          <span>Chokepoint</span>
        </div>
        <div className="legend-section">
          <span className="legend-dot" style={{ background: '#4a9a3a' }} />
          <span>Oasis City</span>
        </div>
        <div className="legend-section">
          <span className="legend-dot" style={{ background: '#adf' }} />
          <span>Contested Site</span>
        </div>
      </div>
    </div>
  )
}

export default App
