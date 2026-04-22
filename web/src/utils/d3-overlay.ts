/**
 * d3-overlay.ts — D3 GeoJSON bridge for Leaflet
 *
 * Renders trade routes and other vector features as D3 SVG paths
 * overlaid on the Leaflet map. This provides more flexible styling
 * than Leaflet's built-in polyline rendering.
 *
 * STUB — initial implementation uses Leaflet's native polyline rendering.
 * This module will be fleshed out when we need:
 * - Animated trade route flows
 * - Custom arrowheads and route markers
 * - Dynamic route highlighting
 * - Hover-based route info
 */

import * as d3 from 'd3'
import L from 'leaflet'
import { GeoJSONFeature } from '../App'

// Convert SVG coordinate to Leaflet LatLng
const SVG_HEIGHT = 800
function svgToLatLng(x: number, y: number): L.LatLng {
  return L.latLng(SVG_HEIGHT - y, x)
}

export function initD3Overlay(
  map: L.Map,
  features: GeoJSONFeature[],
  onFeatureClick: (feature: GeoJSONFeature) => void
) {
  // Use Leaflet's built-in SVG renderer pane
  L.svg().addTo(map)
  
  const svg = d3.select(map.getPanes().overlayPane).select<SVGSVGElement>('svg')
  const g = svg.select<SVGGElement>('g.leaflet-zoom-hide')
  
  // Clean up any existing D3 routes if re-initializing
  g.selectAll('.d3-route-group').remove()
  const routeGroup = g.append('g').attr('class', 'd3-route-group')

  // Inject defs for arrowheads and gradients
  let defs = svg.select<SVGDefsElement>('defs')
  if (defs.empty()) {
    defs = svg.append('defs')
  }

  // Add arrowhead marker
  defs.selectAll('#route-arrow').data([1]).join('marker')
    .attr('id', 'route-arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 8)
    .attr('refY', 0)
    .attr('markerWidth', 5)
    .attr('markerHeight', 5)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-4L10,0L0,4')
    .attr('fill', 'context-stroke') // Inherit stroke color (works in modern browsers)
    .attr('opacity', 0.8)

  // Map features to D3 path elements
  const paths = routeGroup
    .selectAll('path')
    .data(features)
    .join('path')
    .attr('class', 'd3-route-path')
    .attr('stroke', d => (d.properties.stroke as string) || '#888')
    .attr('stroke-width', d => (d.properties['stroke-width'] as number) || 2.5)
    .attr('stroke-dasharray', d => (d.properties['stroke-dasharray'] as string) || '5,5')
    .attr('fill', 'none')
    .attr('opacity', 0.8)
    .attr('marker-mid', 'url(#route-arrow)') // Add arrows to midpoints if we chunk the path
    .style('cursor', 'pointer')
    .on('click', (event, d) => onFeatureClick(d))
    .on('mouseover', function () {
      d3.select(this)
        .transition()
        .duration(200)
        .attr('stroke-width', d => ((d as GeoJSONFeature).properties['stroke-width'] as number || 2.5) + 2)
        .attr('opacity', 1)
    })
    .on('mouseout', function () {
      d3.select(this)
        .transition()
        .duration(200)
        .attr('stroke-width', d => (d as GeoJSONFeature).properties['stroke-width'] as number || 2.5)
        .attr('opacity', 0.8)
    })

  // Function to project coordinates using Leaflet's current transform
  function projectPoint(x: number, y: number) {
    const latlng = svgToLatLng(x, y)
    const point = map.latLngToLayerPoint(latlng)
    return [point.x, point.y]
  }

  // D3 line generator
  const line = d3.line<number[]>()
    .x(d => projectPoint(d[0], d[1])[0])
    .y(d => projectPoint(d[0], d[1])[1])
    .curve(d3.curveCatmullRom.alpha(0.5)) // Smooth curves

  // Update function called on zoom/pan
  function update() {
    paths.attr('d', d => {
      if (d.geometry.type === 'LineString') {
        const coords = d.geometry.coordinates as number[][]
        return line(coords)
      }
      return null
    })
    
    // In D3, marker-mid only appears at vertices. We can generate sub-segments if we want more arrows,
    // but for now we'll just draw the line. To make the line flow, we use CSS animations on the stroke-dashoffset.
  }

  // Initial draw
  update()

  // Bind to Leaflet events
  map.on('zoom', update)
  map.on('viewreset', update)
  map.on('moveend', update)

  return {
    update,
    destroy: () => {
      map.off('zoom', update)
      map.off('viewreset', update)
      map.off('moveend', update)
      routeGroup.remove()
    },
    setVisibility: (visible: boolean) => {
      routeGroup.style('display', visible ? null : 'none')
    }
  }
}
