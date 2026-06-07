/**
 * marginalia-overlay.ts — antique sea-chart star-figures in the open-water margin.
 *
 * Draws the six Oravan nakhoda star-figures (asterisms.json, kind: asterism) as
 * faint amber constellation motifs in the ocean OUTSIDE the 1200×800 continent
 * rect, mirroring the SVG-overlay lifecycle of d3-overlay.ts / hex-overlay.ts.
 * The figures live in the Leaflet overlay pane and pan/zoom with the map.
 *
 * This is ADR-0023 Beat 2, layer A. Rails honored: these are patterns in the sky,
 * not creatures; nothing here is ever written to veydria-spatial.geojson. The
 * abstract cartouche (kind: cartouche) is NOT drawn here — it is the always-visible
 * corner device (MarginaliaCartouche.tsx).
 *
 * Placement note: at the default fit the open-water margin is thin (~20px), so the
 * figures mostly sit just off-screen and are revealed on zoom-out; the corner
 * cartouche carries discoverability at the default frame.
 */

import * as d3 from 'd3'
import L from 'leaflet'
import type { Asterism } from './asterisms'

const SVG_HEIGHT = 800
// The overlay pane group draws in a frame where, empirically (getScreenCTM at
// the default fit), screen_x = anchor.x and screen_y = 848 - anchor.y - dy: so a
// LARGER `y` is further NORTH (up), and dot `dy>0` is further down on screen.
// We pass `svgY(y) = 800 - y` so the figures share the schematic's frame; the
// schematic continent fills [0..1200]×[0..800], so figures placed with x<0 / x>1200
// / y<0 / y>800 sit in the open water OUTSIDE it (revealed on zoom-out).
function svgY(y: number): number {
  return SVG_HEIGHT - y
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

      // Constellation dots.
      for (const dot of shape.dots) {
        figG.append('circle')
          .attr('cx', shape.x + dot.dx)
          .attr('cy', svgY(shape.y - dot.dy))
          .attr('r', dot.bright ? 2.6 : 1.7)
          .attr('fill', 'currentColor')
          .attr('fill-opacity', dot.bright ? 0.85 : 0.6)
      }

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
  }

  draw()
  group.style('display', 'none') // init hidden; the caller applies real state

  return {
    update: () => draw(),
    destroy: () => {
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
