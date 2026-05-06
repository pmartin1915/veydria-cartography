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
import { formatDistance } from '../utils/measure'
import type { LayerOpacity } from '../App'

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
  faction_control: boolean
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
  initialViewport?: { zoom: number; centerX: number; centerY: number }
  onViewportChange?: (viewport: { zoom: number; centerX: number; centerY: number }) => void
  onMeasureUpdate?: (stats: { pointCount: number; totalDistance: number; segments: number[] }) => void
  opacities?: LayerOpacity
}

export interface MapViewerHandle {
  flyToFeature: (feature: GeoJSONFeature) => void
  flyToFeatureById: (featureId: string) => boolean
  undoMeasurePoint: () => void
  clearMeasurePoints: () => void
  updateFeaturePosition: (featureId: string, coords: [number, number]) => void
  setFactionOverlay: (enabled: boolean) => void
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

const CIV_COLORS: Record<string, string> = {
  ngaru_bon: '#9a8a7a',
  irrah: '#b8a060',
  kheshkai: '#8a9a5a',
  ndjadi: '#5a9a6a',
  qollari: '#4a8a7a',
  oravan: '#4a7a9a',
}



const MapViewer = forwardRef<MapViewerHandle, MapViewerProps>(
  function MapViewer({ geojson, layers, onFeatureClick, onFeatureSelect, selectedFeatureId, isEditMode, onCoordinateUpdate, measureMode, initialViewport, onViewportChange, onMeasureUpdate, opacities }, ref) {
    const mapRef = useRef<L.Map | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const layerGroupsRef = useRef<Map<string, L.LayerGroup>>(new Map())
    const layerRefsRef = useRef<Map<string, L.Layer[]>>(new Map())
    const terrainCellMetaRef = useRef<Map<string, { polygon: L.Polygon; elevation: number; civ: string }>>(new Map())
    const markersRef = useRef<Map<string, L.Marker>>(new Map())
    const measureLayerRef = useRef<L.LayerGroup | null>(null)
    const measureLabelRef = useRef<L.Marker | null>(null)
    const geojsonRef = useRef(geojson)
    useEffect(() => { geojsonRef.current = geojson }, [geojson])

    const measureModeRef = useRef(measureMode)

    // Keep ref in sync so event handlers see current value without re-binding
    useEffect(() => {
      measureModeRef.current = measureMode
    }, [measureMode])

    const [zoomLevel, setZoomLevel] = useState<number>(-1)
    const [measurePoints, setMeasurePoints] = useState<Array<{x: number, y: number}>>([])

    // Expose flyToFeature to parent
    useImperativeHandle(ref, () => ({
      flyToFeature(feature: GeoJSONFeature) {
        if (!mapRef.current) return
        const [x, y] = getCentroid(feature.geometry.coordinates, feature.geometry.type)
        const latlng = svgToLatLng(x, y)
        mapRef.current.flyTo(latlng as L.LatLngExpression, 1.5, { duration: 0.8 })
      },
      flyToFeatureById(featureId: string) {
        const feature = geojsonRef.current.features.find((f) => {
          const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
          return id === featureId
        })
        if (!feature || !mapRef.current) return false
        const [x, y] = getCentroid(feature.geometry.coordinates, feature.geometry.type)
        const latlng = svgToLatLng(x, y)
        mapRef.current.flyTo(latlng as L.LatLngExpression, 2, { duration: 1 })
        return true
      },
      undoMeasurePoint() {
        setMeasurePoints(prev => prev.slice(0, -1))
      },
      clearMeasurePoints() {
        setMeasurePoints([])
      },
      updateFeaturePosition(featureId: string, coords: [number, number]) {
        const marker = markersRef.current.get(featureId)
        if (marker) {
          marker.setLatLng(svgToLatLng(coords[0], coords[1]))
        }
      },
      setFactionOverlay(enabled: boolean) {
        for (const { polygon, elevation, civ } of terrainCellMetaRef.current.values()) {
          polygon.setStyle({ fillColor: enabled ? (CIV_COLORS[civ] || '#888') : getElevationColor(elevation) })
        }
      },
    }))

    // Clear measure points when measure mode is turned off
    useEffect(() => {
      if (!measureMode) {
        setMeasurePoints([])
      }
    }, [measureMode])

    // Backspace to undo last point in measure mode
    useEffect(() => {
      if (!measureMode) return
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Backspace') {
          e.preventDefault()
          setMeasurePoints(prev => prev.length > 0 ? prev.slice(0, -1) : prev)
        }
      }
      window.addEventListener('keydown', handler)
      return () => window.removeEventListener('keydown', handler)
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

      // Report viewport changes to parent (throttled naturally by moveend)
      let initialMoveSkipped = false
      const handleMoveEnd = () => {
        if (!initialMoveSkipped) {
          initialMoveSkipped = true
          return // Skip the first moveend from initial fitBounds/setView
        }
        if (!onViewportChange) return
        const center = map.getCenter()
        const zoom = map.getZoom()
        onViewportChange({
          zoom,
          centerX: center.lng,
          centerY: SVG_HEIGHT - center.lat,
        })
      }
      map.on('moveend', handleMoveEnd)

      // Apply initial viewport after fitBounds
      if (initialViewport) {
        const latlng = svgToLatLng(initialViewport.centerX, initialViewport.centerY)
        map.setView(latlng as L.LatLngExpression, initialViewport.zoom, { animate: false })
      }

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

      // Separate features by type (computed inline so geojson ref changes
      // don't trigger a full layer rebuild)
      const featuresByCategory: Record<string, GeoJSONFeature[]> = {}
      for (const feature of geojsonRef.current.features) {
        const cat = (feature.properties.category as string) || 'unknown'
        if (!featuresByCategory[cat]) featuresByCategory[cat] = []
        featuresByCategory[cat].push(feature)
      }

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
        const layerRefs: L.Layer[] = []

        for (const feature of features) {
          const props = feature.properties
          const geomType = feature.geometry.type

          if (geomType === 'Polygon') {
            const coords = feature.geometry.coordinates as number[][][]
            const latlngs = coords[0].map(([x, y]) => svgToLatLng(x, y))

            let fillColor = (props.fill as string) || '#888'
            let fillOpacity = 0.2
            let weight = 1.5

            const defaultOpacity = opacities?.[category as keyof LayerOpacity] ?? 1
            if (category === 'water') {
              fillOpacity = defaultOpacity
              weight = 2
            } else if (category === 'terrain_cell') {
              const civ = (props.civ as string) || ''
              fillColor = layers.faction_control
                ? (CIV_COLORS[civ] || '#888')
                : getElevationColor(props.elevation as number || 0)
              fillOpacity = defaultOpacity
              weight = 0
            } else if (category === 'civilization') {
              fillOpacity = defaultOpacity * 0.3
            }

            const polygon = L.polygon(latlngs, {
              color: category === 'terrain_cell' ? 'none' : ((props.fill as string) || '#888'),
              fillColor,
              fillOpacity,
              weight,
              opacity: category === 'terrain_cell' ? 0 : defaultOpacity * 0.5,
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
              `<div class="popup-name">${props.name}</div><div class="popup-category">${(category || '').replaceAll('_', ' ')}</div>`,
              { direction: 'center', className: 'leaflet-popup-content-wrapper' }
            )

            polygon.addTo(group)
            layerRefs.push(polygon)

            if (category === 'terrain_cell') {
              const fid = (feature as unknown as Record<string, unknown>).id as string || (props.id as string) || ''
              terrainCellMetaRef.current.set(fid, {
                polygon,
                elevation: (props.elevation as number) || 0,
                civ: (props.civ as string) || '',
              })
            }

          } else if (geomType === 'LineString') {
            const coords = feature.geometry.coordinates as number[][]
            const latlngs = coords.map(([x, y]) => svgToLatLng(x, y))

            const defaultLineOpacity = opacities?.[category as keyof LayerOpacity] ?? (category === 'river' ? 0.6 : 0.7)
            const lineOpts: L.PolylineOptions = {
              color: (props.stroke as string) || '#888',
              weight: (props['stroke-width'] as number) || 2.5,
              opacity: defaultLineOpacity,
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
            layerRefs.push(polyline)

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

            const catLabel = (category || '').replaceAll('_', ' ')
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
        layerRefsRef.current.set(category, layerRefs)
      }

      // Initialize D3 overlay for trade routes
      const tradeRoutes = featuresByCategory['trade_route'] || []
      const d3Overlay = initD3Overlay(map, tradeRoutes, onFeatureClick)
      d3Overlay.setOpacity(opacities?.trade_route ?? 0.75)
      // Store in layer groups ref so it can be toggled
      layerGroupsRef.current.set('trade_route', {
        addTo: () => d3Overlay.setVisibility(true),
        removeFrom: () => d3Overlay.setVisibility(false),
        setOpacity: (o: number) => d3Overlay.setOpacity(o),
      } as any)

      mapRef.current = map

      return () => {
        map.off('zoom', updateZoom)
        map.off('moveend', handleMoveEnd)
        map.off('click', handleMapClick)
        d3Overlay.destroy()
        map.remove()
        mapRef.current = null
        layerGroupsRef.current.clear()
        layerRefsRef.current.clear()
        terrainCellMetaRef.current.clear()
        markersRef.current.clear()
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onFeatureClick, initialViewport, onViewportChange])

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

    // Faction overlay: tint terrain cells by controlling civilization
    useEffect(() => {
      const enabled = layers.faction_control
      for (const { polygon, elevation, civ } of terrainCellMetaRef.current.values()) {
        polygon.setStyle({ fillColor: enabled ? (CIV_COLORS[civ] || '#888') : getElevationColor(elevation) })
      }
    }, [layers.faction_control])

    // Update layer opacity when opacities change
    useEffect(() => {
      if (!opacities) return
      for (const [category, layerRefs] of layerRefsRef.current.entries()) {
        const opacity = opacities[category as keyof LayerOpacity]
        if (opacity === undefined) continue
        for (const layer of layerRefs) {
          if (layer instanceof L.Polygon) {
            const isTerrain = category === 'terrain_cell'
            layer.setStyle({ fillOpacity: isTerrain ? opacity : opacity * 0.3, opacity: isTerrain ? 0 : opacity * 0.5 })
          } else if (layer instanceof L.Polyline) {
            layer.setStyle({ opacity })
          }
        }
      }
      // D3 overlay opacity
      const d3Group = layerGroupsRef.current.get('trade_route')
      if (d3Group && 'setOpacity' in d3Group) {
        (d3Group as unknown as { setOpacity: (o: number) => void }).setOpacity(opacities.trade_route)
      }
    }, [opacities])

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

      if (measurePoints.length === 0) {
        if (onMeasureUpdate) onMeasureUpdate({ pointCount: 0, totalDistance: 0, segments: [] })
        return
      }

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

      // Draw lines between consecutive points + segment labels
      const segmentDistances: number[] = []
      if (measurePoints.length >= 2) {
        for (let i = 1; i < measurePoints.length; i++) {
          const a = measurePoints[i - 1]
          const b = measurePoints[i]
          const dx = b.x - a.x
          const dy = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          segmentDistances.push(dist)

          const latlngs = [svgToLatLng(a.x, a.y), svgToLatLng(b.x, b.y)]
          L.polyline(latlngs, {
            color: '#e8c840',
            weight: 2,
            opacity: 0.7,
            dashArray: '6,4',
            lineCap: 'round',
            className: 'measure-line',
          }).addTo(group)

          // Small segment label at midpoint
          const midX = (a.x + b.x) / 2
          const midY = (a.y + b.y) / 2
          const segLabel = L.divIcon({
            className: 'measure-label measure-segment-label',
            html: `<div class="measure-label-inner measure-segment-inner">${formatDistance(dist)}</div>`,
            iconSize: [100, 20],
            iconAnchor: [50, 10],
          })
          L.marker(svgToLatLng(midX, midY) as L.LatLngExpression, {
            icon: segLabel,
            interactive: false,
            zIndexOffset: 999,
          }).addTo(group)
        }
      }

      group.addTo(mapRef.current)
      measureLayerRef.current = group

      // Total distance label at last point
      let totalSvgDist = 0
      for (let i = 1; i < measurePoints.length; i++) {
        const dx = measurePoints[i].x - measurePoints[i - 1].x
        const dy = measurePoints[i].y - measurePoints[i - 1].y
        totalSvgDist += Math.sqrt(dx * dx + dy * dy)
      }

      if (measurePoints.length >= 2) {
        const lastPt = measurePoints[measurePoints.length - 1]
        const totalLabel = L.divIcon({
          className: 'measure-label measure-total-label',
          html: `<div class="measure-label-inner measure-total-inner">Total: ${formatDistance(totalSvgDist)}</div>`,
          iconSize: [160, 26],
          iconAnchor: [80, 13],
        })
        const labelMarker = L.marker(svgToLatLng(lastPt.x, lastPt.y) as L.LatLngExpression, {
          icon: totalLabel,
          interactive: false,
          zIndexOffset: 1001,
        })
        labelMarker.addTo(mapRef.current)
        measureLabelRef.current = labelMarker
      }

      // Report stats to parent
      if (onMeasureUpdate) {
        onMeasureUpdate({ pointCount: measurePoints.length, totalDistance: totalSvgDist, segments: segmentDistances })
      }

      return () => {
        if (measureLayerRef.current && mapRef.current) {
          mapRef.current.removeLayer(measureLayerRef.current)
        }
        if (measureLabelRef.current && mapRef.current) {
          mapRef.current.removeLayer(measureLabelRef.current)
        }
      }
    }, [measurePoints, onMeasureUpdate])

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
