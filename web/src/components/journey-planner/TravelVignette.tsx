import type { ReactNode } from 'react'
import type { JourneyRoute, Season } from '../../utils/journey-graph'
import { selectVignette, type VignetteBackdrop, type VignetteMode, type VignetteScene } from '../../utils/vignette'
import { FAUNA_SHAPES } from '../../utils/fauna-shapes'
import type { Sighting } from '../../utils/sea-sightings'

// TravelVignette — an Oregon-Trail-style "window" crowning the route panel. It
// shows the region the SELECTED segment travels through (backdrop) and that
// region's attested mode of travel (foreground silhouette). Both are chosen by
// the canon-backed selector in utils/vignette.ts; this file is just the art.
//
// House style mirrors the compass-rose / map markers: inline schematic SVG,
// no raster assets. Backdrops use the map's biome palette so the scene reads as
// the same world; foregrounds are single-tone silhouettes for a grounded,
// dusk-lit feel. A faint season tint + slow drift add life (reduced-motion safe).

// ── Region backdrops (drawn over the season-tinted sky band) ─────────────────
const BACKDROPS: Record<VignetteBackdrop, ReactNode> = {
  'desert-oasis': (
    <g>
      <circle className="tv-drift" cx="58" cy="26" r="12" fill="#e8c878" opacity="0.85" />
      <path d="M0 60 q80 -16 160 -2 t160 -4 V88 H0 Z" fill="#d9a85c" />
      <path d="M0 72 q100 -10 200 2 t120 -4 V88 H0 Z" fill="#c8966a" />
      <g fill="#7a5a36">
        <rect x="146" y="58" width="3" height="16" />
        <path d="M147 58 q-12 -4 -16 2 q10 -2 16 2 q12 -4 16 2 q-10 -2 -16 -2 z" />
      </g>
    </g>
  ),
  'steppe-cliff': (
    <g>
      <path d="M110 60 q50 -18 110 0 z" fill="#b8a64e" opacity="0.8" />
      <path d="M0 30 L44 34 L58 62 L0 64 Z" fill="#5a4f3a" />
      <path d="M0 30 L44 34 L40 40 L0 38 Z" fill="#6b5e46" />
      <path d="M0 62 q160 -8 320 0 V88 H0 Z" fill="#d8cf72" />
      <path d="M30 70 h260" stroke="#bdb45f" strokeWidth="1" opacity="0.6" />
    </g>
  ),
  'cloud-forest-terrace': (
    <g>
      <polygon points="100,62 170,12 240,62" fill="#2c5a40" />
      <polygon points="30,62 88,26 146,62" fill="#3f7d5a" />
      <polygon points="180,62 244,22 308,62" fill="#3f7d5a" />
      <rect className="tv-drift" x="0" y="46" width="320" height="9" fill="#ffffff" opacity="0.3" />
      <path d="M0 62 H320 V88 H0 Z" fill="#356a4a" />
      <g stroke="#2c5a40" strokeWidth="1" opacity="0.7">
        <path d="M20 70 h280" /><path d="M40 78 h240" />
      </g>
    </g>
  ),
  'plateau-savanna': (
    <g>
      <polygon points="18,62 18,44 96,44 96,62" fill="#8a7a44" />
      <polygon points="200,62 200,50 268,50 268,62" fill="#9a8a54" />
      <path d="M150 62 l8 -16 8 16 z" fill="#4a3f2a" />
      <path d="M0 62 q160 -6 320 0 V88 H0 Z" fill="#b8a64e" />
      <g fill="#2c4a30">
        <rect x="128" y="48" width="2.5" height="14" />
        <path d="M129 50 q-14 -3 -22 -1 q8 -5 22 -2 q14 -3 22 2 q-8 -2 -22 1 z" />
      </g>
    </g>
  ),
  'delta-mangrove': (
    <g>
      <path d="M0 58 q160 -6 320 0 V88 H0 Z" fill="#3f7d6a" />
      <rect x="0" y="62" width="320" height="26" fill="#4a8a9a" opacity="0.9" />
      <g fill="#2f7d6e">
        <ellipse cx="56" cy="60" rx="18" ry="8" />
        <ellipse cx="150" cy="58" rx="22" ry="9" />
        <ellipse cx="250" cy="60" rx="18" ry="8" />
      </g>
      <g stroke="#2f6d5e" strokeWidth="1.5" opacity="0.8">
        <path d="M150 58 v10 M156 58 v10 M144 58 v10" />
      </g>
      <g stroke="#bfe3e0" strokeWidth="1" opacity="0.5">
        <path d="M30 74 h40 M120 80 h60 M230 76 h40" />
      </g>
    </g>
  ),
  'volcanic-reef': (
    <g>
      <polygon points="52,64 100,20 148,64" fill="#8a4228" />
      <polygon points="100,20 148,64 110,52" fill="#6e3420" />
      <path className="tv-drift" d="M100 20 q-4 -10 4 -14 q4 6 0 14 z" fill="#9a9a9a" opacity="0.6" />
      <path d="M0 60 q160 -4 320 0 V88 H0 Z" fill="#2a6a64" />
      <rect x="0" y="64" width="320" height="24" fill="#3fb0a8" opacity="0.85" />
      <g fill="#2f8a82">
        <ellipse cx="210" cy="68" rx="10" ry="3" />
        <ellipse cx="250" cy="71" rx="14" ry="3.5" />
        <ellipse cx="290" cy="68" rx="9" ry="3" />
      </g>
    </g>
  ),
  'open-road': (
    <g>
      <path d="M0 60 q160 -6 320 0 V88 H0 Z" fill="#6f7a5a" />
      <path d="M0 60 q160 -6 320 0" stroke="#8a946f" strokeWidth="1" fill="none" opacity="0.7" />
      <path d="M150 88 Q166 70 200 62 T306 50" stroke="#c9b896" strokeWidth="3" fill="none" opacity="0.85" />
    </g>
  ),
}

