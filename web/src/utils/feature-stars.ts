/**
 * feature-stars.ts — Persistent starred/bookmarked features for GM session prep.
 *
 * Starred feature IDs are stored under `veydria.stars.v1` via the persistence
 * facade (kvStore), which routes to localStorage on web and to on-disk files in
 * the desktop build. The array is kept small (max 50) to prevent unbounded growth.
 */

import { kvStore } from '../persistence/kv-store'

const STORAGE_KEY = 'veydria.stars.v1'
const MAX_STARS = 50

function readStars(): string[] {
  try {
    const raw = kvStore.getString(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      return parsed
    }
  } catch {
    // ignore parse errors
  }
  return []
}

function writeStars(ids: string[]): void {
  kvStore.setString(STORAGE_KEY, JSON.stringify(ids))
}

export function getStarredIds(): string[] {
  return readStars()
}

export function isStarred(featureId: string): boolean {
  return readStars().includes(featureId)
}

export function toggleStarred(featureId: string): boolean {
  const ids = readStars()
  const idx = ids.indexOf(featureId)
  if (idx >= 0) {
    ids.splice(idx, 1)
    writeStars(ids)
    return false
  }
  // Add to front (most recent first)
  ids.unshift(featureId)
  if (ids.length > MAX_STARS) {
    ids.length = MAX_STARS
  }
  writeStars(ids)
  return true
}

export function removeStarred(featureId: string): void {
  const ids = readStars()
  const idx = ids.indexOf(featureId)
  if (idx >= 0) {
    ids.splice(idx, 1)
    writeStars(ids)
  }
}

export function clearStarred(): void {
  kvStore.remove(STORAGE_KEY)
}

export interface StarredFeature {
  id: string
  feature: GeoJSONFeature
}

interface GeoJSONFeature {
  type: 'Feature'
  geometry: {
    type: string
    coordinates: number[] | number[][] | number[][][]
  }
  properties: Record<string, unknown>
}

export function resolveStarredFeatures(
  ids: string[],
  features: GeoJSONFeature[]
): StarredFeature[] {
  const map = new Map<string, GeoJSONFeature>()
  for (const f of features) {
    const fid = (f as unknown as Record<string, unknown>).id as string || (f.properties.id as string)
    if (fid) map.set(fid, f)
  }
  const out: StarredFeature[] = []
  for (const id of ids) {
    const f = map.get(id)
    if (f) out.push({ id, feature: f })
  }
  return out
}
