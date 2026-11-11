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
- `web/e2e/smoke.spec.ts` has 18 smoke tests (counted 2026-10-26) covering map load, route compute, party mount, save/reload, share link, player MD, multi-party, map key, marginalia, travel vignette, Passage mode.
- `web/package.json` has `test:e2e` / `test:e2e:ui` scripts.
- e2e: run `npm run test:e2e` locally; there is no CI e2e job (ci.yml was deleted in `a072da8`, see the CI CORRECTION below).

## Bundle-size budget
- Status: **IMPLEMENTED**.
- `scripts/check-bundle-size.mjs` gates the gzipped app `index-*.js` chunk at 200 KiB.
- Size check: run `npm run check:size` locally after build; no CI runs it (see the CI CORRECTION below).
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
- ROADMAP.md still lists Tier 2 (2b player-view rigor; 2a fog of war and 2c multi-party shipped), Tier 3 architectural debt, Tier 4 polish — none are blockers.
- No active claims.

## 2026-09-30 worklist item 18 (next roadmap tier)
- V3 (Tier-4 polish: a04fb28, 65db8df) and V4 (Passage variation + sand-wraith: e0df2fd) are already on master; `.orchestrate/BACKLOG.md` still lists them OPEN (stale).
- Tier 2a fog of war shipped (3746c7f, e34e855) and Tier 2c multi-party shipped; ROADMAP Tier 2a heading was never marked.
- Remaining spec'd tier is 2b player-view rigor, partly built (shareMode gates, `playerSafe` log). Gaps and four open decisions are in `ai/PLAYER-VIEW-SPEC.md`; awaiting Perry's approval, nothing built.
- Checkout `fix/overlay-fractional-zoom-quantization` is LIVE: open PR #53, 1 commit ahead / 2 behind master, not merged.
- 2026-10-28: PR #53 is CLOSED unmerged (gh pr view 53); the overlay misalignment fix landed instead as 3d56053 (#57). The branch is left as it is.

## 2026-09-30 player-view built (branch feat/player-view-rigor)
- D1-D4 approved as proposed. InfoPanel `shareMode` hides strategic_value / bottleneck / consequence_if_closed and the AI Lore panel (it re-read those fields); MapViewer route tooltips drop bottleneck/consequence in share mode. D3 was already satisfied (Compare toggle is hidden in share mode and compareMode is not URL-driven).
- Perry decided 2026-09-30: Adventure Hooks and GM Notes are also hidden in share mode (built). REVERSED 2026-10-01 (Perry, D5): bottleneck and consequence-if-closed text is now hidden from players everywhere, via `playerSafeRoute` (journey-graph.ts): the planner holds the stripped route in share mode (Route tab, Days tab, JSON copy, saved journeys), and every playerSafe export (Player MD, share-mode campaign log, saved-journey list) strips it too. The earlier partial hide left the same strings visible in the Route tab and handout. D1-D4 confirmed by Perry the same day.

## 2026-10-26 worklist item 16 (IDEAS note)
- ai/IDEAS.md now records that the Passage onboarding branch was merged to master as ed71396 (2026-06-24); the old "NOT merged" heading is kept as history. No code changed.

## 2026-10-27 worldbuilder sync 2853c0c + generator fixes (branch chore/sync-worldbuilder-2026-10-27)
- Synced 6 stale files (topology, MAP-PROMPT, canon, search-index, encounters, travel-graph). New in topology: `western_route` (ADR-0045, sixth canonical route, off-map terminus Vaucresne).
- `pipeline.py validate` had been failing on master since the 09-29 sync: ADR-0047 D2 moved `copper_for_steel_road` to `treaty_flows`. Validator now expects it there and requires `western_route`. Validate is not in CI, which is why it went unnoticed.
- Exporter: `TopologyData.get_route` falls back to `treaty_flows` and the export loop includes them, so Copper-for-Steel keeps its lore. Regenerated GeoJSON: properties-only refresh (4 civs, 2 chokepoints, Basin, Copper consequence text), zero geometry change.
- `western_route` is NOT drawn: no manifest path, and an off-map route's entry point/styling is Perry's call (IDEAS).
- UPDATE same day (Perry: "add all that as you see fit"): drawn. Manifest path enters off the west edge, Halanimoa placed on Oravan's western shore (canon fixes order, not coords), Halkar Straits, NE across the Basin to Tavakh-Qarat. Style `#5a6e9a`, dash `10,3,2,3`. DISPLAY-ONLY: `journey-graph.ts` skips trade routes carrying `off_map_terminus` (exporter now emits it) in both port-snap and edge building, so journeys and sim baselines are unchanged; test locks it. Making it routable needs authored sea-lane durations (ADR-0018) first.
- CI CORRECTION: `.github/workflows/ci.yml` was deleted 2026-06-29 (`a072da8`, Actions drain); only `deploy.yml` (build only) remains. The "CI runs check:size / e2e" lines above are stale. New local gate: `npm run check:data` (sync --check + topology validate, prefers generator/.venv).
- Verified: validate OK, persistence round-trip OK, tsc clean, 1151 unit, build, size (34 KiB headroom), e2e 20/20, sync --check 8/9 (calendar optional).

## 2026-10-28 worklist item 4 (test count)
- `web/src/utils/journey-supply.test.ts` now has 40 tests, all green (vitest, 2026-10-28); line 12's "36" is the count when that section was written.

## 2026-11-03 worklist item 1 (ROADMAP 2a marked)
- ROADMAP.md "### 2a. Fog of war / explored hexes" now reads "— ✅ SHIPPED 2026-05-22" (shipped in 3746c7f and e34e855). This resolves the 09-30 note that the heading was never marked.
- `.orchestrate/BACKLOG.md` already marks V3 and V4 DONE (a04fb28, 65db8df, e0df2fd), so the 09-30 "still lists them OPEN" note is resolved too. No code changed.


## Map hardening (2026-11-10)
- Plan: `research/map-hardening/PLAN.md` (decisions D1-D7, phases, lanes). Evidence: `GEOGRAPHY-AUDIT-2026-11-10.md`.
- Perry ruled to converge cartography onto the canonical spine/schematic layout (supersedes 2026-09-29).
- **Next: Phase 1** (manifest re-derived from worldbuilder positions.yaml, saved-data inventory, 4 km/unit scale, sim before/after gate). Land or rebase `fix/overlay-fractional-zoom-quantization`, `feat/player-view-rigor`, `feat/draggable-planner` first.