// ── Foreground silhouettes (single-tone, positioned bottom-right) ────────────
const FIGURES: Record<VignetteMode, ReactNode> = {
  horse: (
    <g>
      <ellipse cx="252" cy="60" rx="20" ry="8" />
      <polygon points="268,58 277,43 283,45 274,60" />
      <path d="M281 43 l6 -1 -1 5 -6 1 z" />
      <path d="M232 56 q-7 3 -5 13 l3 0 q-1 -8 5 -11 z" />
      <rect x="236" y="64" width="2.5" height="11" /><rect x="244" y="64" width="2.5" height="11" />
      <rect x="260" y="64" width="2.5" height="11" /><rect x="268" y="64" width="2.5" height="11" />
      <ellipse cx="252" cy="49" rx="4" ry="5" /><circle cx="252" cy="43" r="2.6" />
    </g>
  ),
  camel: (
    <g>
      <path d="M236 58 q6 -13 12 -2 q5 -13 12 -2 v6 q-12 4 -24 0 z" />
      <ellipse cx="248" cy="58" rx="18" ry="6" />
      <polygon points="266,56 279,38 283,40 271,57" />
      <path d="M279 38 l6 -2 0 5 -6 1 z" />
      <rect x="236" y="62" width="2.4" height="14" /><rect x="244" y="62" width="2.4" height="14" />
      <rect x="258" y="62" width="2.4" height="14" /><rect x="266" y="62" width="2.4" height="14" />
      <ellipse cx="250" cy="44" rx="3.6" ry="4.5" /><circle cx="250" cy="39" r="2.4" />
    </g>
  ),
  llama: (
    <g>
      <ellipse cx="254" cy="58" rx="13" ry="7" />
      <rect x="244" y="52" width="20" height="5" rx="1.5" />
      <polygon points="262,55 266,39 269,39 266,56" />
      <path d="M266 39 l5 -2 0 4 -5 1 z" />
      <path d="M264 38 l1 -5 1 5 z" />
      <rect x="246" y="62" width="2.4" height="13" /><rect x="252" y="62" width="2.4" height="13" />
      <rect x="260" y="62" width="2.4" height="13" /><rect x="266" y="62" width="2.4" height="13" />
    </g>
  ),
  porter: (
    <g>
      <g transform="translate(-14,0)">
        <rect x="246" y="38" width="15" height="6" rx="1.5" />
        <circle cx="253" cy="48" r="4" />
        <path d="M249 52 h8 l2 14 h-3 l-3 -9 -3 9 h-3 z" />
      </g>
      <rect x="262" y="44" width="15" height="6" rx="1.5" />
      <circle cx="269" cy="54" r="4" />
      <path d="M265 58 h8 l2 16 h-3 l-3 -10 -3 10 h-3 z" />
      <line x1="278" y1="50" x2="281" y2="76" stroke="currentColor" strokeWidth="2" />
    </g>
  ),
  'river-boat': (
    <g>
      <path d="M222 62 q30 14 60 0 q-9 8 -30 8 q-21 0 -30 -8 z" />
      <path d="M222 62 q-5 -7 1 -11 l2 2 q-4 3 0 9 z" />
      <path d="M282 62 q6 -6 0 -11 l-2 2 q4 3 0 9 z" />
      <circle cx="252" cy="51" r="3.4" /><path d="M249 55 h6 l1 7 h-8 z" />
      <line x1="256" y1="54" x2="266" y2="66" stroke="currentColor" strokeWidth="1.8" />
    </g>
  ),
  'sea-ship': (
    <g>
      <path d="M222 66 q30 11 60 0 l-7 9 h-46 z" />
      <rect x="250" y="36" width="2.4" height="30" />
      <polygon points="253,38 273,41 271,60 253,62" />
      <polygon points="249,42 234,57 249,59" />
      <path d="M222 66 q-4 -5 1 -9 l2 2 q-3 2 0 7 z" />
    </g>
  ),
}

