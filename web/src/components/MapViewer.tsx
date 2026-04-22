import { useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react'
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
}

export interface MapViewerHandle {
  flyToFeature: (feature: GeoJSONFeature) => void
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

// Marker class for each category
const MARKER_CLASSES: Record<string, string> = {
  port: 'marker-port',
  chokepoint: 'marker-chokepoint',
  oasis: 'marker-oasis',
  contested_site: 'marker-contested',
  landmark: 'marker-landmark',
}

// Marker sizes for each category
const MARKER_SIZES: Record<string, [number, number]> = {
  port: [14, 14],
  chokepoint: [12, 12],
  oasis: [10, 10],
  contested_site: [12, 12],
  landmark: [9, 9],
}

function getElevationColor(elev: number): string {
  const norm = Math.max(0.25, Math.min(1.0, 0.25 + 0.75 * (elev + 500) / 3500))
  if (norm < 0.4) return '#8ab87a' // ndjadi green
  if (norm < 0.6) return '#c8d4a0' // kheshkai green-yellow
  if (norm < 0.8) return '#e8d5a0' // irrah yellow-brown
  if (norm < 0.9) return '#c9b896' // ngaru-bon plateau
  return '#f5f5f5' // white peaks
}

const MapViewer = forwardRef<MapViewerHandle, MapViewerProps>(
  function MapViewer({ geojson, layers, onFeatureClick, onFeatureSelect, selectedFeatureId, isEditMode, onCoordinateUpdate }, ref) {
    const mapRef = useRef<L.Map | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const layerGroupsRef = useRef<Map<string, L.LayerGroup>>(new Map())
    const markersRef = useRef<Map<string, L.Marker>>(new Map())
    const animFrameIdsRef = useRef<Set<number>>(new Set())

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

    // Expose flyToFeature to parent
    useImperativeHandle(ref, () => ({
      flyToFeature(feature: GeoJSONFeature) {
        if (!mapRef.current) return
        const [x, y] = getCentroid(feature.geometry.coordinates, feature.geometry.type)
        const latlng = svgToLatLng(x, y)
        mapRef.current.flyTo(latlng as L.LatLngExpression, 1.5, { duration: 0.8 })
      },
    }))

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

      const bounds: L.LatLngBoundsExpression = [
        svgToLatLng(0, SVG_HEIGHT),
        svgToLatLng(SVG_WIDTH, 0),
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
            })

            polygon.on('click', () => {
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
              opacity: category === 'river' ? 0.5 : 0.7,
              dashArray: (props['stroke-dasharray'] as string) || undefined,
              lineCap: 'round',
              lineJoin: 'round',
            }

            const polyline = L.polyline(latlngs, lineOpts)

            polyline.on('click', () => {
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
            const id = feature.id || (props.id as string) || ''

            const markerClass = MARKER_CLASSES[category] || 'marker-landmark'
            const markerSize = MARKER_SIZES[category] || [9, 9]

            const icon = L.divIcon({
              className: `${markerClass} ${isEditMode ? 'edit-mode-marker' : ''}`,
              iconSize: markerSize,
              iconAnchor: [markerSize[0] / 2, markerSize[1] / 2],
            })

            const marker = L.marker(latlng, { 
              icon,
              draggable: isEditMode
            })

            let isDragging = false
            marker.on('dragstart', () => { isDragging = true })
            marker.on('click', () => {
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
        d3Overlay.destroy()
        animFrameIdsRef.current.forEach((id) => cancelAnimationFrame(id))
        animFrameIdsRef.current.clear()
        map.remove()
        mapRef.current = null
        layerGroupsRef.current.clear()
        markersRef.current.clear()
      }
    }, [geojson, featuresByCategory, onFeatureClick])

    // Toggle layer visibility
    useEffect(() => {
      if (!mapRef.current) return
      for (const [category, group] of layerGroupsRef.current.entries()) {
        const visible = layers[category as keyof LayerVisibility]
        if (visible === undefined) continue
        
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
    }, [layers])

    // Highlight selected marker
    useEffect(() => {
      markersRef.current.forEach((marker, id) => {
        const el = marker.getElement?.()
        if (el) {
          el.classList.toggle('selected', id === selectedFeatureId)
        }
      })
    }, [selectedFeatureId])

    return <div ref={containerRef} className="map-container" id="veydria-map" />
  }
)

export default MapViewer
