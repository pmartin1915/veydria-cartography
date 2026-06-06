// vignette.ts — pure scene selection for the journey TravelVignette.
//
// Maps a route segment to a region backdrop + a foreground travel mode. Every
// pairing is CANON-ATTESTED per worldbuilder's travel-vignette inventory
// (SCOPING-2026-06-05-travel-vignette-canon-inventory.md): each civilization has
// exactly one attested mode of travel, so the foreground is a closed 6-mode enum
// — no invented mode. Kept as a leaf module (no React) so the selector can be
// unit-tested directly and the art component stays a thin renderer.

export type VignetteMode = 'horse' | 'camel' | 'llama' | 'porter' | 'river-boat' | 'sea-ship'

export type VignetteBackdrop =
  | 'steppe-cliff'
  | 'desert-oasis'
  | 'cloud-forest-terrace'
  | 'plateau-savanna'
  | 'delta-mangrove'
  | 'volcanic-reef'
  | 'open-road'

export interface VignetteScene {
  backdrop: VignetteBackdrop
  mode: VignetteMode
  /** Display name of the region the segment is travelling through. */
  regionLabel: string
  /** Short caption for the foreground figure (e.g. "Camel caravan"). */
  modeLabel: string
}

interface CivVignette {
  backdrop: VignetteBackdrop
  mode: VignetteMode
  regionLabel: string
  modeLabel: string
}

// Civ slug (UNDERSCORE form, matching node.civ / CIV_COLORS) → attested scene.
// Source: ecology/regions/<civ>.md per the canon inventory.
const CIV_VIGNETTE: Record<string, CivVignette> = {
  kheshkai: { backdrop: 'steppe-cliff', mode: 'horse', regionLabel: 'Kheshkai', modeLabel: 'Horse' },
  irrah: { backdrop: 'desert-oasis', mode: 'camel', regionLabel: 'Irrah', modeLabel: 'Camel caravan' },
  qollari: { backdrop: 'cloud-forest-terrace', mode: 'llama', regionLabel: 'Qollari', modeLabel: 'Llama train' },
  ngaru_bon: { backdrop: 'plateau-savanna', mode: 'porter', regionLabel: 'Ngaru-Bon', modeLabel: 'Porters' },
  ndjadi: { backdrop: 'delta-mangrove', mode: 'river-boat', regionLabel: 'Ndjadi', modeLabel: 'River boat' },
  oravan: { backdrop: 'volcanic-reef', mode: 'sea-ship', regionLabel: 'Oravan', modeLabel: 'Sea ship' },
}

// Fallback only: when neither endpoint carries an authored civ (e.g. a contested
// or shared site), infer the region from the segment's midpoint biome. Keys are
// BIOME_COLORS names; only the unambiguous civ-distinctive biomes are mapped.
const BIOME_CIV: Record<string, string> = {
  Steppe: 'kheshkai',
  Desert: 'irrah',
  Sabkha: 'irrah',
  Oasis: 'irrah',
  Escarpment: 'irrah',
  'Cloud forest': 'qollari',
  'Highland savanna': 'ngaru_bon',
  'Miombo woodland': 'ngaru_bon',
  'Afroalpine heath': 'ngaru_bon',
  'River gorge': 'ngaru_bon',
  'Monsoon delta': 'ndjadi',
  'Mangrove swamp': 'ndjadi',
  Floodplain: 'ndjadi',
  'Volcanic archipelago': 'oravan',
  'Coral reef': 'oravan',
  'Geothermal vent': 'oravan',
}

const NEUTRAL: VignetteScene = {
  backdrop: 'open-road',
  mode: 'porter',
  regionLabel: 'Open road',
  modeLabel: 'On foot',
}

/**
 * Pick the civ whose region a segment best represents.
 * - Same civ on both ends → that civ.
 * - A crossing (different civs) → the WATER civ wins if present, because a
 *   strait/delta crossing reads as a boat scene (Oravan sea-ship / Ndjadi
 *   river-boat); otherwise the destination civ (the region being entered).
 * - One end civ-less → the named end.
 * - Both civ-less → infer from the midpoint biome.
 */
function pickCiv(fromCiv?: string, toCiv?: string, biome?: string): string | undefined {
  if (fromCiv && toCiv) {
    if (fromCiv === toCiv) return fromCiv
    if (fromCiv === 'oravan' || toCiv === 'oravan') return 'oravan'
    if (fromCiv === 'ndjadi' || toCiv === 'ndjadi') return 'ndjadi'
    return toCiv
  }
  const single = fromCiv || toCiv
  if (single) return single
  if (biome && BIOME_CIV[biome]) return BIOME_CIV[biome]
  return undefined
}

/**
 * Resolve a route segment to its vignette scene. Returns a neutral open-road
 * scene when the segment can't be tied to a documented region.
 */
export function selectVignette(opts: { fromCiv?: string; toCiv?: string; biome?: string }): VignetteScene {
  const civ = pickCiv(opts.fromCiv, opts.toCiv, opts.biome)
  const entry = civ ? CIV_VIGNETTE[civ] : undefined
  if (!entry) return NEUTRAL
  return {
    backdrop: entry.backdrop,
    mode: entry.mode,
    regionLabel: entry.regionLabel,
    modeLabel: entry.modeLabel,
  }
}
