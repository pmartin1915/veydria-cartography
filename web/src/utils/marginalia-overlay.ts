/**
 * marginalia-overlay.ts — antique sea-chart marginalia in the open water.
 *
 * Two art layers, drawn into ONE overlay group under the single "Marginalia" toggle:
 *  - layer A (ADR-0023 Beat 2): the six Oravan nakhoda star-figures (kind: asterism)
 *    as faint amber constellation motifs in the ocean OUTSIDE the 1200×800 continent
 *    rect (revealed on zoom-out; the corner cartouche carries default-frame
 *    discoverability).
 *  - layer B (ADR-0023 Beat 3): real ocean-fauna "here be…" engravings (kind: fauna)
 *    drawn near their HOME WATERS — region-aware placement keyed by `civ` (Oravan
 *    fauna in the west open ocean, Aethelian fauna inside the central basin, so they
 *    read at the default frame).
 *
 * Both mirror the SVG-overlay lifecycle of d3-overlay.ts / hex-overlay.ts; the group
 * lives in the Leaflet overlay pane and pans/zooms with the map.
 *
 * Rails honored (ADR-0023): nothing here is ever written to veydria-spatial.geojson;
 * star-figures are patterns in the sky, not creatures; every fauna engraving is a
 * REAL attested species (no invented creatures) — the picture is non-canon art. The
 * abstract cartouche (kind: cartouche) is NOT drawn here — it is the always-visible
 * corner device (MarginaliaCartouche.tsx).
 */

import * as d3 from 'd3'
import L from 'leaflet'
import type { Asterism } from './asterisms'
import { FAUNA_SHAPES } from './fauna-shapes'

const SVG_WIDTH = 1200
const SVG_HEIGHT = 800
// Figures are authored in the schematic frame: x east+ (0..1200), y north+
// (0..800), placed with x<0/x>1200/y<0/y>800 to sit in the open water OUTSIDE
// the continent rect (revealed on zoom-out). The Y-flip to Leaflet's CRS.Simple
// (y UP) lives HERE as `y - SVG_HEIGHT`, so initMarginaliaOverlay's reproject()
// can use a POSITIVE-scale matrix. (A negative matrix scale would position the
// figures correctly but vertically MIRROR every glyph — the prose labels and
// fauna silhouettes would render upside-down.) The old `848 - y` was an
// empirical getScreenCTM hack at one fit; the live projection replaces it.
function svgY(y: number): number {
  return y - SVG_HEIGHT
}

/** A constellation dot in figure-local screen space (dx right+, dy up+). */
interface Dot {
  dx: number
  dy: number
  /** The bright anchor star of the figure (drawn larger). */
  bright?: boolean
}

interface FigureShape {
  /** Anchor in the schematic frame; placed OUTSIDE the continent rect (open water). */
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  dots: Dot[]
  /** Index pairs into `dots` connected by a hairline. */
  lines: [number, number][]
}

