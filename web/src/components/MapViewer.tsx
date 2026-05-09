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
import { initHexOverlay, type HexOverlay } from '../utils/hex-overlay'
import type { HexCell } from '../utils/hex-grid'
import { formatDistance, svgDistanceToKm } from '../utils/measure'
import type { LayerOpacity } from '../App'
import type { JourneyRoute } from '../utils/journey-graph'
import type { MapAnnotation } from '../utils/annotations'
import { createAnnotation, ANNOTATION_COLORS, findNearestFeature } from '../utils/annotations'
import { iconWarningHtml, iconBoxHtml, iconBoltHtml } from './icons'

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
  hex_grid: boolean
  trade_route: boolean
  landmark: boolean
  river: boolean
  faction_control: boolean
  terrain_cost: boolean
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
  pinMode?: boolean
  annotations?: MapAnnotation[]
  onAnnotationAdd?: (annotation: MapAnnotation) => void
  onAnnotationUpdate?: (id: string, updates: Partial<Omit<MapAnnotation, 'id' | 'createdAt'>>) => void
  onAnnotationDelete?: (id: string) => void
  initialViewport?: { zoom: number; centerX: number; centerY: number }
  onViewportChange?: (viewport: { zoom: number; centerX: number; centerY: number }) => void
  onMeasureUpdate?: (stats: { pointCount: number; totalDistance: number; segments: number[] }) => void
  opacities?: LayerOpacity
  route?: JourneyRoute | null
  onHoverHex?: (hex: { hex: HexCell; descriptors: string[] } | null) => void
  onSelectHex?: (hex: { hex: HexCell; descriptors: string[] }) => void
  hexSize?: number
  selectedHexLabel?: string | null
}