export default function TravelVignette({
  route,
  edgeBiomes,
  selectedSegmentIdx,
  season,
  sighting,
  isSea,
}: {
  route: JourneyRoute | null
  edgeBiomes: (string | undefined)[] | undefined
  selectedSegmentIdx: number
  season: Season | undefined
  /** The at-sea megafauna sighting on the selected leg, if any (sea legs only). */
  sighting?: Sighting | null
  /** Whether the selected leg travels over open water (see isSeaLeg). */
  isSea?: boolean
}) {
  if (!route || route.edges.length === 0) return null

  const i = Math.max(0, Math.min(selectedSegmentIdx, route.edges.length - 1))
  const edge = route.edges[i]
  const fromCiv = route.nodes.find(n => n.id === edge.from)?.civ
  const toCiv = route.nodes.find(n => n.id === edge.to)?.civ
  let scene: VignetteScene = selectVignette({ fromCiv, toCiv, biome: edgeBiomes?.[i] })
  // A sea leg whose endpoints don't resolve to a boat scene (e.g. a basin↔inland
  // crossing whose midpoint biome isn't water) must still read as open water — never
  // a caravan on the ocean. Coerce to the sea scene so the water band (and any
  // sighting silhouette) render.
  if (isSea && scene.mode !== 'sea-ship') {
    scene = { backdrop: 'volcanic-reef', mode: 'sea-ship', regionLabel: 'Open water', modeLabel: 'Sea ship' }
  }
  const sightingShape = sighting ? FAUNA_SHAPES[sighting.faunaId] : undefined

  const segmentLabel = route.edges.length > 1 ? `Leg ${i + 1} of ${route.edges.length}` : 'The journey'

  return (
    <div
      className="travel-vignette"
      data-testid="travel-vignette"
      data-mode={scene.mode}
      data-backdrop={scene.backdrop}
      data-season={season ?? 'none'}
      title={`${scene.regionLabel} — ${scene.modeLabel}`}
    >
      <svg className="travel-vignette-svg" viewBox="0 0 320 88" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${scene.regionLabel}: ${scene.modeLabel}`}>
        <rect className="tv-sky" x="0" y="0" width="320" height="88" />
        {BACKDROPS[scene.backdrop]}
        {sightingShape && scene.backdrop === 'volcanic-reef' && (
          <g className="tv-sighting tv-drift" transform="translate(150 74) scale(0.5)" aria-hidden="true">
            <path
              d={sightingShape.d}
              fill={sightingShape.stroke ? 'none' : '#10141c'}
              fillOpacity={sightingShape.stroke ? 1 : 0.5}
              stroke="#10141c"
              strokeWidth={sightingShape.stroke ? 1.4 : 1}
            />
            {sightingShape.detail && (
              <path d={sightingShape.detail} fill="none" stroke="#10141c" strokeWidth={0.8} strokeOpacity={0.7} />
            )}
            {sightingShape.eye && <circle cx={sightingShape.eye.x} cy={sightingShape.eye.y} r={1} fill="#10141c" />}
          </g>
        )}
        <g className="tv-figure">{FIGURES[scene.mode]}</g>
      </svg>
      <div className="travel-vignette-caption">
        <span className="travel-vignette-region" data-testid="travel-vignette-region">{scene.regionLabel}</span>
        <span className="travel-vignette-leg">{segmentLabel}</span>
        <span className="travel-vignette-mode" data-testid="travel-vignette-mode">{scene.modeLabel}</span>
        {sighting && (
          <span className="travel-vignette-sighting" data-testid="travel-vignette-sighting">{`Sighting: ${sighting.name}`}</span>
        )}
      </div>
    </div>
  )
}
