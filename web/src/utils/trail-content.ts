/**
 * trail-content.ts — Step 4 (Content) for the Oregon Trail '88 mode.
 *
 * Veydrian ailment vocabulary and per-civ rank ladders, layered over the frozen
 * trail.ts engine. Pure data + two deterministic lookups; no engine mechanics.
 *
 *  - Ailments follow the spec's OT → Veydria content-hooks table
 *    (ai/OREGON-TRAIL-SPEC.md). Selection is context-gated (day biome, aridity,
 *    supply stress, member civ) and seeded — trail.ts passes a ready-mixed seed
 *    from its own AILMENT stream so health rolls are untouched.
 *  - Rank ladders are grounded in worldbuilder canon per civ (patronage,
 *    funerary, and trade-route domains); the generic ladder keeps the former
 *    PROVISIONAL labels so unknown civ slugs behave exactly as before.
 *
 * Ailment names and rank titles are English descriptive compounds; the few
 * canon terms used (azalai, dzud) are attested in worldbuilder linguistics.
 */

import { mulberry32 } from './encounters'
import { CIVS, type CivSlug } from '../components/compendium/types'

/* ─── Civ slug normalization ────────────────────────────────────────────── */

/**
 * Roster civ tags arrive in underscore form (`ngaru_bon`, `aethelian_basin` —
 * see TrailMode's default roster), while canonical CivSlug uses hyphens and
 * plain `basin` (compendium/types.ts). Same mismatch MapKey.tsx normalizes.
 */
export function normalizeCivSlug(civ: string | undefined): CivSlug | undefined {
  if (!civ) return undefined
  const slug = civ.toLowerCase().replace(/_/g, '-')
  const trimmed = slug === 'aethelian-basin' ? 'basin' : slug
  return (CIVS as readonly string[]).includes(trimmed) ? (trimmed as CivSlug) : undefined
}

/* ─── Ailments ──────────────────────────────────────────────────────────── */

export interface AilmentContext {
  /** Today's biome from journey.biomeForEdge — HUNT_ODDS vocabulary. */
  biome?: string
  /** classifyAridity(day) === 'arid'. */
  arid: boolean
  /** Supply stress 0|1|2 — hunger/thirst biases the exhaustion family. */
  supplyStress: 0 | 1 | 2
  /** Member civ tag (any slug form). */
  civ?: string
}

export interface AilmentDef {
  id: string
  /** Display name — rendered verbatim in the roster ledger and epitaphs. */
  name: string
  kind: 'disease' | 'injury'
  /** Hard gate: only when today's biome is in this list (HUNT_ODDS vocabulary). */
  biomes?: readonly string[]
  /** Hard gate: only on arid days. */
  aridOnly?: boolean
  /** Base selection weight among eligible candidates. */
  weight: number
  /** Weight multiplier when the member's (normalized) civ matches. */
  civBias?: { civ: CivSlug; mult: number }
  /** Weight multiplier when supplyStress ≥ 1. */
  stressBoost?: number
}

/**
 * Fixed order — order is part of the determinism contract (same seed + ctx
 * must pick the same name across releases unless the table itself changes).
 *
 * OT mapping: dysentery → river murrain / salt-sickness · typhoid → harmattan
 * collapse / dune-fever · cholera → sabkha sickness · exhaustion → sun-debt /
 * heat-binding · broken leg → scarp-fall / draft-animal fall · measles →
 * sandpox (Oravan variant) · snake bite → scorpion clutch / viper-step.
 */
export const AILMENTS: readonly AilmentDef[] = [
  { id: 'river-murrain',      name: 'river murrain',      kind: 'disease', biomes: ['Forest', 'Savanna'], weight: 3 },
  { id: 'salt-sickness',      name: 'salt-sickness',      kind: 'disease', biomes: ['Sabkha', 'Desert'],  weight: 3 },
  { id: 'harmattan-collapse', name: 'harmattan collapse', kind: 'disease', aridOnly: true,                weight: 2 },
  { id: 'dune-fever',         name: 'dune-fever',         kind: 'disease', aridOnly: true,                weight: 3 },
  { id: 'sabkha-sickness',    name: 'sabkha sickness',    kind: 'disease', biomes: ['Sabkha'],            weight: 4 },
  { id: 'sun-debt',           name: 'sun-debt',           kind: 'disease', aridOnly: true,                weight: 2, stressBoost: 3 },
  { id: 'heat-binding',       name: 'heat-binding',       kind: 'disease', aridOnly: true,                weight: 1, stressBoost: 2 },
  { id: 'sandpox',            name: 'sandpox',            kind: 'disease',                                weight: 1, civBias: { civ: 'oravan', mult: 4 } },
  { id: 'scarp-fall',         name: 'scarp-fall',         kind: 'injury',  biomes: ['Highland'],          weight: 3 },
  { id: 'draft-animal-fall',  name: 'draft-animal fall',  kind: 'injury',                                 weight: 2 },
  { id: 'scorpion-clutch',    name: 'scorpion clutch',    kind: 'injury',  aridOnly: true,                weight: 2 },
  { id: 'viper-step',         name: 'viper-step',         kind: 'injury',                                 weight: 2 },
]

/**
 * Deterministically pick an ailment name for a member falling ill.
 *
 * `seed` is fully mixed by the caller (trail.ts's AILMENT stream — separate
 * from health/hunt streams). One mulberry32 draw against the cumulative
 * weights of the context-eligible candidates. The ungated entries (sandpox,
 * draft-animal fall, viper-step) guarantee a non-empty candidate set.
 */
