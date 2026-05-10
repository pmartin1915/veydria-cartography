/**
 * search-recent.ts — Recent search selections persistence
 *
 * Tracks the last N features selected via the Cmd-K search palette.
 * Stored under `veydria.search.recent.v1`.
 */

const STORAGE_KEY = 'veydria.search.recent.v1'
const MAX_ITEMS = 5

export interface RecentItem {
  id: string
  name: string
  category: string
  timestamp: number
}

function isValidRecentItem(item: unknown): item is RecentItem {
  if (!item || typeof item !== 'object') return false
  const o = item as Record<string, unknown>
  return (
    typeof o.id === 'string' && o.id.length > 0 &&
    typeof o.name === 'string' && o.name.length > 0 &&
    typeof o.category === 'string' &&
    typeof o.timestamp === 'number' && Number.isFinite(o.timestamp) && !Number.isNaN(o.timestamp)
  )
}

export function loadRecentItems(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidRecentItem)
  } catch {
    return []
  }
}

function saveItems(items: RecentItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // Storage may be full or unavailable — silently fail
  }
}

/**
 * Record a feature selection. Moves existing entry to front if already present;
 * evicts oldest beyond MAX_ITEMS.
 */
export function pushRecentItem(id: string, name: string, category: string): void {
  const existing = loadRecentItems()
  const next = existing.filter((item) => item.id !== id)
  next.unshift({ id, name, category, timestamp: Date.now() })
  if (next.length > MAX_ITEMS) {
    next.length = MAX_ITEMS
  }
  saveItems(next)
}

export function clearRecentItems(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
