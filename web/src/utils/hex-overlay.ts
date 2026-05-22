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
  getHexBiomeColor,
  getNeighborBiomes,
  axialKey,
  type HexCell,
  type AxialCoord,
} from './hex-grid'

const SVG_HEIGHT = 800
const SVG_WIDTH = 1200
export const DEFAULT_HEX_SIZE = 50
// At zoom levels below this, labels overlap into illegibility — drop them.
// 0 (was 1) gives one extra zoom-out level of coordinate reference so the
// overview state isn't a mesh-only view with no label context.
const LABEL_MIN_ZOOM = 0

// Parchment is encoded into the hex polygon fill: warm ochre cells over the
// continental schematic. When biome colors are on, cells swap to the biome
// hex; the cream is dropped to keep biomes readable rather than muddied.
// PARCHMENT_FILL_OPACITY bumped 0.35 → 0.55 — at 0.35 the cream was
// indistinguishable from the colored basemap, defeating the "paper laid
// over the continent" aesthetic. PARCHMENT_CREAM shifted #e8dcc0 → #e4cca0
// (neutral cream → warm ochre) so the hex overlay contrasts with the
// schematic's already-parchment-toned plateau regions (H-row Ngaru-Bon),
// which were rendering cream-on-cream and disappearing.
const PARCHMENT_CREAM = '#e4cca0'
const PARCHMENT_FILL_OPACITY = '0.55'
const BIOME_FILL_OPACITY = '0.3'
// Fog of war: when enabled, unexplored hexes dim by overriding fill-opacity.
// 0.18 chosen as the starting point for the audit pass; the handoff calls out
// a 0.25-0.3 sweet spot but the dim treatment stacks with the underlying
// schematic alpha so a lower value reads correctly without losing the cell.
const PARCHMENT_UNEXPLORED_OPACITY = '0.18'
// Unexplored edge strokes also fade; the boundary/seam contrast we tuned for
// parchment over-explored hexes would otherwise re-introduce a mesh look.
const FOG_EDGE_STROKE = 'rgba(120, 80, 40, 0.18)'
const FOG_EDGE_WIDTH = 0.4

export interface HexOverlay {
  update: () => void
  destroy: () => void
  setVisibility: (visible: boolean) => void
  /**
   * Toggle the analytical grid layer (edge <line>s and label <text>s) without
   * affecting the parchment base or biome-fill polygons. Lets biome colors
   * remain visible while the user hides the grid mesh.
   */
  setShowGridLines: (visible: boolean) => void
  setOpacity: (opacity: number) => void
  setHexSize: (size: number) => void
  setSelectedLabel: (label: string | null) => void
  setMeasurePath: (labels: string[] | null) => void
  setJourneyRoute: (labels: string[] | null) => void
  setBiomeColorsEnabled: (enabled: boolean) => void
  /** Toggle fog-of-war dimming. The explored set is preserved across toggles. */
  setFogEnabled: (enabled: boolean) => void
  /** Replace the explored-hex set. Pass null to clear. */
  setExploredHexes: (labels: Set<string> | null) => void
  getHexAtSvg: (svgX: number, svgY: number) => { hex: HexCell; descriptors: string[] } | null
  getHexByLabel: (label: string) => { hex: HexCell; descriptors: string[] } | null
}

