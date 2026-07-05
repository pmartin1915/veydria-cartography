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

// Skip BOTH guided tours — their backdrop overlays intercept clicks. The
// journey tutorial auto-launches once the map tour is complete (which we mark
// below), so it must be marked complete too or it fires when the planner opens.
// addInitScript runs before app code on every navigation (incl. reload / share-link goto).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const done = JSON.stringify({ completed: true, skipped: true, timestamp: 0 })
    localStorage.setItem('veydria.tour.completed.v1', done)
    localStorage.setItem('veydria.journey.tutorial.completed.v1', done)
    localStorage.setItem('veydria.welcome.seen.v1', done)
    localStorage.setItem('veydria.passage.tutorial.completed.v1', done)
  })
})

function parseDays(text: string | null): number {
  const m = (text ?? '').match(/[\d.]+/)
  return m ? Number(m[0]) : NaN
}

// Navigates and waits for the map to actually mount. JourneyPlanner (and every
// other downstream panel) only renders once the geojson fetch resolves — the
// same gate that stamps .leaflet-container — so this gives every test one
// explicit "past the loading screen" sync point before it starts interacting,
// closing the race where a header button is clickable before the app has
// settled (see ai/IDEAS.md, 2026-07-05).
async function gotoApp(page: Page, path = '/') {
  await page.goto(path)
  await expect(page.locator('.leaflet-container')).toBeAttached()
}

async function openPlanner(page: Page) {
  // Idempotent: the planner auto-opens when a route is present in the URL hash
  // (e.g. after reload / on a share link), so only click to open when it's closed —
  // clicking #journey-trigger always toggles.
  await page.locator('#journey-trigger').waitFor()
  if (!(await page.locator('.journey-planner').isVisible())) {
    await page.locator('#journey-trigger').click()
  }
  // JourneyPlanner is lazy-loaded; its Suspense fallback deliberately shares the
  // .journey-planner class (App.tsx) so "open" is detectable before the chunk
  // resolves, but that means a bare .journey-planner wait can pass on the
  // fallback while the real data-testid controls haven't mounted yet. The
  // fallback carries aria-busy="true"; the real panel doesn't.
  await expect(page.locator('.journey-planner:not([aria-busy="true"])')).toBeVisible()
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

// Active-party switcher (Tier 2c). createParty enters create mode and commits via
// Enter (commitCreate switches the active party and closes the dropdown);
// switchParty re-opens and clicks an existing party by name.
async function createParty(page: Page, name: string) {
  const select = page.locator('.journey-party-select')
  await select.locator('.journey-dropdown-trigger').click()
  await select.locator('.journey-party-add').click()
  await select.locator('.journey-dropdown-search').fill(name)
  await select.locator('.journey-dropdown-search').press('Enter')
}

async function switchParty(page: Page, name: string) {
  const select = page.locator('.journey-party-select')
  await select.locator('.journey-dropdown-trigger').click()
  await select.locator('.journey-dropdown-item', { hasText: name }).click()
}

const partyTrigger = (page: Page) =>
  page.locator('.journey-party-select .journey-dropdown-trigger')

test('map loads with no console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isBenign(msg.text())) errors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    if (!isBenign(err.message)) errors.push(err.message)
  })

  await gotoApp(page)
  await expect(page.locator('.leaflet-container')).toBeVisible()
  // The SVG overlay pane is mounted by Leaflet once the map initialises.
  await expect(page.locator('.leaflet-container svg').first()).toBeAttached()

  expect(errors, `unexpected console errors:\n${errors.join('\n')}`).toEqual([])
})

test('picking two civs computes a route with day-by-day breakdown', async ({ page }) => {
  await gotoApp(page)
  await computeRoute(page)

  // Stats render with a positive day estimate.
  expect(parseDays(await page.getByTestId('est-days').textContent())).toBeGreaterThan(0)

  // Days tab shows at least one day row.
  await page.getByRole('button', { name: 'Days', exact: true }).click()
  await expect(page.locator('.journey-day').first()).toBeVisible()
  expect(await page.locator('.journey-day').count()).toBeGreaterThan(0)
})

