import { useEffect, useRef, useMemo, forwardRef, useImperativeHandle, useState } from 'react'
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

import { initD3Overlay } from '../utils/d3-overlay'

interface GeoJSONCollection {
  type: 'FeatureCollection'
  metadata?: Record<string, unknown>
  features: GeoJSONFeature[]
}

interface LayerVisibility {
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

export interface MapViewerProps {
  geojson: GeoJSONCollection
  layers: LayerVisibility
  onFeatureClick: (feature: GeoJSONFeature) => void
  onFeatureSelect?: (feature: GeoJSONFeature | null) => void
  selectedFeatureId?: string
  isEditMode?: boolean
  onCoordinateUpdate?: (featureId: string, name: string, category: string, newCoords: [number, number]) => void
  measureMode?: boolean
}

export interface MapViewerHandle {
  flyToFeature: (feature: GeoJSONFeature) => void
  flyToFeatureById: (featureId: string) => boolean
}

// SVG viewBox dimensions
const SVG_WIDTH = 1200
const SVG_HEIGHT = 800

// Convert SVG coordinates to Leaflet CRS.Simple (y-inverted)
function svgToLatLng(x: number, y: number): L.LatLngExpression {
  return [SVG_HEIGHT - y, x]
}

const latLngToSvg = (latlng: L.LatLng) => {
  const x = latlng.lng
  const y = SVG_HEIGHT - latlng.lat
  return { x, y }
}

// Get centroid of coordinates
function getCentroid(coords: number[] | number[][] | number[][][], geomType: string): [number, number] {
  if (geomType === 'Point') {
    const [x, y] = coords as number[]
    return [x, y]
  }
  if (geomType === 'LineString') {
    const pts = coords as number[][]
    const mid = pts[Math.floor(pts.length / 2)]
    return [mid[0], mid[1]]
  }
  if (geomType === 'Polygon') {
    const ring = (coords as number[][][])[0]
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
    return [cx, cy]
  }
  return [600, 400]
}

// SVG marker icons per category
const MARKER_SVGS: Record<string, string> = {
  port: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><path d="M12 21V8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><path d="M8 12l4-3 4 3"/></svg>`,
  chokepoint: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4 8 4v14"/><path d="M10 9.5a2 2 0 0 1 4 0V21"/></svg>`,
  oasis: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-8"/><path d="M12 14c-2-2-4-5-4-8a4 4 0 0 1 8 0c0 3-2 6-4 8z"/><path d="M8 22h8"/></svg>`,
  contested_site: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  landmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 12 12 22 2 12 12 2"/></svg>`,
}

const MARKER_CLASSES: Record<string, string> = {
  port: 'marker-port',
  chokepoint: 'marker-chokepoint',
  oasis: 'marker-oasis',
  contested_site: 'marker-contested',
  landmark: 'marker-landmark',
}

const MARKER_SIZE = 22

// Zoom thresholds: layers hidden below this zoom level
const ZOOM_THRESHOLDS: Partial<Record<keyof LayerVisibility, number>> = {
  terrain_cell: -0.5,
  river: -0.5,
  landmark: 0,
}

function getElevationColor(elev: number): string {
  const norm = Math.max(0.25, Math.min(1.0, 0.25 + 0.75 * (elev + 500) / 3500))
  if (norm < 0.4) return '#8ab87a' // ndjadi green
  if (norm < 0.6) return '#c8d4a0' // kheshkai green-yellow
  if (norm < 0.8) return '#e8d5a0' // irrah yellow-brown
  if (norm < 0.9) return '#c9b896' // ngaru-bon plateau
  return '#f5f5f5' // white peaks
}

// Scale: 1200 SVG units ≈ 3000 km (per MAP-PROMPT.md continental extent)
const KM_PER_SVG_UNIT = 3000 / 1200 // ≈ 2.5 km per SVG unit
const LEAGUES_PER_KM = 1 / 4 // 1 league ≈ 4 km

function formatDistance(svgDistance: number): string {
  const km = svgDistance * KM_PER_SVG_UNIT
  const leagues = km * LEAGUES_PER_KM
  if (km < 1) return `${(km * 1000).toFixed(0)} m`
  if (km < 10) return `${km.toFixed(1)} km / ${leagues.toFixed(1)} leagues`
  return `${km.toFixed(0)} km / ${leagues.toFixed(0)} leagues`
}

const MapViewer = forwardRef<MapViewerHandle, MapViewerProps>(
  function MapViewer({ geojson, layers, onFeatureClick, onFeatureSelect, selectedFeatureId, isEditMode, onCoordinateUpdate, measureMode }, ref) {
    const mapRef = useRef<L.Map | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const layerGroupsRef = useRef<Map<string, L.LayerGroup>>(new Map())
    const markersRef = useRef<Map<string, L.Marker>>(new Map())
    const animFrameIdsRef = useRef<Set<number>>(new Set())
    const measureLayerRef = useRef<L.LayerGroup | null>(null)
    const measureLabelRef = useRef<L.Marker | null>(null)
    const measureModeRef = useRef(measureMode)

    // Keep ref in sync so event handlers see current value without re-binding
    useEffect(() => {
      measureModeRef.current = measureMode
    }, [measureMode])

    // Separate features by type
    const featuresByCategory = useMemo(() => {
      const groups: Record<string, GeoJSONFeature[]> = {}
      for (const feature of geojson.features) {
        const cat = (feature.properties.category as string) || 'unknown'
        if (!groups[cat]) groups[cat] = []
        groups[cat].push(feature)
      }
      return groups
    }, [geojson])

    const [zoomLevel, setZoomLevel] = useState<number>(-1)
    const [measurePoints, setMeasurePoints] = useState<Array<{x: number, y: number}>>([])

    // Build feature ID lookup for deep-linking
    const featureById = useMemo(() => {
      const map = new Map<string, GeoJSONFeature>()
      for (const f of geojson.features) {
        const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
        if (id) map.set(id, f)
      }
      return map
    }, [geojson])

    // Expose flyToFeature to parent
    useImperativeHandle(ref, () => ({
      flyToFeature(feature: GeoJSONFeature) {
        if (!mapRef.current) return
        const [x, y] = getCentroid(feature.geometry.coordinates, feature.geometry.type)
        const latlng = svgToLatLng(x, y)
        mapRef.current.flyTo(latlng as L.LatLngExpression, 1.5, { duration: 0.8 })
      },
      flyToFeatureById(featureId: string) {
        const feature = featureById.get(featureId)
        if (!feature || !mapRef.current) return false
        const [x, y] = getCentroid(feature.geometry.coordinates, feature.geometry.type)
        const latlng = svgToLatLng(x, y)
        mapRef.current.flyTo(latlng as L.LatLngExpression, 2, { duration: 1 })
        return true
      },
    }))

    // Clear measure points when measure mode is turned off
    useEffect(() => {
      if (!measureMode) {
        setMeasurePoints([])
      }
    }, [measureMode])

    // Initialize map
    useEffect(() => {
      if (!containerRef.current || mapRef.current) return

      const map = L.map(containerRef.current, {
        crs: L.CRS.Simple,
        minZoom: -2,
        maxZoom: 4,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        attributionControl: false,
        zoomControl: false,
      })

      // Zoom control in top-right
      L.control.zoom({ position: 'topright' }).addTo(map)

      // Scale bar
      L.control.scale({ position: 'bottomright', metric: true, imperial: false }).addTo(map)

      // Canvas renderer for high-count layers (terrain_cell has 3000+ polygons)
      const canvasRenderer = L.canvas({ padding: 0.5 })

      // Track zoom level for threshold-based visibility
      const updateZoom = () => setZoomLevel(map.getZoom())
      map.on('zoom', updateZoom)
      updateZoom()

      // Measurement click handler
      const handleMapClick = (e: L.LeafletMouseEvent) => {
        if (!measureModeRef.current) return
        const svg = latLngToSvg(e.latlng)
        setMeasurePoints(prev => [...prev, { x: svg.x, y: svg.y }])
      }
      map.on('click', handleMapClick)

      const bounds: L.LatLngBoundsExpression = [
        svgToLatLng(0, SVG_HEIGHT) as L.LatLngTuple,
        svgToLatLng(SVG_WIDTH, 0) as L.LatLngTuple,
      ]
      map.fitBounds(bounds)

      // SVG image overlay
      L.imageOverlay('/veydria-schematic.svg', bounds).addTo(map)

      // Create layer groups for each category
      const categoryLayers: [string, GeoJSONFeature[]][] = [
        ['water', featuresByCategory['water'] || []],
        ['terrain_cell', featuresByCategory['terrain_cell'] || []],
        ['civilization', featuresByCategory['civilization'] || []],
        ['river', featuresByCategory['river'] || []],
        ['landmark', featuresByCategory['landmark'] || []],
        ['oasis', featuresByCategory['oasis'] || []],
        ['contested_site', featuresByCategory['contested_site'] || []],
        ['chokepoint', featuresByCategory['chokepoint'] || []],
        ['port', featuresByCategory['port'] || []],
      ]

      for (const [category, features] of categoryLayers) {
        const group = L.layerGroup()

        for (const feature of features) {
          const props = feature.properties
          const geomType = feature.geometry.type

          if (geomType === 'Polygon') {
            const coords = feature.geometry.coordinates as number[][][]
            const latlngs = coords[0].map(([x, y]) => svgToLatLng(x, y))

            let fillColor = (props.fill as string) || '#888'
            let fillOpacity = 0.2
            let weight = 1.5

            if (category === 'water') {
              fillOpacity = 0.5
              weight = 2
            } else if (category === 'terrain_cell') {
              fillColor = getElevationColor(props.elevation as number || 0)
              fillOpacity = 0.85
              weight = 0
            } else if (category === 'civilization') {
              fillOpacity = 0.15 
            }

            const polygon = L.polygon(latlngs, {
              color: category === 'terrain_cell' ? 'none' : ((props.fill as string) || '#888'),
              fillColor,
              fillOpacity,
              weight,
              opacity: category === 'terrain_cell' ? 0 : 0.5,
              className: `poly-${category}`,
              renderer: category === 'terrain_cell' ? canvasRenderer : undefined,
            })

            polygon.on('click', () => {
              if (measureModeRef.current) return
              onFeatureClick(feature)
              if (onFeatureSelect) onFeatureSelect(feature)
            })
            polygon.on('mouseover', function (this: L.Polygon) {
              if (category === 'terrain_cell') return
              this.setStyle({ fillOpacity: category === 'water' ? 0.7 : 0.4, weight: 2.5 })
            })
            polygon.on('mouseout', function (this: L.Polygon) {
              if (category === 'terrain_cell') return
              this.setStyle({ fillOpacity: category === 'water' ? 0.5 : 0.15, weight: category === 'water' ? 2 : 1.5 })
            })

            polygon.bindTooltip(
              `<div class="popup-name">${props.name}</div><div class="popup-category">${(category || '').replace('_', ' ')}</div>`,
              { direction: 'center', className: 'leaflet-popup-content-wrapper' }
            )

            polygon.addTo(group)

          } else if (geomType === 'LineString') {
            const coords = feature.geometry.coordinates as number[][]
            const latlngs = coords.map(([x, y]) => svgToLatLng(x, y))

            const lineOpts: L.PolylineOptions = {
              color: (props.stroke as string) || '#888',
              weight: (props['stroke-width'] as number) || 2.5,
              opacity: category === 'river' ? 0.6 : 0.7,
              dashArray: category === 'river' ? '8,6' : ((props['stroke-dasharray'] as string) || undefined),
              lineCap: 'round',
              lineJoin: 'round',
              className: category === 'river' ? 'poly-river' : undefined,
            }

            const polyline = L.polyline(latlngs, lineOpts)

            polyline.on('click', () => {
              if (measureModeRef.current) return
              onFeatureClick(feature)
              if (onFeatureSelect) onFeatureSelect(feature)
            })
            polyline.on('mouseover', function (this: L.Polyline) {
              this.setStyle({ weight: (lineOpts.weight || 2.5) + 2, opacity: 1 })
              this.bringToFront()
            })
            polyline.on('mouseout', function (this: L.Polyline) {
              this.setStyle({ weight: lineOpts.weight, opacity: lineOpts.opacity })
            })

            polyline.bindTooltip(
              `<div class="popup-name">${props.name}</div><div class="popup-category">${category === 'river' ? 'River' : 'Trade Route'}</div>`,
              { sticky: true, className: 'leaflet-popup-content-wrapper' }
            )

            polyline.addTo(group)

          } else if (geomType === 'Point') {
            const [x, y] = feature.geometry.coordinates as number[]
            const latlng = svgToLatLng(x, y)
            const id = (feature as unknown as Record<string, unknown>).id as string || (props.id as string) || ''

            const markerClass = MARKER_CLASSES[category] || 'marker-landmark'
            const svgHtml = MARKER_SVGS[category] || MARKER_SVGS.landmark

            const icon = L.divIcon({
              className: `map-marker ${markerClass} ${isEditMode ? 'edit-mode-marker' : ''}`,
              iconSize: [MARKER_SIZE, MARKER_SIZE],
              iconAnchor: [MARKER_SIZE / 2, MARKER_SIZE / 2],
              html: svgHtml,
            })

            const marker = L.marker(latlng, { 
              icon,
              draggable: isEditMode
            })

            let isDragging = false
            marker.on('dragstart', () => { isDragging = true })
            marker.on('click', () => {
              if (measureModeRef.current) {
                // In measure mode, clicking a marker adds its location as a point
                const [x, y] = feature.geometry.coordinates as number[]
                setMeasurePoints(prev => [...prev, { x, y }])
                return
              }
              if (!isDragging) {
                onFeatureClick(feature)
                if (onFeatureSelect) onFeatureSelect(feature)
              }
              isDragging = false
            })

            if (isEditMode) {
              marker.on('dragend', (e) => {
                const newLatLng = (e.target as L.Marker).getLatLng()
                const newSvg = latLngToSvg(newLatLng)
                if (onCoordinateUpdate && id) {
                  onCoordinateUpdate(id, props.name as string, category, [newSvg.x, newSvg.y])
                }
                setTimeout(() => { isDragging = false }, 50)
              })
            }

            const catLabel = (category || '').replace('_', ' ')
            const typeLabel = props.type ? ` · ${props.type}` : ''
            marker.bindTooltip(
              `<div class="popup-name">${props.name}</div><div class="popup-category">${catLabel}${typeLabel}</div>`,
              { direction: 'top', offset: [0, -8], className: 'leaflet-popup-content-wrapper' }
            )

            marker.addTo(group)
            if (id) markersRef.current.set(id, marker)
          }
        }

        group.addTo(map)
        layerGroupsRef.current.set(category, group)
      }

      // Initialize D3 overlay for trade routes
      const tradeRoutes = featuresByCategory['trade_route'] || []
      const d3Overlay = initD3Overlay(map, tradeRoutes, onFeatureClick)
      // Store in layer groups ref so it can be toggled
      layerGroupsRef.current.set('trade_route', {
        addTo: () => d3Overlay.setVisibility(true),
        removeFrom: () => d3Overlay.setVisibility(false),
      } as any)

      mapRef.current = map

      return () => {
        map.off('zoom', updateZoom)
        map.off('click', handleMapClick)
        d3Overlay.destroy()
        animFrameIdsRef.current.forEach((id) => cancelAnimationFrame(id))
        animFrameIdsRef.current.clear()
        map.remove()
        mapRef.current = null
        layerGroupsRef.current.clear()
        markersRef.current.clear()
      }
    }, [geojson, featuresByCategory, onFeatureClick])

    // Toggle layer visibility (respecting zoom thresholds)
    useEffect(() => {
      if (!mapRef.current) return
      for (const [category, group] of layerGroupsRef.current.entries()) {
        const userVisible = layers[category as keyof LayerVisibility]
        if (userVisible === undefined) continue

        const threshold = ZOOM_THRESHOLDS[category as keyof LayerVisibility]
        const zoomVisible = threshold === undefined || zoomLevel >= threshold
        const visible = userVisible && zoomVisible
        
        if (category === 'trade_route') {
          if (visible) group.addTo(mapRef.current)
          else group.removeFrom(mapRef.current)
        } else {
          if (visible && !mapRef.current.hasLayer(group as L.LayerGroup)) {
            (group as L.LayerGroup).addTo(mapRef.current)
          } else if (!visible && mapRef.current.hasLayer(group as L.LayerGroup)) {
            mapRef.current.removeLayer(group as L.LayerGroup)
          }
        }
      }
    }, [layers, zoomLevel])

    // Highlight selected marker
    useEffect(() => {
      markersRef.current.forEach((marker, id) => {
        const el = marker.getElement?.()
        if (el) {
          el.classList.toggle('selected', id === selectedFeatureId)
        }
      })
    }, [selectedFeatureId])

    // Render measurement overlay
    useEffect(() => {
      if (!mapRef.current) return

      // Clean up previous measure layers
      if (measureLayerRef.current) {
        mapRef.current.removeLayer(measureLayerRef.current)
        measureLayerRef.current = null
      }
      if (measureLabelRef.current) {
        mapRef.current.removeLayer(measureLabelRef.current)
        measureLabelRef.current = null
      }

      if (measurePoints.length === 0) return

      const group = L.layerGroup()

      // Draw points
      measurePoints.forEach((pt) => {
        const latlng = svgToLatLng(pt.x, pt.y)
        const marker = L.circleMarker(latlng as L.LatLngExpression, {
          radius: 5,
          fillColor: '#e8c840',
          color: '#c4a862',
          weight: 2,
          opacity: 0.9,
          fillOpacity: 0.8,
          className: 'measure-point',
        })
        marker.addTo(group)
      })

      // Draw lines between consecutive points
      if (measurePoints.length >= 2) {
        for (let i = 1; i < measurePoints.length; i++) {
          const a = measurePoints[i - 1]
          const b = measurePoints[i]
          const latlngs = [svgToLatLng(a.x, a.y), svgToLatLng(b.x, b.y)]
          L.polyline(latlngs, {
            color: '#e8c840',
            weight: 2,
            opacity: 0.7,
            dashArray: '6,4',
            lineCap: 'round',
            className: 'measure-line',
          }).addTo(group)
        }
      }

      group.addTo(mapRef.current)
      measureLayerRef.current = group

      // Distance label at midpoint of last segment (or at single point)
      if (measurePoints.length >= 1) {
        const lastPt = measurePoints[measurePoints.length - 1]
        let labelLatLng = svgToLatLng(lastPt.x, lastPt.y)
        let labelText = ''

        if (measurePoints.length >= 2) {
          // Calculate total distance
          let totalSvgDist = 0
          for (let i = 1; i < measurePoints.length; i++) {
            const dx = measurePoints[i].x - measurePoints[i - 1].x
            const dy = measurePoints[i].y - measurePoints[i - 1].y
            totalSvgDist += Math.sqrt(dx * dx + dy * dy)
          }
          labelText = formatDistance(totalSvgDist)

          // Place label at midpoint of last segment, offset slightly
          const prevPt = measurePoints[measurePoints.length - 2]
          const midX = (prevPt.x + lastPt.x) / 2
          const midY = (prevPt.y + lastPt.y) / 2
          labelLatLng = svgToLatLng(midX, midY)
        }

        if (labelText) {
          const labelIcon = L.divIcon({
            className: 'measure-label',
            html: `<div class="measure-label-inner">${labelText}</div>`,
            iconSize: [140, 24],
            iconAnchor: [70, 12],
          })
          const labelMarker = L.marker(labelLatLng as L.LatLngExpression, {
            icon: labelIcon,
            interactive: false,
            zIndexOffset: 1000,
          })
          labelMarker.addTo(mapRef.current)
          measureLabelRef.current = labelMarker
        }
      }

      return () => {
        if (measureLayerRef.current && mapRef.current) {
          mapRef.current.removeLayer(measureLayerRef.current)
        }
        if (measureLabelRef.current && mapRef.current) {
          mapRef.current.removeLayer(measureLabelRef.current)
        }
      }
    }, [measurePoints])

    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div ref={containerRef} className={`map-container ${measureMode ? 'measure-mode' : ''}`} id="veydria-map" />
        {/* Compass Rose Overlay */}
        <div className="compass-rose" title="North">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.2">
            <circle cx="24" cy="24" r="20" stroke-opacity="0.25" />
            <circle cx="24" cy="24" r="14" stroke-opacity="0.12" stroke-dasharray="2 2" />
            <path d="M24 6 L27 22 L24 24 L21 22 Z" fill="var(--text-accent)" fill-opacity="0.7" stroke="none" />
            <path d="M24 42 L21 26 L24 24 L27 26 Z" fill="var(--text-muted)" fill-opacity="0.4" stroke="none" />
            <line x1="24" y1="3" x2="24" y2="7" />
            <line x1="24" y1="41" x2="24" y2="45" />
            <line x1="3" y1="24" x2="7" y2="24" />
            <line x1="41" y1="24" x2="45" y2="24" />
            <text x="24" y="10" text-anchor="middle" font-size="5" fill="var(--text-accent)" stroke="none" font-family="var(--font-display)">N</text>
          </svg>
        </div>
      </div>
    )
  }
)

export default MapViewer
