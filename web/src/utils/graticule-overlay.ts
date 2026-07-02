/**
 * graticule-overlay.ts — SVG distance-grid overlay for Leaflet.
 *
 * Renders a muted 100-SVG-unit grid (250 km) over the map with edge labels,
 * mirroring the lifecycle and reprojection pattern used by hex-overlay.ts.
 */

import * as d3 from 'd3'
import L from 'leaflet'
import { svgToWorldKm, worldScale } from './world-coords'

const SVG_WIDTH = 1200
const SVG_HEIGHT = 800
export const STEP_SVG = 100
const STROKE = 'rgba(120, 80, 40, 0.28)'
const STROKE_WIDTH = 0.6
const LABEL_FILL = 'rgba(180, 160, 120, 0.75)'
const BASE_FONT = 10 // px, counter-scaled in reproject()

export interface GraticuleLine {
  x1: number
  y1: number
  x2: number
  y2: number
  label?: string
  labelX?: number
  labelY?: number
}

export interface GraticuleModel {
  verticals: GraticuleLine[]
  horizontals: GraticuleLine[]
}

export function graticuleLines(stepSvg: number = STEP_SVG): GraticuleModel {
  const verticals: GraticuleLine[] = []
  for (let x = 0; x <= SVG_WIDTH; x += stepSvg) {
    verticals.push({
      x1: x,
      y1: 0,
      x2: x,
      y2: SVG_HEIGHT,
      label: String(Math.round(x * worldScale.kmPerSvgUnit)),
      labelX: x,
      labelY: 10,
    })
  }

  const horizontals: GraticuleLine[] = []
  for (let y = 0; y <= SVG_HEIGHT; y += stepSvg) {
    horizontals.push({
      x1: 0,
      y1: y,
      x2: SVG_WIDTH,
      y2: y,
      label: String(Math.round(svgToWorldKm({ x: 0, y }).northKm)),
      labelX: 8,
      labelY: y,
    })
  }

  return { verticals, horizontals }
}

export interface GraticuleOverlay {
  setVisibility: (visible: boolean) => void
  setOpacity: (opacity: number) => void
  destroy: () => void
}

export function initGraticuleOverlay(map: L.Map): GraticuleOverlay {
  L.svg().addTo(map)

  const svg = d3.select(map.getPanes().overlayPane).select<SVGSVGElement>('svg')
  const g = svg.select<SVGGElement>('g')

  g.selectAll('.graticule-group').remove()
  const graticuleGroup = g
    .append('g')
    .attr('class', 'graticule-group')
    .style('pointer-events', 'none')

  function svgY(y: number): number {
    // Y-flip lives HERE (not in the group matrix): authored coords are SVG-space
    // (origin top-left, y DOWN); Leaflet CRS.Simple has y UP. Negating into
    // `y - SVG_HEIGHT` lets reproject() use a POSITIVE-scale matrix, which is
    // essential — a negative matrix scale would also vertically MIRROR every
    // glyph (the coordinate labels would render upside-down).
    return y - SVG_HEIGHT
  }

  function reproject() {
    // Probe across the FULL map extent, not 1 unit: latLngToLayerPoint returns
    // integer-rounded points, so a 1-unit probe quantizes the scale (1.414 → 1
    // at the zoom control's half-level steps). Wide-span probes make the
    // rounding error negligible (≤0.5px over 1200 units).
    const p00 = map.latLngToLayerPoint(L.latLng(0, 0))
    const pE = map.latLngToLayerPoint(L.latLng(0, SVG_WIDTH))
    const pN = map.latLngToLayerPoint(L.latLng(SVG_HEIGHT, 0))
    const sx = (pE.x - p00.x) / SVG_WIDTH // > 0
    const sy = (p00.y - pN.y) / SVG_HEIGHT // > 0 (Y-flip is in svgY, not here — keeps glyphs upright)
    graticuleGroup.attr('transform', `matrix(${sx},0,0,${sy},${p00.x},${p00.y})`)

    // Distance labels are a functional readout — keep them a constant screen size
    // by counter-scaling the font against the matrix (sx == sy == 2^zoom under
    // CRS.Simple). The grid geometry still scales with the chart.
    const scale = Math.abs(sx) || 1
    graticuleGroup.selectAll('text.graticule-label').attr('font-size', BASE_FONT / scale)
  }

  const { verticals, horizontals } = graticuleLines()
  const lines = [...verticals, ...horizontals]

  graticuleGroup
    .selectAll('line.graticule-line')
    .data(lines)
    .join('line')
    .attr('class', 'graticule-line')
    .attr('x1', (d) => d.x1)
    .attr('y1', (d) => svgY(d.y1))
    .attr('x2', (d) => d.x2)
    .attr('y2', (d) => svgY(d.y2))
    .attr('stroke', STROKE)
    .attr('stroke-width', STROKE_WIDTH)

  graticuleGroup
    .selectAll('text.graticule-label')
    .data(lines.filter((d) => d.label != null))
    .join('text')
    .attr('class', 'graticule-label')
    .attr('x', (d) => (d.labelX === d.x1 ? d.labelX ?? 0 : d.labelX ?? 0))
    .attr('y', (d) => svgY(d.labelY ?? 0))
    .attr('text-anchor', (d) => (d.labelX === d.x1 ? 'middle' : 'start'))
    .attr('dy', (d) => (d.labelX === d.x1 ? '0.32em' : '0.32em'))
    .attr('fill', LABEL_FILL)
    .text((d) => d.label ?? '')

  let isVisible = false
  graticuleGroup.style('display', isVisible ? 'block' : 'none')

  reproject()
  // 'viewreset moveend' — NOT 'zoom move': during an animated zoom the layer
  // coordinate space only flips at the end, so mid-animation probes return
  // stale values and nothing re-fires after the flip (the hex/marginalia
  // overlays learned this the hard way — keep all three in lockstep).
  map.on('viewreset moveend', reproject)

  return {
    setVisibility(visible: boolean) {
      isVisible = visible
      graticuleGroup.style('display', visible ? 'block' : 'none')
    },
    setOpacity(opacity: number) {
      graticuleGroup.style('opacity', opacity)
    },
    destroy() {
      map.off('viewreset moveend', reproject)
      graticuleGroup.remove()
    },
  }
}