// Hand-authored layout, keyed by asterism id, placed as a semantic ring around
// the continent (NORTH = large y; WEST = x<0, EAST = x>1200): Serakar (the fixed
// pole) due north, Measera (dawn) east, Vanasera (the low southern landfall star)
// south, Seraili (foreign fixed-points) south-west, Serama (the heading-band)
// west, Murasera (the storm/season mark) north-west. All sit well outside the
// 1200×800 rect on clean open water. Any id absent here is skipped.
const FIGURE_SHAPES: Record<string, FigureShape> = {
  // Crown Star — the fixed pole, due north. A crown arc over a bright center.
  'religion.tradition.star_register.serakar': {
    x: 600, y: 880, anchor: 'middle',
    dots: [
      { dx: 0, dy: 0, bright: true },
      { dx: -19, dy: 6 }, { dx: -9, dy: 15 }, { dx: 9, dy: 15 }, { dx: 19, dy: 6 },
    ],
    lines: [[1, 2], [2, 3], [3, 4]],
  },
  // Dawn-Star — the morning star, east. A bright star with four rays.
  'religion.tradition.star_register.measera': {
    x: 1300, y: 600, anchor: 'middle',
    dots: [
      { dx: 0, dy: 0, bright: true },
      { dx: -15, dy: 0 }, { dx: 15, dy: 0 }, { dx: 0, dy: 15 }, { dx: 0, dy: -15 },
    ],
    lines: [[0, 1], [0, 2], [0, 3], [0, 4]],
  },
  // Landfall Star — a bright southern star low over the "palm line" horizon.
  'religion.tradition.star_register.vanasera': {
    x: 860, y: -80, anchor: 'middle',
    dots: [
      { dx: 0, dy: 4, bright: true },
      { dx: -22, dy: -6 }, { dx: 22, dy: -6 },
    ],
    lines: [[1, 0], [0, 2]],
  },
  // Star-River — the luminous heading-band, west margin: a flowing strand.
  'religion.tradition.star_register.serama': {
    x: -120, y: 300, anchor: 'middle',
    dots: [
      { dx: -30, dy: -13 }, { dx: -15, dy: -4 }, { dx: 0, dy: 2 },
      { dx: 15, dy: 8 }, { dx: 30, dy: 15 },
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  // Storm-Star — the season-mark, north-west: a jagged storm zigzag.
  'religion.tradition.star_register.murasera': {
    x: -90, y: 680, anchor: 'middle',
    dots: [
      { dx: -20, dy: 10 }, { dx: -7, dy: -3 }, { dx: 6, dy: 9 }, { dx: 19, dy: -5 },
    ],
    lines: [[0, 1], [1, 2], [2, 3]],
  },
  // Remembered Stars — foreign fixed-points, south-west: a scattered loop.
  'religion.tradition.star_register.seraili': {
    x: 300, y: -80, anchor: 'middle',
    dots: [
      { dx: -16, dy: 10 }, { dx: 0, dy: 15 }, { dx: 15, dy: 8 },
      { dx: 6, dy: -6 }, { dx: -11, dy: -4 },
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]],
  },
}

/**
 * The asterisms this overlay draws: register star-figures (kind: asterism) that
 * also have a placed layout entry. Pure — exported for unit testing. The
 * cartouche (kind: cartouche) and any unplaced future figure are excluded.
 */
export function selectMarginaliaFigures(asterisms: Asterism[]): Asterism[] {
  return asterisms.filter((a) => a.kind === 'asterism' && a.id in FIGURE_SHAPES)
}

// ── Layer B: region-aware ocean-fauna engravings (ADR-0023 Beat 3) ──────────────
//
// Home-water anchors keyed by civ, in the schematic frame (x east+, y north+,
// matching the geojson civ centroids). A fauna's absolute anchor = its region zone
// + the shape's (ox, oy) offset, so moving a base relocates all of that region's
// creatures together (region-awareness made explicit). Anchors are eyeballed in
// open water and nudged in the headless visual check.
//   - oravan: the open ocean off the archipelago's SOUTHERN approaches / the Halkar
//     Straits (open water at geo x≈210–330, y≲255 — verified outside every land/basin
//     polygon). Placed here, not the far-west margin, so they clear the full-height
//     left layer panel and read on-screen (the west margin is occluded by that UI).
//   - aethelian: inside the central Aethelian Basin. In the marginalia frame the
//     visible water sits at x≈450–760, y≈200–420 (verified by probing the render —
//     the geojson basin polygon's bbox does NOT match the drawn water); the four
//     fauna take the basin's corners, clear of the centred "AETHELIAN BASIN" label.
const REGION_ZONES: Record<string, { x: number; y: number }> = {
  oravan: { x: 270, y: 225 },
  aethelian: { x: 600, y: 310 },
}

// FaunaShape + FAUNA_SHAPES moved to ./fauna-shapes (a Leaflet/d3-free leaf) so the
// TravelVignette can reuse the same silhouettes without pulling this module's map
// dependencies into its bundle. The placement fields (civ/ox/oy/anchor/lx/ly) are
// consumed below; the vignette uses only the geometry (d/detail/eye/stroke).

/**
 * The fauna engravings this overlay draws: real-species rows (kind: fauna) that
 * also have a placed silhouette. Pure — exported for unit testing. Star-figures,
 * the cartouche, and any unplaced future fauna are excluded.
 */
export function selectFaunaEngravings(asterisms: Asterism[]): Asterism[] {
  return asterisms.filter((a) => a.kind === 'fauna' && a.id in FAUNA_SHAPES)
}

export interface MarginaliaOverlay {
  /** Re-draw against the latest data (no-op parity with sibling overlays). */
  update: () => void
  destroy: () => void
  setVisibility: (visible: boolean) => void
  setOpacity: (opacity: number) => void
}

export function initMarginaliaOverlay(map: L.Map, asterisms: Asterism[]): MarginaliaOverlay {
  L.svg().addTo(map)

  // See hex-overlay.ts: 'g.leaflet-zoom-hide' never matches in Leaflet 1.9's SVG
  // renderer output — grab the root <g> directly. Leaflet reuses the single
  // overlay-pane <svg> across the d3 / hex / marginalia overlays.
  const svg = d3.select(map.getPanes().overlayPane).select<SVGSVGElement>('svg')
  const g = svg.select<SVGGElement>('g')

  g.selectAll('.marginalia-group').remove()
  const group = g.append('g').attr('class', 'marginalia-group')

  // Lock the group to Leaflet's CURRENT layer-point space via one affine
  // transform, recomputed on zoom/move. Without it the group renders at a
  // constant screen size (L.SVG makes 1 user-unit == 1 px at every zoom) and only
  // aligned at the one fit the figures were authored against — the cause of the
  // "constellations in weird places" bug. With svgY already carrying the Y-flip,
  // an authored coord (x, svgY(y)) maps to latLngToLayerPoint(svgToLatLng(x, y))
  // under a POSITIVE-scale affine (derived from three probes) — pixel-identical
  // to d3-overlay.ts's per-point projection. The figures and fauna intentionally
  // scale WITH the chart ("drawn on the chart"), so — unlike hex labels —
  // nothing is counter-scaled. Positive scales keep glyphs upright (no mirror).
  // Probe across the FULL map extent, not 1 unit: latLngToLayerPoint returns
  // integer-rounded points, so a 1-unit probe quantizes the scale (1.414 → 1
  // at the zoom control's half-level steps), misaligning figures ~41% until the
  // next integer zoom. Wide-span probes make the rounding error negligible
  // (≤0.5px over 1200 units). Same fix as graticule-overlay.ts / scale-control.ts (PR #50).
  function reproject() {
    const p00 = map.latLngToLayerPoint(L.latLng(0, 0))
    const pE = map.latLngToLayerPoint(L.latLng(0, SVG_WIDTH))
    const pN = map.latLngToLayerPoint(L.latLng(SVG_HEIGHT, 0))
    const sx = (pE.x - p00.x) / SVG_WIDTH // > 0
    const sy = (p00.y - pN.y) / SVG_HEIGHT // > 0 (Y-flip is in svgY, not here — keeps glyphs upright)
    group.attr('transform', `matrix(${sx},0,0,${sy},${p00.x},${p00.y})`)
  }

  function draw() {
    group.selectAll('*').remove()
    for (const fig of selectMarginaliaFigures(asterisms)) {
      const shape = FIGURE_SHAPES[fig.id]
      const figG = group.append('g')
        .attr('class', 'marginalia-figure')
        .attr('data-id', fig.id)

      // Connecting hairlines first (under the dots). Non-scaling so they stay
      // thread-thin across zoom, like the hex edges. dy>0 = up on screen, so
      // it is SUBTRACTED from the anchor before the svgY flip.
      for (const [a, b] of shape.lines) {
        const da = shape.dots[a]
        const db = shape.dots[b]
        figG.append('line')
          .attr('x1', shape.x + da.dx)
          .attr('y1', svgY(shape.y - da.dy))
          .attr('x2', shape.x + db.dx)
          .attr('y2', svgY(shape.y - db.dy))
          .attr('stroke', 'currentColor')
          .attr('stroke-width', 0.6)
          .attr('stroke-opacity', 0.45)
          .attr('vector-effect', 'non-scaling-stroke')
      }

      // Constellation dots. The lesser stars get a faint, staggered twinkle (CSS
      // class marginalia-twinkle + per-dot animation-delay); the bright anchor star
      // is the register's "fixed pole" and is left steady. The reduced-motion guard
      // in App.css stills the whole group.
      shape.dots.forEach((dot, i) => {
        const circle = figG.append('circle')
          .attr('cx', shape.x + dot.dx)
          .attr('cy', svgY(shape.y - dot.dy))
          .attr('r', dot.bright ? 2.6 : 1.7)
          .attr('fill', 'currentColor')
          .attr('fill-opacity', dot.bright ? 0.85 : 0.6)
        if (!dot.bright) {
          circle
            .classed('marginalia-twinkle', true)
            .style('animation-delay', `${(i % 4) * 1.1}s`)
        }
      })

      // Prose label, below the motif (30px south of the anchor).
      figG.append('text')
        .attr('x', shape.x)
        .attr('y', svgY(shape.y - 30))
        .attr('text-anchor', shape.anchor)
        .attr('fill', 'currentColor')
        .attr('fill-opacity', 0.75)
        .attr('font-size', 11)
        .attr('font-family', 'Georgia, serif')
        .attr('font-style', 'italic')
        .attr('pointer-events', 'none')
        .text(fig.prose_label)
    }

    // Layer B — ocean-fauna engravings, anchored near their home region. The motif
    // is authored in local screen space (y DOWN) and translated to the region
    // anchor, so it scales with the chart on zoom (the "drawn-on-the-chart" feel);
    // strokes stay hairline via non-scaling-stroke.
    selectFaunaEngravings(asterisms).forEach((fauna, i) => {
      const shape = FAUNA_SHAPES[fauna.id]
      const zone = REGION_ZONES[shape.civ]
      if (!zone) return
      const ax = zone.x + shape.ox
      const ay = svgY(zone.y + shape.oy)
      // Outer group: positioning only. Its translate(ax, ay) anchors the creature in
      // its home water and must NOT be animated — a CSS transform here would clobber it.
      const faunaG = group.append('g')
        .attr('class', 'marginalia-fauna')
        .attr('data-id', fauna.id)
        .attr('transform', `translate(${ax}, ${ay})`)

      // Inner wrapper: carries the faint "swim" drift (CSS class marginalia-fauna-body
      // in App.css). Negative per-creature stagger so each is already mid-swim at load,
      // out of unison. The reduced-motion guard in App.css stills it.
      const faunaBody = faunaG.append('g')
        .attr('class', 'marginalia-fauna-body')
        .style('animation-delay', `${-(i * 2.6)}s`)

      faunaBody.append('path')
        .attr('d', shape.d)
        .attr('fill', shape.stroke ? 'none' : 'currentColor')
        .attr('fill-opacity', shape.stroke ? 0 : 0.42)
        .attr('stroke', 'currentColor')
        .attr('stroke-width', shape.stroke ? 1.1 : 0.7)
        .attr('stroke-opacity', 0.7)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('vector-effect', 'non-scaling-stroke')

      if (shape.detail) {
        faunaBody.append('path')
          .attr('d', shape.detail)
          .attr('fill', 'none')
          .attr('stroke', 'currentColor')
          .attr('stroke-width', 0.7)
          .attr('stroke-opacity', 0.6)
          .attr('stroke-linejoin', 'round')
          .attr('stroke-linecap', 'round')
          .attr('vector-effect', 'non-scaling-stroke')
      }

      if (shape.eye) {
        faunaBody.append('circle')
          .attr('cx', shape.eye.x)
          .attr('cy', shape.eye.y)
          .attr('r', 1)
          .attr('fill', 'currentColor')
          .attr('fill-opacity', 0.85)
      }

      // Prose label stays on the steady outer group — the caption holds while the
      // creature drifts beneath it (mirrors the twinkle's steady "fixed pole" star).
      faunaG.append('text')
        .attr('x', shape.lx ?? 0)
        .attr('y', shape.ly ?? 22)
        .attr('text-anchor', shape.anchor)
        .attr('fill', 'currentColor')
        .attr('fill-opacity', 0.75)
        .attr('font-size', 10)
        .attr('font-family', 'Georgia, serif')
        .attr('font-style', 'italic')
        .attr('pointer-events', 'none')
        .text(fauna.prose_label)
    })

    reproject()
  }

  draw()
  group.style('display', 'none') // init hidden; the caller applies real state

  // viewreset + moveend mirror d3-overlay.ts / hex-overlay.ts: smooth scale
  // during the zoom animation (Leaflet transforms the whole renderer <svg>),
  // exact matrix recomputed on settle.
  map.on('viewreset moveend', reproject)

  return {
    update: () => draw(),
    destroy: () => {
      map.off('viewreset moveend', reproject)
      group.remove()
    },
    setVisibility: (visible: boolean) => {
      group.style('display', visible ? 'block' : 'none')
    },
    setOpacity: (opacity: number) => {
      group.style('opacity', String(opacity))
    },
  }
}
