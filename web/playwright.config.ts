import { defineConfig, devices } from '@playwright/test'

// Smoke-only e2e config. Chromium, single worker, against the Vite dev server
// (base '/', port 5173 per vite.config.ts) — smoke tests target behaviour, not
// the production bundle (base-path/asset issues are caught by the deploy workflow).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  // Local runs default to ~half of logical cores (6 on a 12-core box); that many
  // cold Vite transforms + 3.65MB geojson parses running at once thrash the CPU
  // past the per-test timeout. Capping below that point removes the contention
  // that was the dominant source of local flake (see ai/IDEAS.md, 2026-07-05).
  workers: process.env.CI ? 1 : 3,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // .leaflet-container only appears after the geojson fetch + JSON.parse (~3.65MB)
  // resolves, which can be tight against the 5s default on a cold/contended worker.
  expect: { timeout: 10_000 },
  use: {
    // Dedicated port (not Vite's default 5173) so the suite can't latch onto a
    // foreign dev server that happens to be running. strictPort + no reuse below
    // guarantee we always test THIS app.
    baseURL: 'http://localhost:5180',
    trace: 'on-first-retry',
    // clipboard-read/write for the share-link smoke test (flow 5).
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 5180 --strictPort',
    url: 'http://localhost:5180',
    reuseExistingServer: false,
    timeout: 120_000,
    // BROWSER=none stops Vite (server.open: true) from spawning a real browser.
    env: { BROWSER: 'none' },
  },
})
