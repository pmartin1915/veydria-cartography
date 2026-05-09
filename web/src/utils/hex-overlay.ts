/**
 * hex-overlay.ts — SVG hex-grid overlay for Leaflet.
 *
 * Renders the hex cells from hex-grid.ts onto Leaflet's overlay pane,
 * mirroring the lifecycle pattern used by d3-overlay.ts. Grid geometry
 * is rebuilt on hex-size change (rare). Pan/zoom only triggers Leaflet's
 * built-in transform.
 *
 * Returns:
 *   update           — recompute descriptors (called on features change)
 *   destroy          — tear down listeners + DOM
 *   setVisibility    — toggle group display
 *   setOpacity       — opacity multiplier on the whole group
 *   setHexSize       — rebuild grid at a different cell radius
 *   getHexAtSvg      — resolve { hex, descriptors } at an SVG-space point
 *                      for the parent to drive a hover tooltip
 */

import * as d3 from 'd3'
import L from 'leaflet'
import type { GeoJSONFeature } from '../App'
import {
  generateHexGrid,
  pixelToAxial,
  roundAxial,
  sampleHexFeatures,
  type HexCell,
  type AxialCoord,
} from './hex-grid'

const SVG_HEIGHT = 800
const SVG_WIDTH = 1200
export const DEFAULT_HEX_SIZE = 50
// At zoom levels below this, labels overlap into illegibility — drop them.
const LABEL_MIN_ZOOM = 1

export interface HexOverlay {
  update: () => void
  destroy: () => void
  setVisibility: (visible: boolean) => void
  setOpacity: (opacity: number) => void
  setHexSize: (size: number) => void
  setSelectedLabel: (label: string | null) => void
  setMeasurePath: (labels: string[] | null) => void
  getHexAtSvg: (svgX: number, svgY: number) => { hex: HexCell; descriptors: string[] } | null
  getHexByLabel: (label: string) => { hex: HexCell; descriptors: string[] } | null
}

