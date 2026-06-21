/**
 * save-status.ts — A tiny store for "did the last persist succeed?".
 *
 * Desktop disk writes are debounced and fire-and-forget through the sync `kvStore`
 * facade, so a failure (permissions, disk full, USB ejected) has no return value to
 * surface. And toasts do not render under WebView2 — so a failure MUST land in a
 * persistent DOM element. The `TauriFsProvider` reports failures/recoveries here;
 * `SaveStatusIndicator` subscribes via `useSyncExternalStore`. Campaign Save errors
 * (a user-initiated write that failed) route here too.
 *
 * Plain module state, no React/Tauri imports, so the web build and unit tests use it
 * for free.
 */

export interface SaveStatus {
  failed: boolean
  message?: string
}

let status: SaveStatus = { failed: false }
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** Snapshot for `useSyncExternalStore` — stable reference while unchanged. */
export function getSaveStatus(): SaveStatus {
  return status
}

export function subscribeSaveStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function reportSaveFailure(message: string): void {
  status = { failed: true, message }
  emit()
}

export function clearSaveFailure(): void {
  if (!status.failed) return
  status = { failed: false }
  emit()
}

/** Test-only: reset module state between cases. */
export function resetSaveStatus(): void {
  status = { failed: false }
  listeners.clear()
}