test('journey tutorial walks the planner and drives its state', async ({ page }) => {
  await gotoApp(page)
  // Compute a real route first so the tab steps have populated content
  // regardless of the welcome step's demo-route seed (which no-ops when a
  // route already exists). Auto-launch is suppressed by the completed flag in
  // beforeEach, so we launch deliberately via the header "?" button.
  await computeRoute(page)
  await page.locator('.journey-tutorial-btn').click()

  const title = page.locator('.tour-card .tour-card-title')
  await expect(title).toHaveText('Plan a journey')

  // Advance with the arrow key (the overlay binds keydown on window → NEXT).
  // Robust against the fixed card repositioning as onEnter callbacks open the
  // drawer / switch tabs — clicking a moving, possibly off-screen card is racy.
  const next = () => page.keyboard.press('ArrowRight')

  // Steps: welcome(0) from(1) to(2) modes(3) find(4) options(5) days(6) encounters(7) export(8) set-out(9).
  for (let i = 0; i < 5; i++) await next()
  await expect(title).toHaveText('Party & supply = the fuel')
  await expect(page.locator('.journey-options-body')).toBeVisible() // onEnter opened the drawer

  await next()
  await expect(title).toHaveText('The day-by-day march')
  await expect(page.getByRole('button', { name: 'Days', exact: true })).toHaveClass(/active/) // onEnter switched tab

  await next()
  await expect(title).toHaveText('Encounters cost supply')
  await expect(page.getByRole('button', { name: 'Encounters', exact: true })).toHaveClass(/active/)

  await next()
  await expect(title).toHaveText('Save it or share it')

  await next()
  await expect(title).toHaveText('Then live it')

  // NEXT past the last step dismisses the tour.
  await next()
  await expect(page.locator('.tour-overlay')).toHaveCount(0)
})

test('mounting the party reduces estimated travel days', async ({ page }) => {
  await gotoApp(page)
  await openPlanner(page)
  // Pin to Direct mode before routing. The default is now Fastest, but the
  // canon-duration modes (Fastest/Safest/Cheapest) use authored fixed day-counts
  // on the Ngaru Bon↔Kheshkai leg, which a mount cannot shorten. Direct routes by
  // drawn distance, where the mounted speed bonus is visible after rounding.
  await page.locator('.journey-modes-row .journey-mode-btn', { hasText: 'Direct' }).click()
  await pickNode(page, 'journey-from', FROM)
  await pickNode(page, 'journey-to', TO)
  await expect(page.locator('.journey-route')).toBeVisible()

  const estDays = page.getByTestId('est-days')
  const daysFoot = parseDays(await estDays.textContent())
  expect(daysFoot).toBeGreaterThan(0)

  // Party config now lives inside the collapsed "Party, supply & options"
  // drawer; open it first. Its inner toggle defaults open, so the mount
  // buttons are visible immediately once the drawer is expanded.
  await page.getByRole('button', { name: 'Party, supply & options' }).click()
  await page.getByTestId('mount-mounted').click()

  // Route recomputes on party change; poll until the estimate drops.
  await expect.poll(async () => parseDays(await estDays.textContent())).toBeLessThan(daysFoot)
})

test('config drawer is collapsed on load and opens on click', async ({ page }) => {
  await gotoApp(page)
  await openPlanner(page)

  // The bulky config (party/supply/options) is folded away by default, so the
  // primary route inputs and tabs surface first. Party controls aren't rendered
  // until the drawer is opened.
  await expect(page.getByTestId('mount-foot')).toBeHidden()

  await page.getByRole('button', { name: 'Party, supply & options' }).click()
  await expect(page.getByTestId('mount-foot')).toBeVisible()
})

