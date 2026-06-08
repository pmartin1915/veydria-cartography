/**
 * sea-sightings.ts — map an at-sea megafauna encounter back to its marginalia
 * silhouette + canon name, for the TravelVignette sighting overlay.
 *
 * The 5 entries are the canon guard: an encounter `key` resolves to a sighting
 * only if it is one of the iconic ocean megafauna (ADR-0023 Beat 4). Every other
 * beat — reef fauna, land caravans, "nothing" — resolves to null and shows no
 * silhouette. Keep this in sync with encounters.json (keys), fauna-shapes.ts
 * (faunaId geometry), and asterisms.json (prose_label names); the unit test pins
 * all three so drift is caught.
 *
 * `name` is the canon `prose_label` from asterisms.json — used verbatim in the
 * caption (em-dash-free, VOICE-SPEC Option B). Do NOT reuse the Encounter.beat
 * text, which the external loader joins with a literal em-dash.
 */

export interface Sighting {
  /** fauna-shapes.ts / asterisms.json id, e.g. `ecology.fauna.oravan.sperm_whale`. */
  faunaId: string
  /** Canon display name (asterism prose_label), e.g. "Mohala, the deep-diver". */
  name: string
}

export const SIGHTING_FAUNA: Record<string, Sighting> = {
  'oravan.sperm_whale_deep_strait': { faunaId: 'ecology.fauna.oravan.sperm_whale', name: 'Mohala, the deep-diver' },
  'oravan.whale_shark_baitfish': { faunaId: 'ecology.fauna.oravan.whale_shark', name: 'Nalara, the star-spotted' },
  'oravan.giant_manta_reef_pass': { faunaId: 'ecology.fauna.oravan.giant_manta', name: 'Velara, the cloak-shadow' },
  'aethelian.fin_whale_open_crossing': { faunaId: 'ecology.fauna.aethelian.fin_whale', name: 'Ketarion, the far spout' },
  'aethelian.great_white_rudder': { faunaId: 'ecology.fauna.aethelian.great_white', name: 'Kharistra, the grey weight' },
}

/** Resolve an encounter to its sighting, or null if it is not a megafauna sighting. */
export function resolveSighting(enc: { key?: string }): Sighting | null {
  return enc.key ? SIGHTING_FAUNA[enc.key] ?? null : null
}
