import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { loadExternalEncounters } from './utils/external-encounters'
import { loadAsterisms } from './utils/asterisms'
import { isTauri } from './persistence/runtime'
import { kvStore } from './persistence/kv-store'
import { reportSaveFailure } from './persistence/save-status'
import './App.css'

// Arm worldbuilder's encounter canon (ADR-0022). Fire-and-forget: by the time a
// user computes a route the fetch has resolved; a missing file degrades silently
// to the default pools. The Node sim never calls this, so its baseline is intact.
void loadExternalEncounters(import.meta.env.BASE_URL)

// Warm the ocean-marginalia register (ADR-0023). Fire-and-forget: the cache is
// hot by the time App reads it; a missing file degrades to no marginalia.
void loadAsterisms(import.meta.env.BASE_URL)

/**
 * Desktop boot: install the disk-backed store and hydrate it BEFORE first render,
 * so every synchronous `kvStore.getString` at render time sees persisted data. The
 * Tauri-only modules are dynamically imported so they never enter the web bundle.
 * The web build skips all of this and keeps the default synchronous localStorage
 * backend (no hydrate needed).
 */
async function boot(): Promise<void> {
  if (isTauri) {
    try {
      const { createTauriFsProvider } = await import('./persistence/tauri-fs-ops')
      await kvStore.hydrate(await createTauriFsProvider())
    } catch (err) {
      // A corrupt/unreadable store must not white-screen the app. Start on the
      // empty default backend and surface that the load failed.
      reportSaveFailure(
        `Could not load your saved data: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    try {
      const { installCloseFlush } = await import('./persistence/tauri-lifecycle')
      await installCloseFlush()
    } catch {
      // Without the close-flush hook a quit may lose the last debounced write, but
      // the app must still launch; the periodic write covers the common case.
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

void boot()
