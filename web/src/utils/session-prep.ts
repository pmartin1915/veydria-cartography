/**
 * session-prep.ts — Persistent session-prep ordering and done-state for starred features.
 *
 * Prep order is stored under `veydria.prepOrder.v1`.
 * Done-state IDs are stored under `veydria.prepDone.v1`.
 */

const ORDER_KEY = 'veydria.prepOrder.v1'
const DONE_KEY = 'veydria.prepDone.v1'

function readOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      return parsed
    }
  } catch {
    // ignore
  }
  return []
}

function writeOrder(ids: string[]): void {
  localStorage.setItem(ORDER_KEY, JSON.stringify(ids))
}

function readDone(): string[] {
  try {
    const raw = localStorage.getItem(DONE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      return parsed
    }
  } catch {
    // ignore
  }
  return []
}

function writeDone(ids: string[]): void {
  localStorage.setItem(DONE_KEY, JSON.stringify(ids))
}

export function getPrepOrder(): string[] {
  return readOrder()
}

export function setPrepOrder(ids: string[]): void {
  writeOrder(ids)
}

export function movePrepItem(ids: string[], fromIndex: number, toIndex: number): string[] {
  if (fromIndex < 0 || fromIndex >= ids.length) return ids
  if (toIndex < 0 || toIndex >= ids.length) return ids
  const next = [...ids]
  const [removed] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, removed)
  writeOrder(next)
  return next
}

export function getPrepDoneIds(): string[] {
  return readDone()
}

export function togglePrepDone(featureId: string): boolean {
  const ids = readDone()
  const idx = ids.indexOf(featureId)
  if (idx >= 0) {
    ids.splice(idx, 1)
    writeDone(ids)
    return false
  }
  ids.push(featureId)
  writeDone(ids)
  return true
}

export function clearPrepDone(): void {
  localStorage.removeItem(DONE_KEY)
}

/**
 * Keep prep order in sync with the starred list.
 * - Removes any prep-order items that are no longer starred.
 * - Appends newly-starred items to the end.
 */
export function syncPrepOrder(starredIds: string[]): string[] {
  const current = readOrder()
  const filtered = current.filter((id) => starredIds.includes(id))
  const existing = new Set(filtered)
  for (const id of starredIds) {
    if (!existing.has(id)) {
      filtered.push(id)
      existing.add(id)
    }
  }
  writeOrder(filtered)
  return filtered
}

/**
 * Keep done-state in sync with the starred list.
 * - Removes any done items that are no longer starred.
 */
export function syncPrepDone(starredIds: string[]): string[] {
  const current = readDone()
  const filtered = current.filter((id) => starredIds.includes(id))
  writeDone(filtered)
  return filtered
}