test('saving a journey persists across reload', async ({ page }) => {
  await gotoApp(page)
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
  await gotoApp(page)
  await computeRoute(page)

  await page.getByRole('button', { name: 'Link', exact: true }).click()
  const shareUrl = await page.evaluate(() => navigator.clipboard.readText())
  expect(shareUrl).toContain('journeyFrom')
  expect(shareUrl).toContain('journeyTo')

  await gotoApp(page, shareUrl)
  // Deep-link auto-compute renders the route without further interaction.
  await expect(page.locator('.journey-route')).toBeVisible()
  expect(parseDays(await page.getByTestId('est-days').textContent())).toBeGreaterThan(0)
})

test('Player MD copies a player-safe route handout', async ({ page }) => {
  await gotoApp(page)
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
  await gotoApp(page)
  await page.locator('#player-share-trigger').click()

  const popover = page.getByRole('dialog', { name: 'Share with players' })
  await expect(popover).toBeVisible()

  await popover.getByRole('button', { name: 'Copy player link' }).click()
  const url = await page.evaluate(() => navigator.clipboard.readText())
  expect(url).toContain('share=1')
  // The popover closes once the link is copied.
  await expect(popover).not.toBeVisible()
})

test('creating a party scopes the My journeys list to the active party', async ({ page }) => {
  await gotoApp(page)
  await computeRoute(page)

  // Save tags the journey with the active party — "Main party" by default.
  await page.getByRole('button', { name: 'Save', exact: true }).click()

  // Open the history panel; the saved journey shows under Main party.
  await page.locator('.journey-history-toggle').click()
  await expect(page.locator('.journey-history-item')).toHaveCount(1)

  // Spin up a second party — commitCreate switches the active party to it.
  await createParty(page, 'Scouts')
  await expect(partyTrigger(page)).toHaveText(/Scouts/)

  // The panel stays open (savedOpen persists); the list is now scoped to Scouts,
  // which has no saved journeys yet.
  await expect(page.locator('.journey-history-empty')).toBeVisible()
  await expect(page.locator('.journey-history-item')).toHaveCount(0)

  // Switching back to Main party brings its saved journey back into view.
  await switchParty(page, 'Main party')
  await expect(page.locator('.journey-history-item')).toHaveCount(1)
})

test('switching party tags the share link with party=', async ({ page }) => {
  await gotoApp(page)
  await computeRoute(page)

  // The default "Main party" is omitted from the hash to keep URLs short.
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  const defaultUrl = await page.evaluate(() => navigator.clipboard.readText())
  expect(defaultUrl).not.toContain('party=')

  // A non-default active party is serialised into the share link. The computed
  // route persists across the switch (Scouts has no saved journey to load), so
  // the Link button still has a route to copy.
  await createParty(page, 'Scouts')
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  const scoutsUrl = await page.evaluate(() => navigator.clipboard.readText())
  expect(scoutsUrl).toContain('party=Scouts')
})

test('map key renders, documents active layers, and collapses', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('.leaflet-container')).toBeVisible()

  // The key auto-shows because default layers (port/landmark/civilization/terrain)
  // are on, and is open by default at desktop width.
  const key = page.getByTestId('map-key')
  await expect(key).toBeVisible()
  await expect(page.getByTestId('map-key-body')).toBeVisible()

  // Sections reflect what's drawn: point features + civ + elevation are on by default.
  await expect(key.getByText('Port')).toBeVisible()
  await expect(key.getByText('Civilizations')).toBeVisible()
  await expect(key.getByText('Elevation')).toBeVisible()

  // Toggle collapses the body, leaving just the pill; toggling again restores it.
  await page.getByTestId('map-key-toggle').click()
  await expect(page.getByTestId('map-key-body')).toHaveCount(0)
  await page.getByTestId('map-key-toggle').click()
  await expect(page.getByTestId('map-key-body')).toBeVisible()
})

