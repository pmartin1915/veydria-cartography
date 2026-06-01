/**
 * external-encounters.ts — consume worldbuilder's machine-readable encounter canon
 *
 * The journey-sim's default encounter pools (encounters.ts) are hand-authored
 * placeholder beats. This module lets the sim ALSO draw from worldbuilder's
 * encounter canon, delivered as `encounters.json` (synced + converted from
 * `ecology/encounters/encounters.yaml` by scripts/sync-world-data.mjs).
 *
 * Contract: worldbuilder/design/world-architecture/ADR-0022-encounter-canon-machine-extract.md
 *
 * DETERMINISM / DORMANCY: external data is OFF until `setExternalEncounters` /
 * `loadExternalEncounters` is called. When off, `augmentPoolWithWeighted` returns
 * the pool unchanged, so `generateEncounters` is byte-identical to its pre-existing
 * behaviour. The browser opts in (see main.tsx); the Node sim does not load it, so
 * the sim baseline is preserved. When on, augmentation is additive and order-stable,
 * so the seeded draw stays deterministic — only the pool an index maps into changes,
 * never the RNG stream itself.
 */

import type { Beat } from './encounters'
import type { Season } from './journey-graph'
import type { TimeOfDay } from './time-of-day'

/** One row of the encounters.yaml extract (ADR-0022 schema). */
export interface ExternalEncounter {
  key: string
  civ: string
  source_md?: string
  prose_label: string
  /** Optional — a worldbuilder primary biome (sim BIOME_COLORS key). Absent = civ-region-wide. */
  biome?: string
  type: Beat['type']
  severity: Beat['severity']
  frequency: 'common' | 'uncommon' | 'rare'
  /** Sim TimeOfDay, or 'any' (= unpinned). */
  time?: TimeOfDay | 'any'
  season?: (Season | 'any')[]
  sensory_hook?: string
}

/** The parsed encounters.json file (yaml extract → json by the sync step). */
export interface ExternalEncounterFile {
  schema_version?: number
  controlled_vocabularies?: {
    frequency_weight?: Record<string, number>
    [k: string]: unknown
  }
  encounters: ExternalEncounter[]
}

/** Fallback weights if the file omits the map (mirrors ADR-0022 D4). */
const DEFAULT_FREQUENCY_WEIGHT: Record<string, number> = { common: 3, uncommon: 2, rare: 1 }

/** Edge types worldbuilder encounters apply to. Chokepoint beats stay sim-authored (ADR-0022 D5). */
const AUGMENTABLE_EDGE_TYPES = new Set<string>(['trade_route', 'intra_civ', 'civ_link'])

let externalFile: ExternalEncounterFile | null = null

/** Inject external encounters directly (used by the browser loader and by tests). */
export function setExternalEncounters(file: ExternalEncounterFile | null): void {
  externalFile = file
}

export function getExternalEncounters(): ExternalEncounterFile | null {
  return externalFile
}

function weightFor(freq: string): number {
  const map = externalFile?.controlled_vocabularies?.frequency_weight ?? DEFAULT_FREQUENCY_WEIGHT
  return map[freq] ?? 1
}

/** Convert an external row into the sim's Beat shape. */
function toBeat(e: ExternalEncounter): Beat {
  const text = e.sensory_hook ? `${e.prose_label} — ${e.sensory_hook}` : e.prose_label
  const timeOfDay = e.time && e.time !== 'any' ? [e.time] : undefined
  return {
    text,
    type: e.type,
    severity: e.severity,
    biome: e.biome,
    ...(timeOfDay ? { timeOfDay } : {}),
  }
}

/**
 * The external beats eligible for a segment, replicated by frequency weight.
 * Eligible when: external data is loaded, the edge type is augmentable, the
 * encounter's civ is one of the segment's endpoint civs, and the encounter is
 * either region-wide (no biome) or matches the segment biome. Order is stable
 * (file order × weight) so the seeded draw stays deterministic.
 */
export function externalBeatsFor(
  civs: (string | undefined)[],
  edgeType: string,
  biome?: string,
): Beat[] {
  if (!externalFile || !AUGMENTABLE_EDGE_TYPES.has(edgeType)) return []
  const civSet = new Set(civs.filter(Boolean) as string[])
  if (civSet.size === 0) return []

  const out: Beat[] = []
  for (const e of externalFile.encounters) {
    if (!civSet.has(e.civ)) continue
    if (e.biome && biome && e.biome !== biome) continue
    if (e.biome && !biome) continue // biome-specific beat, but segment has no biome → skip
    const beat = toBeat(e)
    const w = weightFor(e.frequency)
    for (let i = 0; i < w; i++) out.push(beat)
  }
  return out
}

/**
 * Append weight-replicated external beats to a base pool. Returns the SAME pool
 * (unchanged) when no external data is loaded or nothing matches — preserving
 * byte-identical default behaviour. Never mutates the input pool.
 */
export function augmentPoolWithWeighted(
  pool: Beat[],
  civs: (string | undefined)[],
  edgeType: string,
  biome?: string,
): Beat[] {
  const extra = externalBeatsFor(civs, edgeType, biome)
  return extra.length === 0 ? pool : [...pool, ...extra]
}

/**
 * Browser-side loader: fetch the synced encounters.json and arm augmentation.
 * Idempotent and failure-tolerant — a 404 (file not yet synced) silently leaves
 * augmentation off, so the app degrades to the default pools. Never throws.
 */
let loadPromise: Promise<void> | null = null
export function loadExternalEncounters(baseUrl = ''): Promise<void> {
  if (externalFile) return Promise.resolve()
  if (loadPromise) return loadPromise
  loadPromise = fetch(`${baseUrl}encounters.json`)
    .then((res) => (res.ok ? res.json() : null))
    .then((data: ExternalEncounterFile | null) => {
      if (data && Array.isArray(data.encounters)) externalFile = data
    })
    .catch(() => {
      /* offline / missing file → stay on default pools */
    })
    .finally(() => {
      loadPromise = null // allow a later retry if the file wasn't armed
    })
  return loadPromise
}
