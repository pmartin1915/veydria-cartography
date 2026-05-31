import { test, expect, type Page } from '@playwright/test'

// Smoke suite — exercises the load-bearing user flows end-to-end so a broken map,
// broken routing, or broken persistence is caught before deploy. Not exhaustive;
// each test should stay under ~5s. Selectors prefer data-testid / stable classes
// already in the app (see JourneyPlanner / PartyConfig).

// Two civs that reliably route to each other across the continent (per the sim
// harness: ngaru_bon↔kheshkai completes), giving a multi-day route where the
// mounted speed bonus is visible after rounding.
const FROM = 'Ngaru Bon'
const TO = 'Kheshkai'

// Console output that isn't a regression. Anything NOT matched here still fails the
// load test, so new errors are caught.
const BENIGN_CONSOLE = [
  /favicon/i,
  /ResizeObserver/i,
  /Download the React DevTools/i,
]
const isBenign = (text: string) => BENIGN_CONSOLE.some((re) => re.test(text))

// Skip the first-run guided tour — its backdrop overlay intercepts clicks.
// addInitScript runs before app code on every navigation (incl. reload / share-link goto).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'veydria.tour.completed.v1',
      JSON.stringify({ completed: true, skipped: true, timestamp: 0 }),
    )
  })
})

function parseDays(text: string | null): number {
  const m = (text ?? '').match(/[\d.]+/)
  return m ? Number(m[0]) : NaN
}

async function openPlanner(page: Page) {
  // Idempotent: the planner auto-opens when a route is present in the URL hash
  // (e.g. after reload / on a share link), so only click to open when it's closed —
  // clicking #journey-trigger always toggles.
  await page.locator('#journey-trigger').waitFor()
  if (!(await page.locator('.journey-planner').isVisible())) {
    await page.locator('#journey-trigger').click()
  }
  await expect(page.locator('.journey-planner')).toBeVisible()
}

async function pickNode(page: Page, testid: 'journey-from' | 'journey-to', name: string) {
  await page.getByTestId(testid).click()
  const menu = page.locator('.journey-dropdown-menu')
  await menu.getByPlaceholder('Search...').fill(name)
  await menu.locator('.journey-dropdown-item', { hasText: name }).first().click()
}

async function computeRoute(page: Page) {
  await openPlanner(page)
  await pickNode(page, 'journey-from', FROM)
  await pickNode(page, 'journey-to', TO)
  await expect(page.locator('.journey-route')).toBeVisible()
}

test('map loads with no console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isBenign(msg.text())) errors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    if (!isBenign(err.message)) errors.push(err.message)
  })

  await page.goto('/')
  await expect(page.locator('.leaflet-container')).toBeVisible()
  // The SVG overlay pane is mounted by Leaflet once the map initialises.
  await expect(page.locator('.leaflet-container svg').first()).toBeAttached()

  expect(errors, `unexpected console errors:\n${errors.join('\n')}`).toEqual([])
})

test('picking two civs computes a route with day-by-day breakdown', async ({ page }) => {
  await page.goto('/')
  await computeRoute(page)

  // Stats render with a positive day estimate.
  expect(parseDays(await page.getByTestId('est-days').textContent())).toBeGreaterThan(0)

  // Days tab shows at least one day row.
  await page.getByRole('button', { name: 'Days', exact: true }).click()
  await expect(page.locator('.journey-day').first()).toBeVisible()
  expect(await page.locator('.journey-day').count()).toBeGreaterThan(0)
})

test('mounting the party reduces estimated travel days', async ({ page }) => {
  await page.goto('/')
  await computeRoute(page)

  const estDays = page.getByTestId('est-days')
  const daysFoot = parseDays(await estDays.textContent())
  expect(daysFoot).toBeGreaterThan(0)

  await page.locator('.journey-party-toggle').click()
  await page.getByTestId('mount-mounted').click()

  // Route recomputes on party change; poll until the estimate drops.
  await expect.poll(async () => parseDays(await estDays.textContent())).toBeLessThan(daysFoot)
})

test('saving a journey persists across reload', async ({ page }) => {
  await page.goto('/')
  await computeRoute(page)

  await page.getByRole('button', { name: 'Save', exact: true }).click()

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('veydria.journeys.v1') ?? '[]'))
  expect(Array.isArray(saved)).toBe(true)
  expect(saved.length).toBeGreaterThan(0)

  await page.reload()
  await openPlanner(page)
  // History toggle badge reflects the persisted count; open the panel to confirm.
  await page.locator('.journey-history-toggle').click()
  await expect(page.locator('.journey-history-item').first()).toBeVisible()
})

test('share link round-trips and auto-computes the route', async ({ page }) => {
  await page.goto('/')
  await computeRoute(page)

  await page.getByRole('button', { name: 'Link', exact: true }).click()
  const shareUrl = await page.evaluate(() => navigator.clipboard.readText())
  expect(shareUrl).toContain('journeyFrom')
  expect(shareUrl).toContain('journeyTo')

  await page.goto(shareUrl)
  // Deep-link auto-compute renders the route without further interaction.
  await expect(page.locator('.journey-route')).toBeVisible()
  expect(parseDays(await page.getByTestId('est-days').textContent())).toBeGreaterThan(0)
})

test('Player MD copies a player-safe route handout', async ({ page }) => {
  await page.goto('/')
  await computeRoute(page)

  await page.getByRole('button', { name: 'Player MD', exact: true }).click()
  const md = await page.evaluate(() => navigator.clipboard.readText())
  // Player handout keeps the route facts...
  expect(md).toContain('## Journey:')
  expect(md).toContain('### Route')
  // ...but never GM-only sections.
  expect(md).not.toContain('### Encounters')
  expect(md).not.toContain('### GM Notes')
})

test('Share popover opens and copies a player link', async ({ page }) => {
  await page.goto('/')
  await page.locator('#player-share-trigger').click()

  const popover = page.getByRole('dialog', { name: 'Share with players' })
  await expect(popover).toBeVisible()

  await popover.getByRole('button', { name: 'Copy player link' }).click()
  const url = await page.evaluate(() => navigator.clipboard.readText())
  expect(url).toContain('share=1')
  // The popover closes once the link is copied.
  await expect(popover).not.toBeVisible()
})
