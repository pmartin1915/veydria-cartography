# Project State — veydria-cartography

> Append-only.

## Tier 1 roadmap status — Rations + supply pressure
- Status: **IMPLEMENTED**.
- `web/src/utils/journey-supply.ts` exists with full model:
  - `SupplyConfig` (rations/water/encumbrance/pack animals)
  - `computeSupplyTimeline`, `applyDailyBurn`, `summarizeSupplyPressure`
  - Forced-march, arid/semi-arid biomes, winter/summer season, per-mode burn multipliers
  - Resupply tiers and Passage capacity scars
- `web/src/utils/journey-supply.test.ts` exists with 36 tests, all green.
- UI wiring (Supply collapsible in planner, URL hash, saved journeys, markdown export) was shipped in prior sessions.

## Playwright smoke tests
- Status: **IMPLEMENTED**.
- `web/e2e/smoke.spec.ts` has 13 smoke tests covering map load, route compute, party mount, save/reload, share link, player MD, multi-party, map key, marginalia, travel vignette, Passage mode.
- `web/package.json` has `test:e2e` / `test:e2e:ui` scripts.
- CI `.github/workflows/ci.yml` already has a separate `e2e` job installing Chromium and running `npm run test:e2e`.

## Bundle-size budget
- Status: **IMPLEMENTED**.
- `scripts/check-bundle-size.mjs` gates the gzipped app `index-*.js` chunk at 200 KiB.
- CI runs `npm run check:size` after build.
- Current build: app chunk ~161.95 KiB gzip, 38 KiB headroom.

## Data sync with worldbuilder
- `scripts/sync-world-data.mjs` syncs canonical geography/canon/encounter data.
- Last sync (this session): `canon.json` + `search-index.json` were stale and have been refreshed.
- All 8 mapped files now up to date.

## Verification (this session)
- `npm test` → 956 passed
- `npm run build` → success
- `npm run check:size` → within budget
- `node scripts/sync-world-data.mjs --check` → all up to date

## Open loops
- ROADMAP.md still lists Tier 2 (fog of war, player-view rigor), Tier 3 architectural debt, Tier 4 polish — none are blockers.
- No active claims.
