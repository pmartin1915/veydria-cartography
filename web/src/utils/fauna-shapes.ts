/**
 * fauna-shapes.ts — hand-authored marginalia silhouettes for the attested ocean
 * fauna, as a Leaflet/d3-free leaf module.
 *
 * These were extracted from marginalia-overlay.ts so a SECOND surface can reuse
 * the same geometry without dragging Leaflet/d3 into its bundle or test env:
 *  - marginalia-overlay.ts draws them as "here be…" engravings in the open water.
 *  - TravelVignette.tsx (via sea-sightings.ts) drifts one in the vignette water
 *    band when a sea leg rolls that creature's at-sea sighting.
 *
 * Single source of truth: edit a silhouette here and both surfaces follow.
 *
 * Each is an attested real species (see data/asterisms.yaml). Any fauna id absent
 * here is skipped by both consumers (forward-compat).
 */

export interface FaunaShape {
  /** Home region (a key of marginalia-overlay's REGION_ZONES); also the fauna row's `civ`. */
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
export const FAUNA_SHAPES: Record<string, FaunaShape> = {
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

  // ── Beat 4: iconic megafauna — drawn clearly larger than the reef fauna above ──
  // Same antique-engraving idiom, bigger spans (the leviathans the canon prose calls
  // "the largest thing anyone aboard will see all year"). Offsets keep them in open
  // water, clear of the smaller fauna and every land/basin polygon.

  // Mohala, the sperm whale — blunt squared head (facing right), low jaw, broad flukes.
  'ecology.fauna.oravan.sperm_whale': {
    civ: 'oravan', ox: 27, oy: -78, anchor: 'middle',
    d: 'M -32 0 C -25 -10 0 -11 19 -9 C 27 -8 31 -5 33 -2 C 34 0 34 3 32 6 C 28 9 6 10 -32 2 Z',
    detail: 'M -32 1 l -10 -7 l 2 7 l -2 7 Z M 6 7 L 31 4 M -23 -5 l 2 4',
    eye: { x: 22, y: -3 },
    ly: 18,
  },
  // Nalara, the whale shark — broad flat head, star-spotted hide, wide tail.
  'ecology.fauna.oravan.whale_shark': {
    civ: 'oravan', ox: 107, oy: -44, anchor: 'middle',
    d: 'M -28 0 C -23 -10 6 -12 24 -8 L 30 -6 C 32 -3 32 3 30 6 L 24 8 C 6 12 -23 10 -28 0 Z',
    detail: 'M -28 0 l -12 -10 l 3 10 l -3 10 Z M 3 -10 l 6 -7 l 3 6 Z M 10 8 l 4 7 l 6 -5 Z M -12 -3 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0 M -2 3 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0 M 7 -2 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0 M 16 2 a 1 1 0 1 0 2 0 a 1 1 0 1 0 -2 0',
    eye: { x: 24, y: -3 },
    ly: 18,
  },
  // Velara, the giant manta — top-down banking ray: swept wings, cephalic horns, whip tail.
  'ecology.fauna.oravan.giant_manta': {
    civ: 'oravan', ox: 92, oy: -110, anchor: 'middle',
    d: 'M 26 0 C 18 -4 13 -7 10 -9 C -3 -26 -20 -27 -23 -23 C -16 -12 -10 -6 -2 -2 C -11 -3 -19 -2 -24 0 C -19 2 -11 3 -2 2 C -10 6 -16 12 -23 23 C -20 27 -3 26 10 9 C 13 7 18 4 26 0 Z',
    detail: 'M 23 -2 l 7 -5 l -2 5 Z M 23 2 l 7 5 l -2 -5 Z M -24 0 l -13 0',
    ly: 34,
  },
  // Kharistra, the great white — pointed snout (right), tall dorsal, lunate tail (left).
  'ecology.fauna.aethelian.great_white': {
    civ: 'aethelian', ox: -53, oy: -18, anchor: 'middle',
    d: 'M -34 0 C -28 -10 0 -11 20 -7 C 30 -5 38 -2 42 0 C 38 2 30 5 20 7 C 0 11 -28 10 -34 0 Z',
    detail: 'M -34 0 l -12 -12 l 4 12 l -4 12 Z M -2 -9 l 5 -14 l 8 11 Z M 6 8 l 4 11 l 10 -5 Z M 28 -5 l -2 10 M 31 -4 l -2 8 M 34 -3 l -2 7',
    eye: { x: 32, y: -3 },
    ly: 18,
  },
  // Ketarion, the fin whale — long slender body (right-facing), small far-back dorsal, flukes.
  'ecology.fauna.aethelian.fin_whale': {
    civ: 'aethelian', ox: 44, oy: 2, anchor: 'middle',
    d: 'M -42 0 C -33 -7 0 -8 27 -6 C 38 -5 44 -2 46 -1 C 47 0 47 0 46 1 C 44 3 38 5 27 6 C 0 8 -33 7 -42 0 Z',
    detail: 'M -42 0 l -11 -6 l 3 6 l -3 6 Z M -13 -6 l 4 -6 l 3 5 Z M 15 6 l 5 7 l 5 -4 Z M 16 5 L 44 3',
    eye: { x: 32, y: -3 },
    ly: 18,
  },
}