test('ocean marginalia shows the corner cartouche + key row, and toggles off', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('.leaflet-container')).toBeVisible()

  // Marginalia is ON by default: the always-visible corner cartouche shows, the
  // margin star-figures + ocean-fauna engravings attach to the overlay pane, and
  // the key documents them.
  await expect(page.getByTestId('marginalia-cartouche')).toBeVisible()
  await expect(page.locator('.marginalia-group')).toBeAttached()
  // Fauna engravings (layer B) sit in their home waters — the basin ones read at
  // the default frame, so at least one is attached without zooming.
  await expect(page.locator('.marginalia-fauna').first()).toBeAttached()
  // The fauna silhouettes sit in an inner wrapper that carries the swim drift
  // (stilled under reduced-motion); the outer group keeps the positioning translate.
  await expect(page.locator('.marginalia-fauna-body').first()).toBeAttached()
  // The lesser star-dots carry the faint twinkle class (stilled under reduced-motion).
  await expect(page.locator('.marginalia-twinkle').first()).toBeAttached()
  await expect(page.getByTestId('map-key').getByText('Marginalia')).toBeVisible()
  await expect(page.getByTestId('map-key').getByText('Ocean-fauna engravings')).toBeVisible()

  // Toggling the layer off removes the corner cartouche + key section and hides the
  // overlay group (display:none) — the fauna stay in the DOM but go invisible.
  await page.getByTitle('Toggle Marginalia').click()
  await expect(page.getByTestId('marginalia-cartouche')).toHaveCount(0)
  await expect(page.locator('.marginalia-fauna').first()).not.toBeVisible()
  await expect(page.getByTestId('map-key').getByText('Marginalia')).toHaveCount(0)
})

test('the travel vignette crowns a computed route and names a region + travel mode', async ({ page }) => {
  await gotoApp(page)
  await expect(page.locator('.leaflet-container')).toBeVisible()
  await computeRoute(page)

  // The vignette mounts at the top of the route panel once a route exists, with a
  // foreground mode from the attested 6-mode enum and a non-empty region/mode caption.
  const vig = page.getByTestId('travel-vignette')
  await expect(vig).toBeVisible()
  await expect(vig).toHaveAttribute('data-mode', /^(horse|camel|llama|porter|river-boat|sea-ship)$/)
  await expect(page.getByTestId('travel-vignette-region')).not.toBeEmpty()
  await expect(page.getByTestId('travel-vignette-mode')).not.toBeEmpty()
})


test('Passage mode walks a route to an ending and returns to Atlas', async ({ page }) => {
  await gotoApp(page)
  await computeRoute(page)

  await page.getByTestId('set-out-btn').click()

  // The ledger and action bar mount immediately.
  await expect(page.locator('.passage-ledger')).toBeVisible()
  await expect(page.locator('.passage-action-bar')).toBeVisible()

  // The map dims and a position marker appears.
  await expect(page.locator('.app-main.passage-mode')).toBeAttached()
  await expect(page.locator('.passage-position-marker')).toHaveCount(1)
  // Regression: the pulse must scale about the marker's own centre. The marker is
  // an SVG <path>; the default transform-box (view-box) scaled about the SVG origin
  // and translated the marker across the map during the pulse. fill-box pins it.
  await expect(page.locator('.passage-position-marker')).toHaveCSS('transform-box', 'fill-box')

  // Walk: Continue, resolving the first choice whenever cards appear.
  let ended = false
  for (let i = 0; i < 40; i++) {
    const choiceCards = page.locator('.passage-choice-card')
    if (await choiceCards.count() > 0) {
      await choiceCards.first().click()
    }

    const endingPanel = page.locator('.passage-ending-panel')
    if (await endingPanel.isVisible().catch(() => false)) {
      ended = true
      break
    }

    const continueBtn = page.locator('.passage-action-bar .passage-btn--primary')
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click()
    } else {
      // If neither choices nor continue nor ending are visible, something is wrong.
      break
    }
  }

  expect(ended, 'Passage mode should reach an ending within the bounded walk').toBe(true)
  await expect(page.locator('.passage-ending-panel')).toBeVisible()
  await expect(page.locator('.passage-ending-panel .passage-btn--primary')).toBeVisible()

  // Exit returns to the planner and removes the map marker.
  await page.locator('.passage-ending-panel .passage-btn--primary').click()
  await expect(page.locator('.journey-route')).toBeVisible()
  await expect(page.locator('.app-main.passage-mode')).toHaveCount(0)
  await expect(page.locator('.passage-position-marker')).toHaveCount(0)
})