export function initHexOverlay(
  map: L.Map,
  features: GeoJSONFeature[],
  initialHexSize: number = DEFAULT_HEX_SIZE,
): HexOverlay {
  L.svg().addTo(map)

  const svg = d3.select(map.getPanes().overlayPane).select<SVGSVGElement>('svg')
  const g = svg.select<SVGGElement>('g.leaflet-zoom-hide')

  g.selectAll('.hex-grid-group').remove()
  const hexGroup = g.append('g').attr('class', 'hex-grid-group')

  let currentHexSize = initialHexSize
  let cells: HexCell[] = []
  const descriptorsByLabel = new Map<string, string[]>()
  const cellByAxial = new Map<string, HexCell>()
  let isVisible = false
  let selectedLabel: string | null = null
  // Measure-path state. `measurePathSet` is every cell along the line;
  // `measureEndpoints` is just the two clicked ends (drawn brighter).
  const measurePathSet = new Set<string>()
  const measureEndpoints = new Set<string>()

  function svgY(y: number): number {
    // Leaflet CRS.Simple flips Y. hex-grid produces SVG-space coords
    // (origin top-left); the overlay pane uses flipped Y.
    return SVG_HEIGHT - y
  }

  function rebuild(size: number) {
    currentHexSize = size
    cells = generateHexGrid(SVG_WIDTH, SVG_HEIGHT, size)
    descriptorsByLabel.clear()
    cellByAxial.clear()
    for (const cell of cells) {
      descriptorsByLabel.set(cell.label, sampleHexFeatures(cell, features))
      cellByAxial.set(`${cell.coord.q},${cell.coord.r}`, cell)
    }

    // Wipe previous geometry. d3's join with key fn on a fresh dataset
    // produces orphan exits we don't want to keep around.
    hexGroup.selectAll('g.hex-cell').remove()

    const cellSel = hexGroup
      .selectAll<SVGGElement, HexCell>('g.hex-cell')
      .data(cells, (d) => d.label)
      .join('g')
      .attr('class', 'hex-cell')

    cellSel
      .append('polygon')
      .attr('points', (d) => d.corners.map(([x, y]) => `${x},${svgY(y)}`).join(' '))
      .attr('fill', 'rgba(212, 168, 84, 0.04)')
      .attr('stroke', 'rgba(212, 168, 84, 0.45)')
      .attr('stroke-width', 0.6)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('data-label', (d) => d.label)

    // Scale label size with hex radius so smaller hexes don't crowd.
    const fontSize = Math.max(5, Math.round(size * 0.16))
    cellSel
      .append('text')
      .attr('class', 'hex-label')
      .attr('x', (d) => d.centroid[0])
      .attr('y', (d) => svgY(d.centroid[1]))
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', 'rgba(244, 220, 160, 0.55)')
      .attr('font-size', fontSize)
      .attr('font-family', 'Georgia, serif')
      .attr('pointer-events', 'none')
      .text((d) => d.label)

    applyZoomLabels()
    applySelectionStyle()
  }

  function applySelectionStyle() {
    // Priority: measure endpoint > selectedLabel > measure mid-path > default.
    hexGroup.selectAll<SVGPolygonElement, HexCell>('polygon')
      .attr('fill', function () {
        const label = this.getAttribute('data-label') ?? ''
        if (measureEndpoints.has(label)) return 'rgba(126, 196, 230, 0.34)'
        if (label === selectedLabel) return 'rgba(212, 168, 84, 0.22)'
        if (measurePathSet.has(label)) return 'rgba(126, 196, 230, 0.16)'
        return 'rgba(212, 168, 84, 0.04)'
      })
      .attr('stroke', function () {
        const label = this.getAttribute('data-label') ?? ''
        if (measureEndpoints.has(label)) return 'rgba(186, 226, 244, 0.95)'
        if (label === selectedLabel) return 'rgba(244, 220, 160, 0.95)'
        if (measurePathSet.has(label)) return 'rgba(160, 212, 232, 0.7)'
        return 'rgba(212, 168, 84, 0.45)'
      })
      .attr('stroke-width', function () {
        const label = this.getAttribute('data-label') ?? ''
        if (measureEndpoints.has(label)) return 1.8
        if (label === selectedLabel) return 1.6
        if (measurePathSet.has(label)) return 1.0
        return 0.6
      })
  }

  function applyZoomLabels() {
    const z = map.getZoom()
    const showLabels = z >= LABEL_MIN_ZOOM
    hexGroup.selectAll('text').style('display', showLabels ? 'block' : 'none')
  }

  rebuild(initialHexSize)
  hexGroup.style('display', 'none')

  map.on('zoomend', applyZoomLabels)

  return {
    update: () => {
      // Re-sample descriptors against the latest features ref. Keep the
      // grid geometry — that's a function of the SVG canvas, not the data.
      descriptorsByLabel.clear()
      for (const cell of cells) {
        descriptorsByLabel.set(cell.label, sampleHexFeatures(cell, features))
      }
    },
    destroy: () => {
      map.off('zoomend', applyZoomLabels)
      hexGroup.remove()
      cellByAxial.clear()
      descriptorsByLabel.clear()
      cells = []
    },
    setVisibility: (visible: boolean) => {
      isVisible = visible
      hexGroup.style('display', visible ? 'block' : 'none')
      if (visible) applyZoomLabels()
    },
    setOpacity: (opacity: number) => {
      hexGroup.style('opacity', String(opacity))
    },
    setHexSize: (size: number) => {
      if (size === currentHexSize) return
      rebuild(size)
      // Preserve visibility state across rebuild.
      hexGroup.style('display', isVisible ? 'block' : 'none')
    },
    setSelectedLabel: (label: string | null) => {
      selectedLabel = label
      applySelectionStyle()
    },
    setMeasurePath: (labels: string[] | null) => {
      measurePathSet.clear()
      measureEndpoints.clear()
      if (labels && labels.length > 0) {
        for (const l of labels) measurePathSet.add(l)
        measureEndpoints.add(labels[0])
        if (labels.length > 1) measureEndpoints.add(labels[labels.length - 1])
      }
      applySelectionStyle()
    },
    getHexAtSvg: (svgX, svgYIn) => {
      if (!isVisible) return null
      const continuous = pixelToAxial(svgX, svgYIn, currentHexSize, [0, 0])
      const rounded: AxialCoord = roundAxial(continuous)
      const cell = cellByAxial.get(`${rounded.q},${rounded.r}`)
      if (!cell) return null
      return { hex: cell, descriptors: descriptorsByLabel.get(cell.label) || [] }
    },
    getHexByLabel: (label) => {
      // Linear scan — N ≤ ~600 even at the smallest hex size, and this is
      // only called on deep-link resolution.
      const cell = cells.find((c) => c.label === label)
      if (!cell) return null
      return { hex: cell, descriptors: descriptorsByLabel.get(cell.label) || [] }
    },
  }
}
