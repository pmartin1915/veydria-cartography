import { defineConfig, devices } from '@playwright/test'

// Smoke-only e2e config. Chromium, single worker, against the Vite dev server
// (base '/', port 5173 per vite.config.ts) — smoke tests target behaviour, not
// the production bundle (base-path/asset issues are caught by the deploy workflow).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
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
