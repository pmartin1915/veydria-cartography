/**
 * journey-saved.ts — LocalStorage persistence for saved journeys
 *
 * Canonical key: veydria.journeys.v1
 * Migrates defensively from legacy veydria-journey-history on first read.
 */

import { kvStore } from '../persistence/kv-store'
import type { Season, RouteMode, PartyConfig, TravelPace, Mount, PartySize } from './journey-graph'
import { DEFAULT_PARTY } from './journey-graph'
import type { SupplyConfig, Encumbrance, PackAnimals } from './journey-supply'
import { DEFAULT_SUPPLY } from './journey-supply'

const VALID_PACES: TravelPace[] = ['slow', 'normal', 'fast']
const VALID_MOUNTS: Mount[] = ['foot', 'mounted']
const VALID_SIZES: PartySize[] = ['small', 'medium', 'large']
const VALID_ENCUMBRANCE: Encumbrance[] = ['light', 'normal', 'heavy']
const VALID_PACK_ANIMALS: PackAnimals[] = ['none', 'few', 'caravan']

function sanitizeParty(raw: unknown): PartyConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_PARTY
  const r = raw as Record<string, unknown>
  return {
    pace: VALID_PACES.includes(r.pace as TravelPace) ? (r.pace as TravelPace) : DEFAULT_PARTY.pace,
    mount: VALID_MOUNTS.includes(r.mount as Mount) ? (r.mount as Mount) : DEFAULT_PARTY.mount,
    size: VALID_SIZES.includes(r.size as PartySize) ? (r.size as PartySize) : DEFAULT_PARTY.size,
    forcedMarch: r.forcedMarch === true,
  }
}

function partyEquals(a: PartyConfig, b: PartyConfig): boolean {
  return a.pace === b.pace && a.mount === b.mount && a.size === b.size && a.forcedMarch === b.forcedMarch
}

function sanitizeSupply(raw: unknown): SupplyConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_SUPPLY
  const r = raw as Record<string, unknown>
  const clampNum = (n: unknown, fallback: number): number => {
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || n > 99) return fallback
    return n
  }
  return {
    rationsPerPerson: clampNum(r.rationsPerPerson, DEFAULT_SUPPLY.rationsPerPerson),
    waterPerPerson: clampNum(r.waterPerPerson, DEFAULT_SUPPLY.waterPerPerson),
    encumbrance: VALID_ENCUMBRANCE.includes(r.encumbrance as Encumbrance)
      ? (r.encumbrance as Encumbrance)
      : DEFAULT_SUPPLY.encumbrance,
    packAnimals: VALID_PACK_ANIMALS.includes(r.packAnimals as PackAnimals)
      ? (r.packAnimals as PackAnimals)
      : DEFAULT_SUPPLY.packAnimals,
  }
}

function supplyEquals(a: SupplyConfig, b: SupplyConfig): boolean {
  return (
    a.rationsPerPerson === b.rationsPerPerson &&
    a.waterPerPerson === b.waterPerPerson &&
    a.encumbrance === b.encumbrance &&
    a.packAnimals === b.packAnimals
  )
}

/** Default group name for journeys with no explicit party (Tier 2c). */
export const DEFAULT_PARTY_NAME = 'Main party'
const MAX_PARTY_NAME_LEN = 60

/** Trim + length-cap a party name; blank / non-string falls back to the default. */
export function sanitizePartyName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_PARTY_NAME
  const trimmed = raw.trim().slice(0, MAX_PARTY_NAME_LEN)
  return trimmed || DEFAULT_PARTY_NAME
}

const STORAGE_KEY = 'veydria.journeys.v1'
const LEGACY_KEY = 'veydria-journey-history'
const MAX_ENTRIES = 20

export interface SavedJourney {
  id: string
  savedAt: number
  /** User-given name; falls back to auto-generated "A → B" label. */
  name?: string
  fromName: string
  toName: string
  waypoints: string[]
  season?: Season
  mode: RouteMode
  totalKm: number
  estimatedDays: number
  nodeIds: string[]
  edgeCount: number
  bottlenecks: string[]
  seasonalWarnings: string[]
  party?: PartyConfig
  supply?: SupplyConfig
  /** Multi-party tracking (Tier 2c). Backfills to "Main party" on load. */
  partyName?: string
}

function makeDefaultName(from: string, to: string, waypoints: string[]): string {
  if (waypoints.length > 0) return `${from} → ${waypoints.join(' → ')} → ${to}`
  return `${from} → ${to}`
}

