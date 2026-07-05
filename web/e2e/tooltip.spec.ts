import { test, expect, type Page, type Locator } from '@playwright/test'

// Regression guard for the tooltip-overflow fix (PR #20): five floating surfaces in
// App.css were capped at min(Npx, calc(100vw - 24px)) + word-wrap so a long descriptor
// can no longer stretch a tooltip into one infinite line. The smoke suite exercises the
// route/persistence/share flows but asserts nothing about tooltip geometry, so this file
// covers the fix's actual contract on a *rendered* tooltip.
//
// Trigger: route/trade-route polylines bind their tooltips via Leaflet bindTooltip and
// render as SVG <path> with class leaflet-interactive (only terrain_cell uses the canvas
// renderer — MapViewer.tsx). page.hover({ force: true }) on such a path does the SVG
// hit-testing for us and opens the sticky tooltip — far more robust than hand-mapping
// SVG coords to client px through Leaflet's CSS-transformed panes. We iterate paths until
// the wanted tooltip class appears, so the test doesn't depend on path ordering.

// Hover interactive paths one by one until `target` becomes visible; returns true on hit.
async function hoverUntilVisible(page: Page, target: Locator): Promise<boolean> {
  const paths = page.locator('path.leaflet-interactive')
  await paths.first().waitFor()
  const n = await paths.count()
  for (let i = 0; i < n; i++) {
    try {
      await paths.nth(i).hover({ timeout: 1200, force: true })
    } catch {
      continue // path not hoverable (e.g. fully occluded); try the next
    }
    if (await target.isVisible().catch(() => false)) return true
  }
  return false
}

test.beforeEach(async ({ page }) => {
  // Both guided tours' backdrops intercept hovers/clicks; mark them completed
  // before the app boots (addInitScript runs before app code). Mirrors smoke.spec.
  await page.addInitScript(() => {
    const done = JSON.stringify({ completed: true, skipped: true, timestamp: 0 })
    localStorage.setItem('veydria.tour.completed.v1', done)
    localStorage.setItem('veydria.journey.tutorial.completed.v1', done)
    localStorage.setItem('veydria.welcome.seen.v1', done)
    localStorage.setItem('veydria.passage.tutorial.completed.v1', done)
  })
})

// Mirrors smoke.spec's gotoApp: navigate and wait for the map to actually mount
// before interacting, closing the "header clickable before app settles" race.
async function gotoApp(page: Page) {
  await page.goto('/')
  await expect(page.locator('.leaflet-container')).toBeAttached()
}

test('leaflet-tooltip base wraps and is width-capped', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('.leaflet-container')).toBeVisible()

  // Trade-route (and similar) polylines bind .leaflet-tooltip — the shared base that
  // received white-space:normal + max-width + overflow-wrap, and the same base the
  // journey segment tooltip is built on.
  const tip = page.locator('.leaflet-tooltip').first()
  expect(await hoverUntilVisible(page, tip), 'a polyline hover should surface .leaflet-tooltip').toBe(true)

  const geom = await tip.evaluate((el) => {
    const cs = getComputedStyle(el)
    const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : NaN)
    return {
      whiteSpace: cs.whiteSpace,
      overflowWrap: cs.overflowWrap,
      maxWidth: px(cs.maxWidth),
      viewportCap: window.innerWidth - 24,
    }
  })
  // The fix: nowrap → normal, and a width cap of min(280px, calc(100vw - 24px)).
  expect(geom.whiteSpace).toBe('normal')
  expect(geom.overflowWrap).toBe('break-word')
  expect(geom.maxWidth).toBeGreaterThan(0)
  expect(geom.maxWidth).toBeLessThanOrEqual(280)
  expect(geom.maxWidth).toBeLessThanOrEqual(geom.viewportCap)

  // Prove the cap engages: force a long unbroken string and confirm the box stays near
  // the cap rather than blowing past the viewport (an unwrapped 400-char line is ~2800px).
  const rendered = await tip.evaluate((el) => {
    el.textContent = 'x'.repeat(400)
    void (el as HTMLElement).offsetWidth // force layout before measuring
    return { width: el.getBoundingClientRect().width, viewportCap: window.innerWidth - 24 }
  })
  expect(rendered.width).toBeLessThanOrEqual(Math.min(280, rendered.viewportCap) + 24)
})

test('journey segment tooltip wraps and is width-capped', async ({ page }) => {
  await gotoApp(page)

  // Compute a route so the per-segment tooltips exist (mirrors smoke.spec's flow).
  await page.locator('#journey-trigger').waitFor()
  if (!(await page.locator('.journey-planner').isVisible())) {
    await page.locator('#journey-trigger').click()
  }
  // See smoke.spec's openPlanner: the lazy JourneyPlanner's Suspense fallback
  // shares the .journey-planner class (aria-busy="true"), so the readiness wait
  // must exclude it to avoid racing the real panel's controls.
  await expect(page.locator('.journey-planner:not([aria-busy="true"])')).toBeVisible()
  for (const [testid, name] of [
    ['journey-from', 'Ngaru Bon'],
    ['journey-to', 'Kheshkai'],
  ] as const) {
    await page.getByTestId(testid).click()
    const menu = page.locator('.journey-dropdown-menu')
    await menu.getByPlaceholder('Search...').fill(name)
    await menu.locator('.journey-dropdown-item', { hasText: name }).first().click()
  }
  await expect(page.locator('.journey-route')).toBeVisible()

  const tip = page.locator('.journey-seg-tooltip')
  expect(await hoverUntilVisible(page, tip), 'a route segment hover should surface .journey-seg-tooltip').toBe(true)

  const geom = await tip.evaluate((el) => {
    const inner = getComputedStyle(el)
    // white-space:normal lives on the .leaflet-tooltip ancestor; assert there so a
    // nowrap regression is caught regardless of inheritance.
    const popup = el.closest('.leaflet-tooltip') as HTMLElement | null
    const base = popup ? getComputedStyle(popup) : inner
    const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : NaN)
    return {
      baseWhiteSpace: base.whiteSpace,
      innerMaxWidth: px(inner.maxWidth),
      baseMaxWidth: px(base.maxWidth),
      viewportCap: window.innerWidth - 24,
    }
  })
  expect(geom.baseWhiteSpace).toBe('normal')
  // .journey-seg-tooltip caps at min(300px, calc(100vw - 24px))…
  expect(geom.innerMaxWidth).toBeGreaterThan(0)
  expect(geom.innerMaxWidth).toBeLessThanOrEqual(300)
  expect(geom.innerMaxWidth).toBeLessThanOrEqual(geom.viewportCap)
  // …on the .leaflet-tooltip base capped at min(280px, calc(100vw - 24px)).
  expect(geom.baseMaxWidth).toBeGreaterThan(0)
  expect(geom.baseMaxWidth).toBeLessThanOrEqual(280)
  expect(geom.baseMaxWidth).toBeLessThanOrEqual(geom.viewportCap)

  // Prove the cap engages on the real element (container border-box ≈ cap + padding).
  const rendered = await tip.evaluate((el) => {
    const name = el.querySelector('.journey-seg-name')
    if (name) name.textContent = 'x'.repeat(400)
    else el.textContent = 'x'.repeat(400)
    const popup = (el.closest('.leaflet-tooltip') as HTMLElement) ?? (el as HTMLElement)
    void popup.offsetWidth
    return { width: popup.getBoundingClientRect().width, viewportCap: window.innerWidth - 24 }
  })
  expect(rendered.width).toBeLessThanOrEqual(Math.min(300, rendered.viewportCap) + 24)
})