test('Passage mode reroutes to a new destination mid-journey and still reaches an ending', async ({ page }) => {
  await gotoApp(page)
  await computeRoute(page)

  await page.getByTestId('set-out-btn').click()
  await expect(page.locator('.passage-action-bar')).toBeVisible()

  // Advance one day so the party is underway (resolve a choice if one appears).
  const firstChoice = page.locator('.passage-choice-card')
  if (await firstChoice.count() > 0) await firstChoice.first().click()
  const continueBtn = page.locator('.passage-action-bar .passage-btn--primary')
  if (await continueBtn.isVisible().catch(() => false)) await continueBtn.click()
  await expect(page.locator('.passage-position-marker')).toHaveCount(1)

  // Open the reroute picker and choose a new destination.
  await page.getByTestId('passage-reroute-btn').click()
  await expect(page.getByTestId('passage-reroute-picker')).toBeVisible()
  await page.locator('.passage-reroute-list .journey-dropdown-item').first().click()

  // The picker closes, a reroute journal entry is recorded, and the marker remains.
  await expect(page.getByTestId('passage-reroute-picker')).toHaveCount(0)
  await expect(page.locator('.passage-reroute').first()).toBeVisible()
  await expect(page.locator('.passage-position-marker')).toHaveCount(1)

  // The rerouted passage still walks to an ending.
  let ended = false
  for (let i = 0; i < 40; i++) {
    const choiceCards = page.locator('.passage-choice-card')
    if (await choiceCards.count() > 0) await choiceCards.first().click()
    if (await page.locator('.passage-ending-panel').isVisible().catch(() => false)) {
      ended = true
      break
    }
    const cont = page.locator('.passage-action-bar .passage-btn--primary')
    if (await cont.isVisible().catch(() => false)) await cont.click()
    else break
  }
  expect(ended, 'Rerouted passage should reach an ending within the bounded walk').toBe(true)
})

test('Trail mode walks a seeded run to the score screen and returns to the planner', async ({ page }) => {
  // Full-game walk: cold-start (first Vite transform of the app graph) plus a
  // multi-day run can exceed the 30s default when this test runs first or alone.
  test.setTimeout(60_000)
  // Hash-navigate straight into a computed short route with a fixed run seed —
  // trailSeed makes the walk deterministic (see url-hash.ts), so this test cannot
  // flake on hunt/health RNG. irrah→khulut is the sim harness's "short" pair.
  await gotoApp(page, '/#journeyFrom=irrah&journeyTo=khulut&trailSeed=42')
  await expect(page.locator('.journey-route')).toBeVisible()

  await page.getByTestId('set-out-trail-btn').click()

  // Setup card mounts with a default roster; begin the run.
  await page.getByTestId('trail-begin-btn').click()
  await expect(page.locator('.trail-ledger')).toBeVisible()
  await expect(page.getByTestId('trail-vista')).toBeVisible()
  await expect(page.getByTestId('trail-action-continue')).toBeVisible()

  // Walk: Continue, resolving the first card whenever one appears (signature /
  // fort / ford / stream cards all render .passage-choice-card buttons).
  let ended = false
  for (let i = 0; i < 60; i++) {
    const choiceCards = page.locator('.trail-choice-cards .passage-choice-card')
    if (await choiceCards.count() > 0) {
      await choiceCards.first().click()
      continue
    }

    if (await page.getByTestId('trail-outcome-headline').isVisible().catch(() => false)) {
      ended = true
      break
    }

    const continueBtn = page.getByTestId('trail-action-continue')
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click()
    } else {
      break
    }
  }

  expect(ended, 'Trail mode should reach the score screen within the bounded walk').toBe(true)
  await expect(page.getByTestId('trail-score-rank')).not.toBeEmpty()

  // Return lands back on the planner with the route intact.
  await page.getByTestId('trail-return-btn').click()
  await expect(page.locator('.journey-route')).toBeVisible()
})
