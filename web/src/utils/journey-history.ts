/**
 * journey-history.ts — LocalStorage persistence for computed journey routes
 */

import type { Season, RouteMode } from './journey-graph'

const STORAGE_KEY = 'veydria-journey-history'
const MAX_ENTRIES = 20

export interface HistoryEntry {
  id: string
  savedAt: number
  fromName: string
  toName: string
  waypoints: string[] // waypoint names
  season?: Season
  mode: RouteMode
  totalKm: number
  estimatedDays: number
  nodeIds: string[] // [start, ...waypoints, end]
  edgeCount: number
  bottlenecks: string[]
  seasonalWarnings: string[]
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as HistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // Storage full or private mode — silently fail
  }
}

export function addHistoryEntry(entry: HistoryEntry): HistoryEntry[] {
  const existing = loadHistory()
  // Prevent exact duplicates (same nodeIds + season + mode)
  const duplicateIndex = existing.findIndex(
    e =>
      JSON.stringify(e.nodeIds) === JSON.stringify(entry.nodeIds) &&
      e.season === entry.season &&
      e.mode === entry.mode
  )
  if (duplicateIndex >= 0) {
    // Move to front (most recent)
    const updated = [existing[duplicateIndex], ...existing.slice(0, duplicateIndex), ...existing.slice(duplicateIndex + 1)]
    updated[0].savedAt = entry.savedAt
    saveHistory(updated)
    return updated
  }
  const updated = [entry, ...existing].slice(0, MAX_ENTRIES)
  saveHistory(updated)
  return updated
}

export function deleteHistoryEntry(id: string): HistoryEntry[] {
  const existing = loadHistory()
  const updated = existing.filter(e => e.id !== id)
  saveHistory(updated)
  return updated
}

export function clearHistory(): HistoryEntry[] {
  saveHistory([])
  return []
}
