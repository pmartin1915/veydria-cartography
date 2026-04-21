import { useEffect, useRef, useMemo } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

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

interface MapViewerProps {
  geojson: GeoJSONCollection
  onFeatureClick: (feature: GeoJSONFeature) => void
  selectedFeatureId?: string
}

// SVG viewBox dimensions
const SVG_WIDTH = 1200
const SVG_HEIGHT = 800

// Convert SVG coordinates to Leaflet CRS.Simple (y-inverted)
function svgToLatLng(x: number, y: number): L.LatLngExpression {
  return [SVG_HEIGHT - y, x]
}

// Marker class for each category
const MARKER_CLASSES: Record<string, string> = {
  port: 'marker-port',
  chokepoint: 'marker-chokepoint',
  oasis: 'marker-oasis',
  contested_site: 'marker-contested',
}

// Marker sizes for each category
const MARKER_SIZES: Record<string, [number, number]> = {
  port: [14, 14],
  chokepoint: [12, 12],
  oasis: [10, 10],
  contested_site: [12, 12],
}

export default function MapViewer({ geojson, onFeatureClick, selectedFeatureId }: MapViewerProps) {
  const mapRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<Map<string, L.Marker | L.CircleMarker>>(new Map())

  // Separate features by type for layered rendering
  const { polygons, points, lines } = useMemo(() => {
    const polygons: GeoJSONFeature[] = []
    const points: GeoJSONFeature[] = []
    const lines: GeoJSONFeature[] = []

    for (const feature of geojson.features) {
      switch (feature.geometry.type) {
        case 'Polygon':
          polygons.push(feature)
          break
        case 'Point':
          points.push(feature)
          break
        case 'LineString':
          lines.push(feature)
          break
      }
    }

    return { polygons, points, lines }
  }, [geojson])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    // Create the map with CRS.Simple (non-geographic pixel coordinates)
    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: 3,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      attributionControl: false,
    })

    // Set initial view centered on the map
    const bounds: L.LatLngBoundsExpression = [
      svgToLatLng(0, SVG_HEIGHT),  // SW corner
      svgToLatLng(SVG_WIDTH, 0),   // NE corner
    ]
    map.fitBounds(bounds)

    // Add SVG as image overlay
    // The SVG file is served from public/
    const svgUrl = '/veydria-schematic.svg'
    L.imageOverlay(svgUrl, bounds).addTo(map)

    // --- Render polygon features (civilizations, basin) ---
    for (const feature of polygons) {
      const coords = feature.geometry.coordinates as number[][][]
      const latlngs = coords[0].map(([x, y]) => svgToLatLng(x, y))
      const props = feature.properties

      const polygon = L.polygon(latlngs, {
        color: (props.fill as string) || '#888',
        fillColor: (props.fill as string) || '#888',
        fillOpacity: (props.fillOpacity as number) || 0.2,
        weight: 1.5,
        opacity: 0.4,
        interactive: true,
      })

      polygon.on('click', () => onFeatureClick(feature))

      // Tooltip with name
      polygon.bindTooltip(
        `<div class="popup-name">${props.name}</div>
         <div class="popup-category">${props.category}</div>`,
        {
          direction: 'center',
          permanent: false,
          className: 'leaflet-popup-content-wrapper',
        }
      )

      polygon.addTo(map)
    }

    // --- Render line features (trade routes) ---
    for (const feature of lines) {
      const coords = feature.geometry.coordinates as number[][]
      const latlngs = coords.map(([x, y]) => svgToLatLng(x, y))
      const props = feature.properties

      const dashArray = (props['stroke-dasharray'] as string) || ''

      const polyline = L.polyline(latlngs, {
        color: (props.stroke as string) || '#888',
        weight: (props['stroke-width'] as number) || 2.5,
        opacity: 0.75,
        dashArray: dashArray,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: true,
      })

      polyline.on('click', () => onFeatureClick(feature))

      polyline.bindTooltip(
        `<div class="popup-name">${props.name}</div>
         <div class="popup-category">Trade Route</div>`,
        {
          sticky: true,
          className: 'leaflet-popup-content-wrapper',
        }
      )

      polyline.addTo(map)
    }

    // --- Render point features (ports, chokepoints, oases, contested sites) ---
    for (const feature of points) {
      const [x, y] = feature.geometry.coordinates as number[]
      const latlng = svgToLatLng(x, y)
      const props = feature.properties
      const category = props.category as string
      const id = props.id as string

      const markerClass = MARKER_CLASSES[category] || 'marker-port'
      const markerSize = MARKER_SIZES[category] || [10, 10]

      const icon = L.divIcon({
        className: markerClass,
        iconSize: markerSize,
        iconAnchor: [markerSize[0] / 2, markerSize[1] / 2],
      })

      const marker = L.marker(latlng, { icon })

      marker.on('click', () => onFeatureClick(feature))

      marker.bindTooltip(
        `<div class="popup-name">${props.name}</div>
         <div class="popup-category">${(category || '').replace('_', ' ')}</div>`,
        {
          direction: 'top',
          offset: [0, -8],
          className: 'leaflet-popup-content-wrapper',
        }
      )

      marker.addTo(map)
      markersRef.current.set(id, marker)
    }

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current.clear()
    }
  }, [geojson, polygons, points, lines, onFeatureClick])

  // Highlight selected marker
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const el = (marker as L.Marker).getElement?.()
      if (el) {
        if (id === selectedFeatureId) {
          el.classList.add('selected')
        } else {
          el.classList.remove('selected')
        }
      }
    })
  }, [selectedFeatureId])

  return <div ref={containerRef} className="map-container" id="veydria-map" />
}