export interface MapViewerHandle {
  flyToFeature: (feature: GeoJSONFeature) => void
  flyToFeatureById: (featureId: string) => boolean
  flyToAnnotation: (annotation: MapAnnotation) => void
  undoMeasurePoint: () => void
  clearMeasurePoints: () => void
  updateFeaturePosition: (featureId: string, coords: [number, number]) => void
  setFactionOverlay: (enabled: boolean) => void
  clearJourneyRoute: () => void
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

const latLngToSvgClamped = (latlng: L.LatLng) => {
  const raw = latLngToSvg(latlng)
  return {
    x: Math.max(0, Math.min(SVG_WIDTH, raw.x)),
    y: Math.max(0, Math.min(SVG_HEIGHT, raw.y)),
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function buildAnnotationPopupContent(ann: MapAnnotation): string {
  const colorsHtml = ANNOTATION_COLORS.map(c =>
    `<button type="button" class="annotation-color-btn ${c.value === ann.color ? 'active' : ''}" data-color="${escapeHtml(c.value)}" style="background:${escapeHtml(c.value)}" title="${escapeHtml(c.label)}"></button>`
  ).join('')
  const timeStr = new Date(ann.createdAt).toLocaleString()
  const linkRow = ann.featureId
    ? `<div class="annotation-popup-link annotation-popup-link--bound">
         <span class="annotation-popup-link-label">Linked: <strong>${escapeHtml(ann.featureName || ann.featureId)}</strong></span>
         <button type="button" class="annotation-popup-unlink">Unlink</button>
       </div>`
    : `<div class="annotation-popup-link">
         <button type="button" class="annotation-popup-link-nearest">Link to nearest feature</button>
       </div>`
  return `
    <div class="annotation-popup" data-id="${escapeHtml(ann.id)}">
      <input class="annotation-popup-label" type="text" value="${escapeHtml(ann.label)}" placeholder="Label..." />
      <textarea class="annotation-popup-body" rows="3" placeholder="Notes...">${escapeHtml(ann.body)}</textarea>
      <div class="annotation-popup-colors">${colorsHtml}</div>
      ${linkRow}
      <div class="annotation-popup-actions">
        <button class="annotation-popup-save" type="button">Save</button>
        <button class="annotation-popup-cancel" type="button">Cancel</button>
        <button class="annotation-popup-delete" type="button">Delete</button>
      </div>
      <div class="annotation-popup-time">${timeStr}</div>
    </div>
  `
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

function getTerrainCostColor(elev: number): string {
  const cost = elev / 500
  if (cost < 1) return '#4a9a3a'
  if (cost < 3) return '#8ab87a'
  if (cost < 5) return '#c8d4a0'
  if (cost < 7) return '#e8d5a0'
  if (cost < 9) return '#d4a060'
  if (cost < 11) return '#c06040'
  return '#803030'
}



const MapViewer = forwardRef<MapViewerHandle, MapViewerProps>(
  function MapViewer({ geojson, layers, onFeatureClick, onFeatureSelect, selectedFeatureId, isEditMode, onCoordinateUpdate, measureMode, pinMode, annotations, onAnnotationAdd, onAnnotationUpdate, onAnnotationDelete, initialViewport, onViewportChange, onMeasureUpdate, opacities, route, onHoverHex, onSelectHex, hexSize, selectedHexLabel }, ref) {
    const mapRef = useRef<L.Map | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const layerGroupsRef = useRef<Map<string, L.LayerGroup>>(new Map())
    const layerRefsRef = useRef<Map<string, L.Layer[]>>(new Map())
    const terrainCellMetaRef = useRef<Map<string, { polygon: L.Polygon; elevation: number; civ: string }>>(new Map())
    const markersRef = useRef<Map<string, L.Marker>>(new Map())
    const measureLayerRef = useRef<L.LayerGroup | null>(null)
    const measureLabelRef = useRef<L.Marker | null>(null)
    const journeyRouteLayerRef = useRef<L.LayerGroup | null>(null)
    const annotationLayerRef = useRef<L.LayerGroup | null>(null)
    const hexOverlayRef = useRef<HexOverlay | null>(null)
    const hexTooltipRef = useRef<HTMLDivElement | null>(null)
    const geojsonRef = useRef(geojson)
    useEffect(() => { geojsonRef.current = geojson }, [geojson])

    const measureModeRef = useRef(measureMode)
    const pinModeRef = useRef(pinMode)
    const onAnnotationAddRef = useRef(onAnnotationAdd)
    const onAnnotationUpdateRef = useRef(onAnnotationUpdate)
    const onAnnotationDeleteRef = useRef(onAnnotationDelete)
    const openPopupIdRef = useRef<string | null>(null)
    const annotationMarkersRef = useRef<Map<string, L.Marker>>(new Map())
    const canvasRendererRef = useRef<L.Canvas | null>(null)
    const onHoverHexRef = useRef(onHoverHex)
    const onSelectHexRef = useRef(onSelectHex)
    const layersRef = useRef(layers)

    // Keep refs in sync so event handlers see current value without re-binding
    useEffect(() => { measureModeRef.current = measureMode }, [measureMode])
    useEffect(() => { pinModeRef.current = pinMode }, [pinMode])
    useEffect(() => { onHoverHexRef.current = onHoverHex }, [onHoverHex])
    useEffect(() => { onSelectHexRef.current = onSelectHex }, [onSelectHex])
    useEffect(() => { layersRef.current = layers }, [layers])
    useEffect(() => { onAnnotationAddRef.current = onAnnotationAdd }, [onAnnotationAdd])
    useEffect(() => { onAnnotationUpdateRef.current = onAnnotationUpdate }, [onAnnotationUpdate])
    useEffect(() => { onAnnotationDeleteRef.current = onAnnotationDelete }, [onAnnotationDelete])

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
      flyToAnnotation(annotation: MapAnnotation) {
        if (!mapRef.current) return
        const latlng = svgToLatLng(annotation.x, annotation.y)
        mapRef.current.flyTo(latlng as L.LatLngExpression, 2.5, { duration: 0.8 })
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
        if (layers.terrain_cost) return // terrain_cost takes priority
        for (const { polygon, elevation, civ } of terrainCellMetaRef.current.values()) {
          polygon.setStyle({ fillColor: enabled ? (CIV_COLORS[civ] || '#888') : getElevationColor(elevation) })
        }
        ;(canvasRendererRef.current as unknown as { _redraw?: () => void } | null)?._redraw?.()
      },
      clearJourneyRoute() {
        if (journeyRouteLayerRef.current && mapRef.current) {
          mapRef.current.removeLayer(journeyRouteLayerRef.current)
          journeyRouteLayerRef.current = null
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
        zoomSnap: 0.5,
        zoomDelta: 1,
        wheelPxPerZoomLevel: 120,
        wheelDebounceTime: 30,
        zoomAnimation: true,
        markerZoomAnimation: true,
        fadeAnimation: true,
        attributionControl: false,
        zoomControl: false,
      })

      // Zoom control in top-right
      L.control.zoom({ position: 'topright' }).addTo(map)

      // Scale bar
      L.control.scale({ position: 'bottomright', metric: true, imperial: false }).addTo(map)

      // Canvas renderer for high-count layers (terrain_cell has 3000+ polygons).
      // padding 0.3 reduces tile pop-in mid-pinch on phone at the cost of a
      // slightly larger off-screen buffer.
      const canvasRenderer = L.canvas({ padding: 0.3 })
      canvasRendererRef.current = canvasRenderer

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

      // Measurement / pin / hex-select click handler. Markers don't bubble
      // to map clicks, so reaching this handler means the click missed a
      // feature — that's our cue to offer hex-select as a fallback.
      const handleMapClick = (e: L.LeafletMouseEvent) => {
        if (measureModeRef.current) {
          const svg = latLngToSvg(e.latlng)
          setMeasurePoints(prev => [...prev, { x: svg.x, y: svg.y }])
          return
        }
        if (pinModeRef.current && onAnnotationAddRef.current) {
          const svg = latLngToSvgClamped(e.latlng)
          const ann = createAnnotation(svg.x, svg.y)
          const nearest = findNearestFeature(svg.x, svg.y, geojsonRef.current.features)
          if (nearest) {
            ann.featureId = nearest.id
            ann.featureName = nearest.name
          }
          onAnnotationAddRef.current(ann)
          return
        }
        // Hex select: only when the hex grid is visible and a callback is
        // wired. Skipped if the click landed in sea-only space (no hex hit).
        if (layersRef.current.hex_grid && onSelectHexRef.current && hexOverlayRef.current) {
          const svgX = e.latlng.lng
          const svgYCoord = SVG_HEIGHT - e.latlng.lat
          const hit = hexOverlayRef.current.getHexAtSvg(svgX, svgYCoord)
          if (hit) {
            onSelectHexRef.current(hit)
            // Mirror the mobile feature-select flyTo so the hex doesn't get
            // buried under the bottom sheet.
            if (window.innerWidth <= 768 && mapRef.current) {
              const [cx, cy] = hit.hex.centroid
              const latlng = svgToLatLng(cx, cy) as [number, number]
              const eps = 0.5
              const fbounds = L.latLngBounds(
                [latlng[0] - eps, latlng[1] - eps],
                [latlng[0] + eps, latlng[1] + eps]
              )
              mapRef.current.flyToBounds(fbounds, {
                paddingBottomRight: [0, Math.round(window.innerHeight * 0.4)],
                maxZoom: Math.max(mapRef.current.getZoom(), 1),
                duration: 0.35,
              })
            }
            return
          }
        }
      }
      map.on('click', handleMapClick)

      const bounds: L.LatLngBoundsExpression = [
        svgToLatLng(0, SVG_HEIGHT) as L.LatLngTuple,
        svgToLatLng(SVG_WIDTH, 0) as L.LatLngTuple,
      ]
      // Cap initial fit so a tall phone viewport doesn't over-zoom past
      // landmark/threshold visibility. Mirrors the route fitBounds at L1040.
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 1.5 })

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
              const elevation = props.elevation as number || 0
              if (layers.terrain_cost) {
                fillColor = getTerrainCostColor(elevation)
              } else if (layers.faction_control) {
                fillColor = CIV_COLORS[civ] || '#888'
              } else {
                fillColor = getElevationColor(elevation)
              }
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
            const etymology = props.etymology ? `<div class="popup-etymology">${props.etymology}</div>` : ''
            const func = props.function ? `<div class="popup-function">${props.function}</div>` : ''
            marker.bindTooltip(
              `<div class="popup-name">${props.name}</div><div class="popup-category">${catLabel}${typeLabel}</div>${etymology}${func}`,
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

      // Hex grid overlay — ALL features sampled, not a category subset.
      const hexOverlay = initHexOverlay(map, geojson.features, hexSize)
      hexOverlay.setOpacity(opacities?.hex_grid ?? 0.7)
      hexOverlayRef.current = hexOverlay
      layerGroupsRef.current.set('hex_grid', {
        addTo: () => hexOverlay.setVisibility(true),
        removeFrom: () => hexOverlay.setVisibility(false),
        setOpacity: (o: number) => hexOverlay.setOpacity(o),
      } as any)

      mapRef.current = map

      // Mobile Safari measures the container before the address bar settles,
      // so Leaflet's first sizing pass can be wrong — the map then sits in a
      // small slice of the visible viewport with the rest blank. Force a
      // re-measure once the layout has settled, and again on window resize
      // (orientation change, address-bar show/hide). pan: false avoids the
      // animated re-center that would otherwise jolt the user.
      const resyncSize = () => {
        if (!mapRef.current) return
        mapRef.current.invalidateSize({ pan: false })
      }
      const t1 = window.setTimeout(resyncSize, 0)
      const t2 = window.setTimeout(resyncSize, 250)
      window.addEventListener('resize', resyncSize)
      window.addEventListener('orientationchange', resyncSize)

      // Hex-grid hover tooltip. One floating div, not one Leaflet tooltip
      // per hex — at ~220 hexes the latter is wasteful. We map mouse to
      // SVG coords and ask the overlay which hex contains it.
      const tip = document.createElement('div')
      tip.className = 'hex-tooltip'
      tip.style.display = 'none'
      if (containerRef.current) containerRef.current.appendChild(tip)
      hexTooltipRef.current = tip
      const handleMouseMove = (e: L.LeafletMouseEvent) => {
        if (!hexOverlayRef.current) return
        // Convert lat/lng → SVG (CRS.Simple flips Y; svgY = SVG_HEIGHT - lat).
        const svgX = e.latlng.lng
        const svgYCoord = SVG_HEIGHT - e.latlng.lat
        const hit = hexOverlayRef.current.getHexAtSvg(svgX, svgYCoord)
        if (!hit) {
          tip.style.display = 'none'
          onHoverHexRef.current?.(null)
          return
        }
        tip.style.display = 'block'
        tip.innerHTML = `<strong>${hit.hex.label}</strong>${hit.descriptors.length ? ' &middot; ' + hit.descriptors.join(', ') : ''}`
        // Position via the original DOM event so we get container-local coords.
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const mx = (e.originalEvent as MouseEvent).clientX - rect.left
        const my = (e.originalEvent as MouseEvent).clientY - rect.top
        tip.style.left = `${mx + 14}px`
        tip.style.top = `${my + 14}px`
        onHoverHexRef.current?.(hit)
      }
      const handleMouseOut = () => {
        if (tip) tip.style.display = 'none'
        onHoverHexRef.current?.(null)
      }
      // On phones the hover tooltip steals tap-to-select. Mousemove also
      // fires on touch on many devices. Skip it entirely on mobile.
      if (!L.Browser.mobile) {
        map.on('mousemove', handleMouseMove)
        map.on('mouseout', handleMouseOut)
      }

      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
        window.removeEventListener('resize', resyncSize)
        window.removeEventListener('orientationchange', resyncSize)
        map.off('zoom', updateZoom)
        map.off('moveend', handleMoveEnd)
        map.off('click', handleMapClick)
        map.off('mousemove', handleMouseMove)
        map.off('mouseout', handleMouseOut)
        d3Overlay.destroy()
        if (hexOverlayRef.current) {
          hexOverlayRef.current.destroy()
          hexOverlayRef.current = null
        }
        if (tip.parentNode) tip.parentNode.removeChild(tip)
        hexTooltipRef.current = null
        map.remove()
        mapRef.current = null
        layerGroupsRef.current.clear()
        layerRefsRef.current.clear()
        terrainCellMetaRef.current.clear()
        markersRef.current.clear()
        annotationLayerRef.current = null
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

    // Terrain cost overlay: color cells by movement difficulty
    useEffect(() => {
      if (!mapRef.current) return
      const enabled = layers.terrain_cost
      for (const { polygon, elevation } of terrainCellMetaRef.current.values()) {
        polygon.setStyle({ fillColor: enabled ? getTerrainCostColor(elevation) : getElevationColor(elevation) })
      }
      // Force the canvas to discard cached strokes and repaint with new fillColor.
      // setStyle alone schedules a deferred redraw that often fails to flush
      // because the canvas renderer batches redraws by frame.
      ;(canvasRendererRef.current as unknown as { _redraw?: () => void } | null)?._redraw?.()
    }, [layers.terrain_cost])

    // Faction overlay: tint terrain cells by controlling civilization
    useEffect(() => {
      if (!mapRef.current) return
      const enabled = layers.faction_control
      if (layers.terrain_cost) return // terrain_cost takes priority
      for (const { polygon, elevation, civ } of terrainCellMetaRef.current.values()) {
        polygon.setStyle({ fillColor: enabled ? (CIV_COLORS[civ] || '#888') : getElevationColor(elevation) })
      }
      ;(canvasRendererRef.current as unknown as { _redraw?: () => void } | null)?._redraw?.()
    }, [layers.faction_control, layers.terrain_cost])

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

    // Rebuild hex grid when the user changes hex size.
    useEffect(() => {
      if (!hexOverlayRef.current || hexSize === undefined) return
      hexOverlayRef.current.setHexSize(hexSize)
    }, [hexSize])

    // Highlight the currently-selected hex.
    useEffect(() => {
      if (!hexOverlayRef.current) return
      hexOverlayRef.current.setSelectedLabel(selectedHexLabel ?? null)
    }, [selectedHexLabel])

    // On mobile, the InfoPanel slides up and covers ~65vh. Pan the map so
    // the selected feature stays visible above the panel. flyToBounds
    // (not flyTo) supports paddingBottomRight.
    useEffect(() => {
      if (!selectedFeatureId || !mapRef.current) return
      if (window.innerWidth > 768) return
      const feature = geojsonRef.current.features.find((f) => {
        const id = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
        return id === selectedFeatureId
      })
      if (!feature) return
      const [x, y] = getCentroid(feature.geometry.coordinates, feature.geometry.type)
      const latlng = svgToLatLng(x, y) as [number, number]
      const targetZoom = Math.max(mapRef.current.getZoom(), 1)
      const eps = 0.5 // tiny bounds around the feature; padding does the work
      const fbounds = L.latLngBounds(
        [latlng[0] - eps, latlng[1] - eps],
        [latlng[0] + eps, latlng[1] + eps]
      )
      mapRef.current.flyToBounds(fbounds, {
        paddingBottomRight: [0, Math.round(window.innerHeight * 0.55)],
        maxZoom: targetZoom,
        duration: 0.35,
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

    // Visual styles per edge type
    const EDGE_STYLES: Record<string, { color: string; weight: number; dashArray: string | null; glow: string }> = {
      trade_route:   { color: '#d4a854', weight: 5, dashArray: null,        glow: 'rgba(212,168,84,0.5)' },
      chokepoint:    { color: '#e8a030', weight: 4, dashArray: '8,6',       glow: 'rgba(232,160,48,0.45)' },
      intra_civ:     { color: '#8a7a5a', weight: 3, dashArray: '4,4',       glow: 'rgba(138,122,90,0.35)' },
      civ_link:      { color: '#8a7a5a', weight: 3, dashArray: null,        glow: 'rgba(138,122,90,0.35)' },
    }

    const TYPE_LABELS: Record<string, string> = {
      trade_route: 'Trade Route',
      chokepoint: 'Chokepoint',
      intra_civ: 'Within Civilization',
      civ_link: 'Border Crossing',
    }

    // Render journey route overlay
    useEffect(() => {
      if (!mapRef.current) return
      if (journeyRouteLayerRef.current) {
        mapRef.current.removeLayer(journeyRouteLayerRef.current)
        journeyRouteLayerRef.current = null
      }
      if (!route || route.nodes.length < 2) return

      const group = L.layerGroup()

      // Draw route segments
      for (let i = 1; i < route.nodes.length; i++) {
        const a = route.nodes[i - 1]
        const b = route.nodes[i]
        const latlngs = [svgToLatLng(a.x, a.y), svgToLatLng(b.x, b.y)]
        const edge = route.edges[i - 1]
        const style = EDGE_STYLES[edge?.type || 'intra_civ']

        const poly = L.polyline(latlngs, {
          color: style.color,
          weight: style.weight,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
          className: 'journey-route-line',
          dashArray: style.dashArray || undefined,
        })

        // Per-segment tooltip
        const km = edge ? svgDistanceToKm(edge.distanceSvg) : 0
        const days = edge?.segmentDays?.toFixed(1) || '—'
        const typeLabel = edge ? (TYPE_LABELS[edge.type] || edge.type) : ''
        const warning = edge?.seasonal ? `<div class="journey-seg-warning">${iconWarningHtml()} ${edge.seasonal}</div>` : ''
        const bottleneck = edge?.bottleneck ? `<div class="journey-seg-bottleneck">▲ ${edge.bottleneck}</div>` : ''
        const commodities = edge?.commodities ? `<div class="journey-seg-lore">${iconBoxHtml()} ${edge.commodities}</div>` : ''
        const consequence = edge?.consequenceIfClosed ? `<div class="journey-seg-consequence">${iconBoltHtml()} ${edge.consequenceIfClosed}</div>` : ''

        poly.bindTooltip(
          `<div class="journey-seg-tooltip">
            <div class="journey-seg-name">${edge?.name || ''}</div>
            <div class="journey-seg-meta">${typeLabel} · ${km.toFixed(1)} km · ~${days} days</div>
            ${commodities}
            ${bottleneck}
            ${warning}
            ${consequence}
          </div>`,
          { sticky: true, className: 'journey-seg-popup', direction: 'top' }
        )

        poly.on('mouseover', function (this: L.Polyline) {
          this.setStyle({ weight: style.weight + 2, opacity: 1 })
          this.bringToFront()
        })
        poly.on('mouseout', function (this: L.Polyline) {
          this.setStyle({ weight: style.weight, opacity: 0.9 })
        })

        poly.addTo(group)

        // Segment label at midpoint (subtle, hidden by default, shown on hover via CSS)
        const midX = (a.x + b.x) / 2
        const midY = (a.y + b.y) / 2
        const segLabel = L.divIcon({
          className: 'journey-seg-label',
          html: `<div class="journey-seg-label-inner">${edge ? edge.name : ''}</div>`,
          iconSize: [140, 16],
          iconAnchor: [70, 8],
        })
        L.marker(svgToLatLng(midX, midY) as L.LatLngExpression, {
          icon: segLabel,
          interactive: false,
          zIndexOffset: 998,
        }).addTo(group)
      }

      // Draw node markers
      route.nodes.forEach((node, i) => {
        const latlng = svgToLatLng(node.x, node.y)
        const isStart = i === 0
        const isEnd = i === route.nodes.length - 1
        const color = isStart ? '#4a9a3a' : isEnd ? '#f44' : '#c4a862'
        const radius = isStart || isEnd ? 8 : 5

        const circle = L.circleMarker(latlng as L.LatLngExpression, {
          radius,
          fillColor: color,
          color: '#fff',
          weight: 2,
          opacity: 0.9,
          fillOpacity: 0.8,
          className: 'journey-route-marker',
        })
        circle.addTo(group)

        // Node label
        const label = L.divIcon({
          className: 'measure-label',
          html: `<div class="measure-label-inner" style="font-size:10px;padding:3px 8px;">${node.name}</div>`,
          iconSize: [140, 20],
          iconAnchor: [70, 22],
        })
        L.marker(latlng as L.LatLngExpression, {
          icon: label,
          interactive: false,
          zIndexOffset: 999,
        }).addTo(group)
      })

      group.addTo(mapRef.current)
      journeyRouteLayerRef.current = group

      // Fly to fit the route
      const lls = route.nodes.map(n => svgToLatLng(n.x, n.y) as L.LatLngTuple)
      if (lls.length > 0) {
        mapRef.current.fitBounds(L.latLngBounds(lls), { padding: [60, 60], maxZoom: 2.5, animate: true, duration: 0.8 })
      }

      return () => {
        if (journeyRouteLayerRef.current && mapRef.current) {
          mapRef.current.removeLayer(journeyRouteLayerRef.current)
          journeyRouteLayerRef.current = null
        }
      }
    }, [route])

    // Render annotation pins
    useEffect(() => {
      if (!mapRef.current) return

      if (annotationLayerRef.current) {
        mapRef.current.removeLayer(annotationLayerRef.current)
        annotationLayerRef.current = null
      }
      annotationMarkersRef.current.clear()

      const group = L.layerGroup()

      for (const ann of (annotations || [])) {
        const latlng = svgToLatLng(ann.x, ann.y)

        const icon = L.divIcon({
          className: 'annotation-marker',
          html: `<div class="annotation-pin" style="--pin-color:${escapeHtml(ann.color)}"><div class="annotation-pin-head"></div><div class="annotation-pin-stem"></div></div>`,
          iconSize: [20, 28],
          iconAnchor: [10, 28],
        })

        const marker = L.marker(latlng as L.LatLngExpression, {
          icon,
          draggable: true,
          zIndexOffset: 500,
        })

        marker.bindPopup(buildAnnotationPopupContent(ann), {
          closeButton: false,
          className: 'annotation-popup-wrapper',
          offset: [0, -10],
        })

        marker.on('popupopen', () => {
          openPopupIdRef.current = ann.id
          const popup = marker.getPopup()
          const container = popup?.getElement()
          if (!container) return

          const saveBtn = container.querySelector('.annotation-popup-save')
          const cancelBtn = container.querySelector('.annotation-popup-cancel')
          const deleteBtn = container.querySelector('.annotation-popup-delete')
          const labelInput = container.querySelector('.annotation-popup-label') as HTMLInputElement | null
          const bodyTextarea = container.querySelector('.annotation-popup-body') as HTMLTextAreaElement | null
          const colorBtns = container.querySelectorAll('.annotation-color-btn')
          const linkBtn = container.querySelector('.annotation-popup-link-nearest') as HTMLButtonElement | null
          const unlinkBtn = container.querySelector('.annotation-popup-unlink') as HTMLButtonElement | null

          let selectedColor = ann.color
          let linkAction: 'none' | 'link' | 'unlink' = 'none'

          const handleSave = () => {
            // Clear ref before state update so layer rebuild won't reopen this popup
            openPopupIdRef.current = null
            const updates: Partial<Omit<MapAnnotation, 'id' | 'createdAt'>> = {
              label: labelInput?.value.trim() || ann.label,
              body: bodyTextarea?.value || '',
              color: selectedColor,
            }
            if (linkAction === 'link') {
              const nearest = findNearestFeature(ann.x, ann.y, geojsonRef.current.features)
              updates.featureId = nearest?.id
              updates.featureName = nearest?.name
            } else if (linkAction === 'unlink') {
              updates.featureId = undefined
              updates.featureName = undefined
            }
            onAnnotationUpdateRef.current?.(ann.id, updates)
            marker.closePopup()
          }

          const handleCancel = () => {
            marker.closePopup()
          }

          const handleDelete = () => {
            onAnnotationDeleteRef.current?.(ann.id)
            marker.closePopup()
          }

          const handleColorClick = (e: Event) => {
            const btn = e.currentTarget as HTMLButtonElement
            selectedColor = btn.dataset.color || ann.color
            colorBtns.forEach(b => b.classList.toggle('active', b === btn))
          }

          const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSave()
            }
            if (e.key === 'Escape') {
              e.stopPropagation()
              handleCancel()
            }
          }

          const handleLinkClick = () => {
            const nearest = findNearestFeature(ann.x, ann.y, geojsonRef.current.features)
            if (!nearest) {
              if (linkBtn) {
                linkBtn.textContent = 'No feature in range'
                linkBtn.disabled = true
              }
              linkAction = 'none'
              return
            }
            linkAction = 'link'
            if (linkBtn) {
              linkBtn.textContent = `Will link: ${nearest.name}`
              linkBtn.classList.add('annotation-popup-link-pending')
            }
          }

          const handleUnlinkClick = () => {
            linkAction = 'unlink'
            if (unlinkBtn) {
              unlinkBtn.textContent = 'Will unlink'
              unlinkBtn.disabled = true
            }
          }

          saveBtn?.addEventListener('click', handleSave)
          cancelBtn?.addEventListener('click', handleCancel)
          deleteBtn?.addEventListener('click', handleDelete)
          colorBtns.forEach(btn => btn.addEventListener('click', handleColorClick))
          labelInput?.addEventListener('keydown', handleKeyDown)
          bodyTextarea?.addEventListener('keydown', handleKeyDown)
          linkBtn?.addEventListener('click', handleLinkClick)
          unlinkBtn?.addEventListener('click', handleUnlinkClick)

          marker.once('popupclose', () => {
            openPopupIdRef.current = null
            saveBtn?.removeEventListener('click', handleSave)
            cancelBtn?.removeEventListener('click', handleCancel)
            deleteBtn?.removeEventListener('click', handleDelete)
            colorBtns.forEach(btn => btn.removeEventListener('click', handleColorClick))
            labelInput?.removeEventListener('keydown', handleKeyDown)
            bodyTextarea?.removeEventListener('keydown', handleKeyDown)
            linkBtn?.removeEventListener('click', handleLinkClick)
            unlinkBtn?.removeEventListener('click', handleUnlinkClick)
          })
        })

        marker.on('dragstart', () => {
          marker.closePopup()
        })

        marker.on('dragend', (e) => {
          const newLatLng = (e.target as L.Marker).getLatLng()
          const newSvg = latLngToSvgClamped(newLatLng)
          onAnnotationUpdateRef.current?.(ann.id, { x: newSvg.x, y: newSvg.y })
        })

        marker.addTo(group)
        annotationMarkersRef.current.set(ann.id, marker)
      }

      group.addTo(mapRef.current)
      annotationLayerRef.current = group

      // If a popup was open before rebuild (e.g. external update), reopen it
      if (openPopupIdRef.current) {
        const markerToOpen = annotationMarkersRef.current.get(openPopupIdRef.current)
        if (markerToOpen) {
          markerToOpen.openPopup()
        } else {
          openPopupIdRef.current = null
        }
      }

      return () => {
        if (annotationLayerRef.current && mapRef.current) {
          mapRef.current.removeLayer(annotationLayerRef.current)
          annotationLayerRef.current = null
        }
        annotationMarkersRef.current.clear()
      }
    }, [annotations])

    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div ref={containerRef} className={`map-container ${measureMode ? 'measure-mode' : ''} ${pinMode ? 'pin-mode' : ''}`} id="veydria-map" />
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
