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

interface GeoJSONCollection {
  type: 'FeatureCollection'
  metadata?: Record<string, unknown>
  features: GeoJSONFeature[]
}

interface LayerVisibility {
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

interface MapViewerProps {
  geojson: GeoJSONCollection
  layers: LayerVisibility
  onFeatureClick: (feature: GeoJSONFeature) => void
  selectedFeatureId?: string
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

const MapViewer = forwardRef<MapViewerHandle, MapViewerProps>(
  function MapViewer({ geojson, layers, onFeatureClick, selectedFeatureId }, ref) {
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
        // Render order: water first, then polys, lines, points last (on top)
        ['water', featuresByCategory['water'] || []],
        ['civilization', featuresByCategory['civilization'] || []],
        ['river', featuresByCategory['river'] || []],
        ['trade_route', featuresByCategory['trade_route'] || []],
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

            const polygon = L.polygon(latlngs, {
              color: (props.fill as string) || '#888',
              fillColor: (props.fill as string) || '#888',
              fillOpacity: category === 'water' ? 0.5 : 0.2,
              weight: category === 'water' ? 2 : 1.5,
              opacity: 0.5,
              className: `poly-${category}`,
            })

            polygon.on('click', () => onFeatureClick(feature))
            polygon.on('mouseover', function (this: L.Polygon) {
              this.setStyle({ fillOpacity: category === 'water' ? 0.7 : 0.4, weight: 2.5 })
            })
            polygon.on('mouseout', function (this: L.Polygon) {
              this.setStyle({ fillOpacity: category === 'water' ? 0.5 : 0.2, weight: category === 'water' ? 2 : 1.5 })
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

            polyline.on('click', () => onFeatureClick(feature))
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

            // --- Animated particles for trade routes ---
            if (category === 'trade_route') {
              const particleCount = 3
              const particleMarkers: L.CircleMarker[] = []

              for (let p = 0; p < particleCount; p++) {
                const particle = L.circleMarker(latlngs[0] as L.LatLngExpression, {
                  radius: 3,
                  color: (props.stroke as string) || '#888',
                  fillColor: '#fff',
                  fillOpacity: 0.9,
                  weight: 1,
                  opacity: 0.8,
                  className: 'route-particle',
                })
                particle.addTo(group)
                particleMarkers.push(particle)
              }

              // Animate particles along the route
              let t = 0
              const totalLen = latlngs.length - 1
              const animate = () => {
                t += 0.003
                for (let p = 0; p < particleCount; p++) {
                  const offset = (t + p / particleCount) % 1
                  const segIdx = Math.floor(offset * totalLen)
                  const segFrac = (offset * totalLen) - segIdx
                  if (segIdx < totalLen) {
                    const from = latlngs[segIdx] as L.LatLng
                    const to = latlngs[segIdx + 1] as L.LatLng
                    const lat = (from as unknown as { lat: number }).lat + ((to as unknown as { lat: number }).lat - (from as unknown as { lat: number }).lat) * segFrac
                    const lng = (from as unknown as { lng: number }).lng + ((to as unknown as { lng: number }).lng - (from as unknown as { lng: number }).lng) * segFrac
                    particleMarkers[p].setLatLng([lat, lng])
                  }
                }
                animFrameIdsRef.current.add(requestAnimationFrame(animate))
              }
              animFrameIdsRef.current.add(requestAnimationFrame(animate))
            }

          } else if (geomType === 'Point') {
            const [x, y] = feature.geometry.coordinates as number[]
            const latlng = svgToLatLng(x, y)
            const id = props.id as string

            const markerClass = MARKER_CLASSES[category] || 'marker-landmark'
            const markerSize = MARKER_SIZES[category] || [9, 9]

            const icon = L.divIcon({
              className: markerClass,
              iconSize: markerSize,
              iconAnchor: [markerSize[0] / 2, markerSize[1] / 2],
            })

            const marker = L.marker(latlng, { icon })

            marker.on('click', () => onFeatureClick(feature))

            const catLabel = (category || '').replace('_', ' ')
            const typeLabel = props.type ? ` · ${props.type}` : ''
            marker.bindTooltip(
              `<div class="popup-name">${props.name}</div><div class="popup-category">${catLabel}${typeLabel}</div>`,
              { direction: 'top', offset: [0, -8], className: 'leaflet-popup-content-wrapper' }
            )

            marker.addTo(group)
            markersRef.current.set(id, marker)
          }
        }

        group.addTo(map)
        layerGroupsRef.current.set(category, group)
      }

      mapRef.current = map

      return () => {
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
        if (visible && !mapRef.current.hasLayer(group)) {
          group.addTo(mapRef.current)
        } else if (!visible && mapRef.current.hasLayer(group)) {
          mapRef.current.removeLayer(group)
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
