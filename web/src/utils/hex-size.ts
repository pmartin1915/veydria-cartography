/**
 * hex-size.ts — Shared helper for the persistent hex overlay size preference.
 *
 * Canonical key: veydria.hexSize
 */

import { kvStore } from '../persistence/kv-store'

const STORAGE_KEY = 'veydria.hexSize'
const VALID_SIZES = [30, 50, 70]

export function loadHexSize(): number {
  const stored = kvStore.getString(STORAGE_KEY)
  if (!stored) return 50
  const n = Number.parseInt(stored, 10)
  return VALID_SIZES.includes(n) ? n : 50
}

export function saveHexSize(n: number): void {
  kvStore.setString(STORAGE_KEY, String(n))
}
