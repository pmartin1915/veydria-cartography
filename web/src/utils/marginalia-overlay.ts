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

interface FaunaShape {
  /** Home region (a key of REGION_ZONES); also the fauna row's `civ`. */
  civ: string
  /** Offset from the region zone, in the schematic frame (east+, north+). */
  ox: number
  oy: number
  /** SVG path `d` for the silhouette, authored in LOCAL screen space (y DOWN), */
  /** roughly centred on the origin, the creature facing right. */
  d: string
  /** Render the body as a filled silhouette (default) or a stroked outline (snakes). */
  stroke?: boolean
  /** Optional extra stroked detail path (back ridges, tail, flippers) in local space. */
  detail?: string
  /** Optional eye dot in local space. */
  eye?: { x: number; y: number }
  /** Label text-anchor / which side it sits relative to the motif. */
  anchor: 'start' | 'middle' | 'end'
  /** Label offset from the motif origin, local space (default below the motif). */
  lx?: number
  ly?: number
}

// Hand-authored silhouettes — single-tone antique-engraving line-art, the house idiom
// of TravelVignette.tsx. Each is an attested real species (see data/asterisms.yaml).
// Any fauna id absent here is skipped (forward-compat).
const FAUNA_SHAPES: Record<string, FaunaShape> = {
  // Sea snake — a banded serpentine drawn as a stroked sine with a small head.
  'ecology.fauna.oravan.sea_snake': {
    civ: 'oravan', ox: 5, oy: 30, anchor: 'middle',
    d: 'M -26 0 C -19 -10 -12 -10 -5 0 C 2 10 9 10 16 0 C 20 -6 24 -6 28 -2',
    stroke: true,
    eye: { x: 28, y: -2 },
    ly: 16,
  },
  // Saltwater crocodile — a low long-snouted reptile with a ridged back and tail.
  'ecology.fauna.oravan.saltwater_crocodile': {
    civ: 'oravan', ox: -28, oy: 8, anchor: 'middle',
    d: 'M -30 3 L 14 3 L 30 0 L 14 -3 L -22 -3 Z',
    detail: 'M -22 -3 l 3 -4 l 3 4 l 3 -4 l 3 4 l 3 -4 l 3 4 l 3 -4 l 3 4 M -30 3 l -7 5 M -16 3 l -2 5 M 2 3 l 2 5',
    eye: { x: 12, y: -3 },
    ly: 16,
  },
  // Kaheri, the reef grouper — a stout deep-bodied fish.
  'ecology.fauna.oravan.reef_grouper': {
    civ: 'oravan', ox: 55, oy: -2, anchor: 'middle',
    d: 'M -18 0 C -13 -11 11 -11 17 0 C 11 11 -13 11 -18 0 Z',
    detail: 'M 17 0 l 11 -8 l 0 16 Z',
    eye: { x: -11, y: -2 },
    ly: 17,
  },
  // Aetharion, the great tuna — a streamlined body with a crescent tail + finlets.
  'ecology.fauna.aethelian.bluefin_tuna': {
    civ: 'aethelian', ox: -130, oy: 80, anchor: 'middle',
    d: 'M -22 0 C -13 -8 13 -7 22 0 C 13 7 -13 8 -22 0 Z',
    detail: 'M 22 0 l 10 -9 l -4 9 l 4 9 Z M -2 -6 l 6 -6 l 2 6 Z M -2 6 l 6 6 l 2 -6 Z',
    eye: { x: -14, y: -1 },
    ly: 16,
  },
  // Dolphins at the bow — a leaping arc with a dorsal fin.
  'ecology.fauna.aethelian.bottlenose_dolphin': {
    civ: 'aethelian', ox: 100, oy: 80, anchor: 'middle',
    d: 'M -26 8 C -17 -11 15 -14 28 -3 C 17 -7 -8 -1 -26 8 Z',
    detail: 'M 3 -12 l 7 -8 l 1 8 Z',
    eye: { x: 21, y: -4 },
    ly: 16,
  },
  // Halistra, the cave-seal — a rounded body hauled on a rock.
  'ecology.fauna.aethelian.monk_seal': {
    civ: 'aethelian', ox: -120, oy: -70, anchor: 'middle',
    d: 'M -22 4 C -24 -7 -8 -12 2 -11 C 9 -10 13 -5 18 -2 C 22 0 24 3 24 5 Z',
    detail: 'M -28 7 q 28 7 56 0',
    eye: { x: -16, y: -3 },
    ly: 18,
  },
  // The wandering turtle — a domed carapace, head, and four paddle flippers.
  'ecology.fauna.aethelian.loggerhead_turtle': {
    civ: 'aethelian', ox: 90, oy: -70, anchor: 'middle',
    d: 'M -15 2 A 15 11 0 0 1 15 2 Z',
    detail: 'M 15 1 l 9 -3 l -1 6 Z M -11 2 l -8 4 l 3 3 Z M -4 3 l -3 8 l 4 -1 Z M 5 3 l 3 8 l -4 -1 Z M 12 2 l 8 4 l -3 3 Z',
    ly: 18,
  },
}

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
    for (const fauna of selectFaunaEngravings(asterisms)) {
      const shape = FAUNA_SHAPES[fauna.id]
      const zone = REGION_ZONES[shape.civ]
      if (!zone) continue
      const ax = zone.x + shape.ox
      const ay = svgY(zone.y + shape.oy)
      const faunaG = group.append('g')
        .attr('class', 'marginalia-fauna')
        .attr('data-id', fauna.id)
        .attr('transform', `translate(${ax}, ${ay})`)

      faunaG.append('path')
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
        faunaG.append('path')
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
        faunaG.append('circle')
          .attr('cx', shape.eye.x)
          .attr('cy', shape.eye.y)
          .attr('r', 1)
          .attr('fill', 'currentColor')
          .attr('fill-opacity', 0.85)
      }

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
