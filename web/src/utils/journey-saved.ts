/**
 * journey-saved.ts — LocalStorage persistence for saved journeys
 *
 * Canonical key: veydria.journeys.v1
 * Migrates defensively from legacy veydria-journey-history on first read.
 */

import type { Season, RouteMode } from './journey-graph'

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
}

function makeDefaultName(from: string, to: string, waypoints: string[]): string {
  if (waypoints.length > 0) return `${from} → ${waypoints.join(' → ')} → ${to}`
  return `${from} → ${to}`
}

function migrateFromLegacy(): SavedJourney[] | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
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
      }))
    return migrated
  } catch {
    return null
  }
}

export function loadSavedJourneys(): SavedJourney[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as SavedJourney[]
      return Array.isArray(parsed) ? parsed : []
    }
    // No v1 data — attempt one-time migration from legacy key
    const migrated = migrateFromLegacy()
    if (migrated) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)) } catch { /* quota */ }
    }
    return migrated ?? []
  } catch {
    return []
  }
}

export function saveJourneys(entries: SavedJourney[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // Storage full or private mode — silently fail
  }
}

export function addSavedJourney(entry: SavedJourney): SavedJourney[] {
  const existing = loadSavedJourneys()
  // Prevent exact duplicates (same nodeIds + season + mode)
  const duplicateIndex = existing.findIndex(
    e =>
      JSON.stringify(e.nodeIds) === JSON.stringify(entry.nodeIds) &&
      e.season === entry.season &&
      e.mode === entry.mode
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