export function initHexOverlay(
  map: L.Map,
  features: GeoJSONFeature[],
  initialHexSize: number = DEFAULT_HEX_SIZE,
  biomeColorsEnabled: boolean = false,
  onHexRightClick?: (label: string, event: MouseEvent) => void,
): HexOverlay {
  L.svg().addTo(map)

  // Leaflet 1.9 SVG renderer structure is <svg class="leaflet-zoom-animated">
  // <g></g><defs></defs></svg>. The 'leaflet-zoom-hide' class lives on marker
  // panes (Leaflet/src/map/Map.js), NOT on any SVG <g> — selecting
  // 'g.leaflet-zoom-hide' returns an empty d3 selection and silently no-ops
  // every subsequent .append(). Grab the root <g> directly.
  const svg = d3.select(map.getPanes().overlayPane).select<SVGSVGElement>('svg')
  const g = svg.select<SVGGElement>('g')

  g.selectAll('.hex-grid-group').remove()
  const hexGroup = g.append('g').attr('class', 'hex-grid-group')

  // (Previously a full-width parchment base rect lived here — a 1200×800
  // feTurbulence-filled <rect> beneath the hex cells. It rendered as a
  // centered "white-fog square" in practice: the source-coord rect didn't
  // span the visible Leaflet viewport at typical zoom levels, and the
  // feTurbulence under Leaflet's transform animation read as rudimentary
  // noise that varied per-zoom. Parchment is now encoded into the hex
  // polygon fills themselves below — each cell IS a piece of parchment.)

  let currentHexSize = initialHexSize
  let cells: HexCell[] = []
  const descriptorsByLabel = new Map<string, string[]>()
  const biomeColorByLabel = new Map<string, string | null>()
  const cellByAxial = new Map<string, HexCell>()
  let isVisible = false
  let gridLinesVisible = true
  let selectedLabel: string | null = null
  let biomeColorsActive = biomeColorsEnabled
  // Measure-path state. `measurePathSet` is every cell along the line;
  // `measureEndpoints` is just the two clicked ends (drawn brighter).
  const measurePathSet = new Set<string>()
  const measureEndpoints = new Set<string>()
  // Journey-route state — hex cells the computed route passes through.
  const journeyRouteSet = new Set<string>()
  // Fog of war: the explored set and a separate enable flag, because the
  // set can be populated even while fog is off (toggle should not clear data).
  let fogEnabled = false
  let exploredHexes: Set<string> | null = null

  function svgY(y: number): number {
    // Leaflet CRS.Simple flips Y. hex-grid produces SVG-space coords
    // (origin top-left); the overlay pane uses flipped Y.
    return SVG_HEIGHT - y
  }

  function rebuild(size: number) {
    currentHexSize = size
    cells = generateHexGrid(SVG_WIDTH, SVG_HEIGHT, size)
    descriptorsByLabel.clear()
    biomeColorByLabel.clear()
    cellByAxial.clear()
    // Temporary axial-keyed biome map for neighbor diff. Rebuilt every
    // rebuild() since cells/features can change.
    const biomeColorByAxialKey = new Map<string, string | null>()
    for (const cell of cells) {
      descriptorsByLabel.set(cell.label, sampleHexFeatures(cell, features))
      biomeColorByLabel.set(cell.label, getHexBiomeColor(cell, features))
      cellByAxial.set(`${cell.coord.q},${cell.coord.r}`, cell)
      biomeColorByAxialKey.set(axialKey(cell.coord), biomeColorByLabel.get(cell.label) ?? null)
    }

    // Wipe previous geometry. d3's join with key fn on a fresh dataset
    // produces orphan exits we don't want to keep around.
    hexGroup.selectAll('g.hex-cell').remove()

    const cellSel = hexGroup
      .selectAll<SVGGElement, HexCell>('g.hex-cell')
      .data(cells, (d) => d.label)
      .join('g')
      .attr('class', 'hex-cell')

    // Polygons render the FILL only. Strokes are now drawn as six per-edge
    // <line> elements per cell (below) so that boundary edges between
    // different biomes can carry heavier strokes than internal seams —
    // unreachable with a single polygon stroke-width attribute.
    //
    // Parchment is no longer a separate base layer; instead, when biome
    // colors are OFF, each cell is filled with cream at 0.35 opacity —
    // the hex grid itself reads as a sheet of warm paper laid over the
    // schematic. When biome colors are ON, the cell takes its biome hex
    // at 0.3 opacity (enough to read distinctly, low enough to not muddy
    // the schematic continent shapes underneath).
    const polygons = cellSel
      .append('polygon')
      .attr('points', (d) => d.corners.map(([x, y]) => `${x},${svgY(y)}`).join(' '))
      .attr('fill', (d) => {
        const c = biomeColorsActive ? (biomeColorByLabel.get(d.label) || null) : null
        return c ? c : PARCHMENT_CREAM
      })
      .attr('fill-opacity', (d) => {
        const c = biomeColorsActive ? (biomeColorByLabel.get(d.label) || null) : null
        return c ? BIOME_FILL_OPACITY : PARCHMENT_FILL_OPACITY
      })
      .attr('stroke', 'none')
      .attr('data-label', (d) => d.label)

    if (onHexRightClick) {
      polygons.on('contextmenu', function (event: MouseEvent, d) {
        event.preventDefault()
        event.stopPropagation()
        onHexRightClick(d.label, event)
      })
    }

    // Per-edge <line> elements per hex. Boundary edges (neighbor biome differs)
    // get a heavier double-stroke; same-biome / off-grid seams stay thin. Each
    // line is tagged with data-cell-label and data-edge-index, plus the
    // baseline stroke/width as data-base-* so applySelectionStyle can restore
    // them when the cell leaves a highlight state. At hexSize=30 this produces
    // ~1320 lines, well within SVG's comfort zone.
    // Re-tuned 2026-05-20 after a visual audit: the earlier softening
    // (1.1w @ 0.65α boundary / 0.4w @ 0.4α seam) made the two strokes
    // nearly indistinguishable. Catan-style tile-read needs an obvious
    // visual hierarchy. Now: boundary much darker + wider, seam much
    // fainter + thinner, so cross-biome edges pop without re-introducing
    // the "darker brown mesh" problem we fixed before.
    const EDGE_BOUNDARY_STROKE = 'rgba(120, 80, 40, 0.85)'
    const EDGE_SEAM_STROKE = 'rgba(212, 168, 84, 0.28)'
    const EDGE_BOUNDARY_WIDTH = 1.4
    const EDGE_SEAM_WIDTH = 0.35
    cellSel.each(function (cell) {
      const cellG = d3.select<SVGGElement, HexCell>(this)
      const ownBiome = biomeColorByAxialKey.get(axialKey(cell.coord)) ?? null
      const neighborBiomes = getNeighborBiomes(cell.coord, biomeColorByAxialKey)
      for (let i = 0; i < 6; i++) {
        const [x1, y1Raw] = cell.corners[i]
        const [x2, y2Raw] = cell.corners[(i + 1) % 6]
        const neighbor = neighborBiomes[i]
        // Boundary = same-hex has a biome AND neighbor differs (or doesn't exist).
        // Off-grid neighbors (null) on biome-bearing hexes count as boundary
        // so the continental edge gets the heavier stroke.
        const isBoundary = ownBiome != null && neighbor !== ownBiome
        const baseStroke = isBoundary ? EDGE_BOUNDARY_STROKE : EDGE_SEAM_STROKE
        const baseWidth = isBoundary ? EDGE_BOUNDARY_WIDTH : EDGE_SEAM_WIDTH
        cellG
          .append('line')
          .attr('class', 'hex-edge')
          .attr('x1', x1)
          .attr('y1', svgY(y1Raw))
          .attr('x2', x2)
          .attr('y2', svgY(y2Raw))
          .attr('stroke', baseStroke)
          .attr('stroke-width', baseWidth)
          .attr('vector-effect', 'non-scaling-stroke')
          .attr('data-cell-label', cell.label)
          .attr('data-edge-index', i)
          .attr('data-base-stroke', baseStroke)
          .attr('data-base-width', String(baseWidth))
      }
    })

    // Scale label size with hex radius so smaller hexes don't crowd.
    // Sepia ink on the parchment base: warm dark-brown italic Georgia,
    // legible against the cream feTurbulence fill.
    const fontSize = Math.max(5, Math.round(size * 0.16))
    cellSel
      .append('text')
      .attr('class', 'hex-label')
      .attr('x', (d) => d.centroid[0])
      .attr('y', (d) => svgY(d.centroid[1]))
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', 'rgba(78, 52, 28, 0.78)')
      .attr('font-size', fontSize)
      .attr('font-family', 'Georgia, serif')
      .attr('font-style', 'italic')
      .attr('pointer-events', 'none')
      .attr('data-label', (d) => d.label)
      .text((d) => d.label)

    applyGridLinesVisibility()
    applySelectionStyle()
  }

  function isFogDimmed(label: string): boolean {
    // Highlight states always win over fog (a measure endpoint or selected
    // hex stays bright even if unexplored). Only un-highlighted, unexplored
    // cells receive the dim treatment.
    if (!fogEnabled || exploredHexes === null) return false
    if (exploredHexes.has(label)) return false
    if (measureEndpoints.has(label)) return false
    if (label === selectedLabel) return false
    if (measurePathSet.has(label)) return false
    if (journeyRouteSet.has(label)) return false
    return true
  }

  function applySelectionStyle() {
    // Priority: measure endpoint > selectedLabel > measure mid-path > journey route > fog-dim > default.
    // Polygons carry FILL + FILL-OPACITY (re-applied on every state change so
    // toggling biome colors off fully reverts to parchment cream rather than
    // leaving the prior biome alpha in place). Edges (below) carry stroke.
    hexGroup.selectAll<SVGPolygonElement, HexCell>('polygon')
      .attr('fill', function () {
        const label = this.getAttribute('data-label') ?? ''
        if (measureEndpoints.has(label)) return 'rgba(126, 196, 230, 0.34)'
        // Selected-hex fill bumped 0.22 → 0.45 and shifted toward warm
        // amber: at 0.22 the click-selection highlight was nearly
        // invisible (only the per-edge stroke override carried the
        // signal). The measure-endpoint case was visible because it
        // uses a brighter blue at 0.34 — bring selected up to parity.
        if (label === selectedLabel) return 'rgba(244, 220, 160, 0.45)'
        if (measurePathSet.has(label)) return 'rgba(126, 196, 230, 0.16)'
        if (journeyRouteSet.has(label)) return 'rgba(228, 176, 80, 0.14)'
        const c = biomeColorsActive ? (biomeColorByLabel.get(label) || null) : null
        return c ? c : PARCHMENT_CREAM
      })
      .attr('fill-opacity', function () {
        const label = this.getAttribute('data-label') ?? ''
        // Highlight states bake their alpha into the fill rgba above, so
        // their fill-opacity is implicitly 1.0 (don't double-attenuate).
        if (measureEndpoints.has(label)) return '1'
        if (label === selectedLabel) return '1'
        if (measurePathSet.has(label)) return '1'
        if (journeyRouteSet.has(label)) return '1'
        if (isFogDimmed(label)) return PARCHMENT_UNEXPLORED_OPACITY
        const c = biomeColorsActive ? (biomeColorByLabel.get(label) || null) : null
        return c ? BIOME_FILL_OPACITY : PARCHMENT_FILL_OPACITY
      })

    // Edge lines. Same priority chain as polygon fill. Non-highlighted edges
    // restore from data-base-stroke / data-base-width (set by rebuild based on
    // neighbor-biome diff).
    hexGroup.selectAll<SVGLineElement, unknown>('line.hex-edge')
      .attr('stroke', function () {
        const label = this.getAttribute('data-cell-label') ?? ''
        if (measureEndpoints.has(label)) return 'rgba(186, 226, 244, 0.95)'
        if (label === selectedLabel) return 'rgba(255, 232, 168, 1)'
        if (measurePathSet.has(label)) return 'rgba(160, 212, 232, 0.9)'
        if (journeyRouteSet.has(label)) return 'rgba(232, 184, 96, 0.9)'
        if (isFogDimmed(label)) return FOG_EDGE_STROKE
        return this.getAttribute('data-base-stroke') ?? 'rgba(212, 168, 84, 0.55)'
      })
      .attr('stroke-width', function () {
        const label = this.getAttribute('data-cell-label') ?? ''
        if (measureEndpoints.has(label)) return 2.8
        if (label === selectedLabel) return 2.8
        if (measurePathSet.has(label)) return 1.6
        if (journeyRouteSet.has(label)) return 1.4
        if (isFogDimmed(label)) return FOG_EDGE_WIDTH
        const base = this.getAttribute('data-base-width')
        return base != null ? Number(base) : 0.5
      })

    // Labels mirror the cell-fill priority. Reset everyone first, then
    // brighten the highlighted ones — selectedLabel and endpoints get
    // bold weight; mid-path stays normal but cyan-tinted; journey route
    // gets a warm amber tint.
    const labels = hexGroup.selectAll<SVGTextElement, HexCell>('text.hex-label')
    labels
      .attr('fill', function () {
        const label = this.getAttribute('data-label') ?? ''
        if (isFogDimmed(label)) return 'rgba(78, 52, 28, 0.22)'
        return 'rgba(78, 52, 28, 0.78)'
      })
      .attr('font-weight', null)
    if (measurePathSet.size > 0) {
      labels
        .filter(function () {
          const l = this.getAttribute('data-label') ?? ''
          return measurePathSet.has(l) && !measureEndpoints.has(l) && !journeyRouteSet.has(l)
        })
        .attr('fill', 'rgba(186, 226, 244, 0.85)')
    }
    if (measureEndpoints.size > 0) {
      labels
        .filter(function () {
          const l = this.getAttribute('data-label') ?? ''
          return measureEndpoints.has(l)
        })
        .attr('fill', 'rgba(220, 240, 255, 1)')
        .attr('font-weight', '700')
    }
    if (selectedLabel) {
      labels
        .filter(function () {
          return this.getAttribute('data-label') === selectedLabel
        })
        .attr('fill', 'rgba(255, 232, 168, 1)')
        .attr('font-weight', '700')
    }
    if (journeyRouteSet.size > 0) {
      labels
        .filter(function () {
          const l = this.getAttribute('data-label') ?? ''
          return journeyRouteSet.has(l) && !measureEndpoints.has(l) && l !== selectedLabel && !measurePathSet.has(l)
        })
        .attr('fill', 'rgba(244, 210, 140, 0.75)')
    }
  }

  function applyZoomLabels() {
    const z = map.getZoom()
    const showLabels = gridLinesVisible && z >= LABEL_MIN_ZOOM
    hexGroup.selectAll('text').style('display', showLabels ? 'block' : 'none')
  }

  function applyGridLinesVisibility() {
    hexGroup.selectAll('line.hex-edge').style('display', gridLinesVisible ? 'block' : 'none')
    applyZoomLabels()
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
      if (visible) applyGridLinesVisibility()
    },
    setShowGridLines: (visible: boolean) => {
      gridLinesVisible = visible
      applyGridLinesVisibility()
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
    setJourneyRoute: (labels: string[] | null) => {
      journeyRouteSet.clear()
      if (labels && labels.length > 0) {
        for (const l of labels) journeyRouteSet.add(l)
      }
      applySelectionStyle()
    },
    setBiomeColorsEnabled: (enabled: boolean) => {
      biomeColorsActive = enabled
      applySelectionStyle()
    },
    setFogEnabled: (enabled: boolean) => {
      fogEnabled = enabled
      applySelectionStyle()
    },
    setExploredHexes: (labels: Set<string> | null) => {
      exploredHexes = labels
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
