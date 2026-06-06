/**
 * asterisms.ts — load the chart's navigational asterism register (art-layer data)
 *
 * The ocean-chart marginalia draws named star-figures from the Oravan nakhoda
 * star-register. This module loads that register, delivered as `asterisms.json`
 * (generated from data/asterisms.yaml by scripts/build-asterisms.mjs). It is the
 * cartography-side machine extract ADR-0023 Q6/Q7 assign to this repo — canon owns
 * the names/identities (worldbuilder star-register.md), the picture is app art.
 *
 * DORMANCY: nothing renders from this yet. `loadAsterisms` is failure-tolerant
 * (a missing file → empty list, never throws); `parseAsterisms` is a pure
 * validator that drops malformed rows, so a bad file degrades to fewer figures
 * rather than a crash. The renderer beat wires the preload + draws the SVG.
 *
 * Contract: worldbuilder/design/world-architecture/ADR-0023-cartographic-marginalia-and-asterism-register.md
 */

export type AsterismKind = 'asterism' | 'cartouche'
export type AsterismPlacement = 'sky' | 'open_water'

/** One entry of the asterisms.json extract (ADR-0023 Q6 schema). */
export interface Asterism {
  /** Stable id minted under the register's canonical id (religion.tradition.star_register.<slug>). */
  id: string
  /** Governing register; all register entries are Oravan nakhoda chart-speech. */
  civ: string
  /** A named star-figure, or an abstract name-plate device (ADR-0023 restricted-C). */
  kind: AsterismKind
  /** Where the marginalia sits: the sky/margin band, or in open water (future fauna layer). */
  placement: AsterismPlacement
  prose_label: string
  /** One-line use, read from the register. */
  gloss: string
  /** Attested root composition, read from the register. */
  etymology: string
  /** Path to the SVG art asset, or null until the renderer beat authors it. */
  illustration_ref: string | null
}

/** The parsed asterisms.json file (yaml extract → json by the build step). */
export interface AsterismsFile {
  schema_version?: number
  asterisms: Asterism[]
}

const KINDS = new Set<AsterismKind>(['asterism', 'cartouche'])
const PLACEMENTS = new Set<AsterismPlacement>(['sky', 'open_water'])

function isAsterism(row: unknown): row is Asterism {
  if (!row || typeof row !== 'object') return false
  const r = row as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    typeof r.civ === 'string' &&
    typeof r.prose_label === 'string' &&
    typeof r.gloss === 'string' &&
    typeof r.etymology === 'string' &&
    KINDS.has(r.kind as AsterismKind) &&
    PLACEMENTS.has(r.placement as AsterismPlacement) &&
    (r.illustration_ref === null || typeof r.illustration_ref === 'string')
  )
}

/**
 * Validate a raw asterisms.json payload into typed entries, dropping any
 * malformed rows. Tolerates a missing/non-array `asterisms` field → `[]`.
 */
export function parseAsterisms(raw: unknown): Asterism[] {
  const rows = (raw as AsterismsFile | null)?.asterisms
  if (!Array.isArray(rows)) return []
  return rows.filter(isAsterism)
}

/**
 * Browser-side loader: fetch the generated asterisms.json and parse it.
 * Cached + in-flight-deduped; a 404 (file not yet built) resolves to `[]`
 * so the chart degrades to no marginalia rather than failing. Never throws.
 */
let cache: Asterism[] | null = null
let loadPromise: Promise<Asterism[]> | null = null
export function loadAsterisms(baseUrl = import.meta.env.BASE_URL): Promise<Asterism[]> {
  if (cache) return Promise.resolve(cache)
  if (loadPromise) return loadPromise
  loadPromise = fetch(`${baseUrl}asterisms.json`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data: unknown) => {
      cache = parseAsterisms(data)
      return cache
    })
    .catch(() => {
      /* offline / missing file → no marginalia */
      return [] as Asterism[]
    })
    .finally(() => {
      loadPromise = null // allow a later retry if the file wasn't loaded
    })
  return loadPromise
}