function migrateFromLegacy(): SavedJourney[] | null {
  try {
    const raw = kvStore.getString(LEGACY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Array<Partial<SavedJourney> & Record<string, unknown>>
    if (!Array.isArray(parsed)) return null
    const migrated = parsed
      .filter(e => Array.isArray(e.nodeIds) && e.nodeIds.length >= 2)
      .map(e => ({
        id: typeof e.id === 'string' ? e.id : `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        savedAt: typeof e.savedAt === 'number' ? e.savedAt : Date.now(),
        name: typeof e.name === 'string' && e.name.trim()
          ? e.name.trim()
          : makeDefaultName(
              typeof e.fromName === 'string' ? e.fromName : '',
              typeof e.toName === 'string' ? e.toName : '',
              Array.isArray(e.waypoints) ? e.waypoints.filter((w): w is string => typeof w === 'string') : []
            ),
        fromName: typeof e.fromName === 'string' ? e.fromName : '',
        toName: typeof e.toName === 'string' ? e.toName : '',
        waypoints: Array.isArray(e.waypoints)
          ? e.waypoints.filter((w): w is string => typeof w === 'string')
          : [],
        season: ['spring', 'summer', 'autumn', 'winter'].includes(e.season as string)
          ? (e.season as Season)
          : undefined,
        mode: ['direct', 'fastest', 'safest', 'cheapest'].includes(e.mode as string)
          ? (e.mode as RouteMode)
          : 'direct',
        totalKm: typeof e.totalKm === 'number' ? e.totalKm : 0,
        estimatedDays: typeof e.estimatedDays === 'number' ? e.estimatedDays : 0,
        nodeIds: Array.isArray(e.nodeIds)
          ? e.nodeIds.filter((n): n is string => typeof n === 'string')
          : [],
        edgeCount: typeof e.edgeCount === 'number' ? e.edgeCount : 0,
        bottlenecks: Array.isArray(e.bottlenecks)
          ? e.bottlenecks.filter((b): b is string => typeof b === 'string')
          : [],
        seasonalWarnings: Array.isArray(e.seasonalWarnings)
          ? e.seasonalWarnings.filter((s): s is string => typeof s === 'string')
          : [],
        party: sanitizeParty(e.party),
        supply: sanitizeSupply(e.supply),
        partyName: sanitizePartyName(e.partyName),
      }))
    return migrated
  } catch {
    return null
  }
}

export function loadSavedJourneys(): SavedJourney[] {
  try {
    const raw = kvStore.getString(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as SavedJourney[]
      if (!Array.isArray(parsed)) return []
      // Backfill party + supply + partyName for entries written before those fields existed.
      return parsed.map(e => ({
        ...e,
        party: sanitizeParty(e.party),
        supply: sanitizeSupply(e.supply),
        partyName: sanitizePartyName(e.partyName),
      }))
    }
    // No v1 data — attempt one-time migration from legacy key
    const migrated = migrateFromLegacy()
    if (migrated) {
      try { kvStore.setString(STORAGE_KEY, JSON.stringify(migrated)) } catch { /* quota */ }
    }
    return migrated ?? []
  } catch {
    return []
  }
}

export function saveJourneys(entries: SavedJourney[]) {
  try {
    kvStore.setString(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // Storage full or private mode — silently fail
  }
}

export function addSavedJourney(entry: SavedJourney): SavedJourney[] {
  const existing = loadSavedJourneys()
  // Prevent exact duplicates (same nodeIds + season + mode + party + supply +
  // partyName). partyName is part of the key so the same route saved under two
  // different parties stays as two distinct entries (Tier 2c split-party play).
  const entryParty = sanitizeParty(entry.party)
  const entrySupply = sanitizeSupply(entry.supply)
  const entryPartyName = sanitizePartyName(entry.partyName)
  const duplicateIndex = existing.findIndex(
    e =>
      JSON.stringify(e.nodeIds) === JSON.stringify(entry.nodeIds) &&
      e.season === entry.season &&
      e.mode === entry.mode &&
      partyEquals(sanitizeParty(e.party), entryParty) &&
      supplyEquals(sanitizeSupply(e.supply), entrySupply) &&
      sanitizePartyName(e.partyName) === entryPartyName
  )
  if (duplicateIndex >= 0) {
    // Move to front (most recent)
    const updated = [
      existing[duplicateIndex],
      ...existing.slice(0, duplicateIndex),
      ...existing.slice(duplicateIndex + 1),
    ]
    updated[0].savedAt = entry.savedAt
    if (entry.name) updated[0].name = entry.name
    saveJourneys(updated)
    return updated
  }
  const updated = [entry, ...existing].slice(0, MAX_ENTRIES)
  saveJourneys(updated)
  return updated
}

export function deleteSavedJourney(id: string): SavedJourney[] {
  const existing = loadSavedJourneys()
  const updated = existing.filter(e => e.id !== id)
  saveJourneys(updated)
  return updated
}

export function renameSavedJourney(id: string, name: string): SavedJourney[] {
  const existing = loadSavedJourneys()
  const trimmed = name.trim()
  const updated = existing.map(e =>
    e.id === id ? { ...e, name: trimmed || undefined } : e
  )
  saveJourneys(updated)
  return updated
}

export function clearSavedJourneys(): SavedJourney[] {
  saveJourneys([])
  return []
}

/**
 * Clear only the journeys belonging to a given party (Tier 2c), returning the
 * remaining full list. The My-journeys panel is scoped to the active party, so
 * its "Clear all" must not wipe other parties' saved routes. Names are coalesced
 * through sanitizePartyName so legacy / blank entries fold into the default.
 */
export function clearSavedJourneysForParty(partyName: string): SavedJourney[] {
  const target = sanitizePartyName(partyName)
  const remaining = loadSavedJourneys().filter(
    e => sanitizePartyName(e.partyName) !== target,
  )
  saveJourneys(remaining)
  return remaining
}

/**
 * Distinct party names across the given journeys, ordered by the most recent
 * save in each group (newest first), ties broken alphabetically. Names are
 * coalesced through sanitizePartyName so legacy/blank entries fold into
 * "Main party". Used to populate the Active-party dropdown (Tier 2c).
 */
export function listPartyNames(journeys: SavedJourney[]): string[] {
  const newest = new Map<string, number>()
  for (const j of journeys) {
    const name = sanitizePartyName(j.partyName)
    const at = typeof j.savedAt === 'number' ? j.savedAt : 0
    const prev = newest.get(name)
    if (prev === undefined || at > prev) newest.set(name, at)
  }
  return [...newest.keys()].sort((a, b) => {
    const diff = (newest.get(b) ?? 0) - (newest.get(a) ?? 0)
    return diff !== 0 ? diff : a.localeCompare(b)
  })
}

/** Journeys belonging to a given party name (coalesced through the default). */
export function journeysForParty(journeys: SavedJourney[], partyName: string): SavedJourney[] {
  const target = sanitizePartyName(partyName)
  return journeys.filter(j => sanitizePartyName(j.partyName) === target)
}