export function pickAilment(seed: number, ctx: AilmentContext): string {
  const civ = normalizeCivSlug(ctx.civ)
  const candidates: { name: string; w: number }[] = []
  for (const a of AILMENTS) {
    if (a.aridOnly && !ctx.arid) continue
    if (a.biomes && (!ctx.biome || !a.biomes.includes(ctx.biome))) continue
    let w = a.weight
    if (a.civBias && civ === a.civBias.civ) w *= a.civBias.mult
    if (a.stressBoost && ctx.supplyStress >= 1) w *= a.stressBoost
    candidates.push({ name: a.name, w })
  }
  if (candidates.length === 0) return 'fever' // unreachable; keeps the old fallback honest
  const total = candidates.reduce((s, c) => s + c.w, 0)
  const r = mulberry32(seed)() * total
  let acc = 0
  for (const c of candidates) {
    acc += c.w
    if (r < acc) return c.name
  }
  return candidates[candidates.length - 1].name
}

/* ─── Rank ladders ──────────────────────────────────────────────────────── */

/**
 * One slot per frozen threshold branch in scoreTrail — order mirrors that
 * function's branch order. DO NOT reorder.
 */
export const RANK_SLOTS = [
  'flawless',    // arrived, no losses, supply margin to spare
  'full-party',  // arrived, no losses
  'majority',    // arrived, most of the party alive
  'few',         // arrived, half or fewer alive
  'party-wiped', // every member dead
  'perished',    // supply floor breached
  'aborted',     // turned back
] as const

export type RankSlot = (typeof RANK_SLOTS)[number]

type RankLadder = Readonly<Record<RankSlot, string>>

/** The former PROVISIONAL labels — unknown civ slugs behave exactly as before. */
export const GENERIC_RANKS: RankLadder = {
  flawless:      'Trail Warden',
  'full-party':  'Dusty Survivor',
  majority:      'Road-Scarred',
  few:           'Last Walker',
  'party-wiped': 'Bones in the Sand',
  perished:      'Lost to the Road',
  aborted:       'Turn-Back',
}

/**
 * Per-civ ladders, keyed by the party leader's civ. Grounding (worldbuilder):
 * Irrah — azalai salt-caravans, water-patronage; Kheshkai — steppe mobility,
 * sky-burial, dzud; Ndjadi — scribal classification, charnel mounds; Qollari —
 * calendar-keepers, high-cave dead, altitude; Ngaru-Bon — forge-standing,
 * ore-seam afterlife; Oravan — wave-tithe, reef-cast burial, tidal return;
 * Basin — free-port clearing-house, triple-seal, cargo law.
 */
export const RANK_TABLES: Readonly<Record<CivSlug, RankLadder>> = {
  irrah: {
    flawless:      'Master of the Azalai',
    'full-party':  'Salt-Proven',
    majority:      'Thirst-Marked',
    few:           'Last of the Caravan',
    'party-wiped': 'Bones on the Salt Road',
    perished:      'The Desert Kept Them',
    aborted:       'Turned at the First Well',
  },
  kheshkai: {
    flawless:      'First Rider',
    'full-party':  'Herd Unbroken',
    majority:      'Winter-Bitten',
    few:           'Last in the Saddle',
    'party-wiped': 'Given to the Birds',
    perished:      'Lost to the White Dzud',
    aborted:       'Turned Before the Pass',
  },
  ndjadi: {
    flawless:      'Mound-Crowned',
    'full-party':  'Recorded in Full',
    majority:      'Half the Ledger',
    few:           'A Thin Entry',
    'party-wiped': 'Struck from the Rolls',
    perished:      'Unclassified Dead',
    aborted:       'Returned Unstamped',
  },
  qollari: {
    flawless:      'Keeper of the High Road',
    'full-party':  'Breath Unbroken',
    majority:      'Thin-Air Tested',
    few:           'Last at Altitude',
    'party-wiped': 'Left for the High Caves',
    perished:      'Off the Calendar',
    aborted:       'Turned Below the Snowline',
  },
  'ngaru-bon': {
    flawless:      'Anvil-Proven',
    'full-party':  'Forge-Whole',
    majority:      'Slag-Scarred',
    few:           'Last Ember',
    'party-wiped': 'Returned to the Seam',
    perished:      'Cold Forge',
    aborted:       'Turned from the Fire',
  },
  oravan: {
    flawless:      'Tide-Master',
    'full-party':  'Unclaimed by the Tide',
    majority:      'Salt-Scoured',
    few:           'Last Ashore',
    'party-wiped': 'Given to the Reef',
    perished:      'The Tithe Was Paid',
    aborted:       'Turned on the Ebb',
  },
  basin: {
    flawless:      'Triple-Sealed',
    'full-party':  'Manifest Complete',
    majority:      'Costs Written Off',
    few:           'Salvage Rights',
    'party-wiped': 'Unclaimed Cargo',
    perished:      'Defaulted on the Road',
    aborted:       'Contract Voided',
  },
}

/** Rank label for a civ (any slug form) and slot; generic ladder on unknown civ. */
export function rankLabel(civ: string | undefined, slot: RankSlot): string {
  const normalized = normalizeCivSlug(civ)
  const ladder = normalized ? RANK_TABLES[normalized] : GENERIC_RANKS
  return ladder[slot]
}
