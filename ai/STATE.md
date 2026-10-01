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

## 2026-09-30 worklist item 18 (next roadmap tier)
- V3 (Tier-4 polish: a04fb28, 65db8df) and V4 (Passage variation + sand-wraith: e0df2fd) are already on master; `.orchestrate/BACKLOG.md` still lists them OPEN (stale).
- Tier 2a fog of war shipped (3746c7f, e34e855) and Tier 2c multi-party shipped; ROADMAP Tier 2a heading was never marked.
- Remaining spec'd tier is 2b player-view rigor, partly built (shareMode gates, `playerSafe` log). Gaps and four open decisions are in `ai/PLAYER-VIEW-SPEC.md`; awaiting Perry's approval, nothing built.
- Checkout `fix/overlay-fractional-zoom-quantization` is LIVE: open PR #53, 1 commit ahead / 2 behind master, not merged.

## 2026-09-30 player-view built (branch feat/player-view-rigor)
- D1-D4 approved as proposed. InfoPanel `shareMode` hides strategic_value / bottleneck / consequence_if_closed and the AI Lore panel (it re-read those fields); MapViewer route tooltips drop bottleneck/consequence in share mode. D3 was already satisfied (Compare toggle is hidden in share mode and compareMode is not URL-driven).
- Deliberately NOT changed (reviewer flagged, judged design intent per journey-export.ts:67 / campaign-log.ts:39): the route "Bottlenecks & Risks" list, journey-days text and Player MD still carry route bottleneck text; Adventure Hooks / GM Notes still render for players. Perry to decide if those should also be GM-only.
