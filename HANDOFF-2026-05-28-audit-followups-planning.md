# HANDOFF — Audit follow-ups (planning brief for next instance)

**Date:** 2026-05-28
**Author:** Claude (Opus 4.7, 1M context) — *prior* instance
**Predecessor commit:** `0bccf61` (mode-selector recommendation shipped)
**Audit run:** Chrome agent against https://pmartin1915.github.io/veydria-cartography/ on 2026-05-28 after `0bccf61` was live.
**Raw audit text:** `SCOPING-2026-05-28-audit-findings.md` in repo root (verbatim copy, gitignored). Also at `C:\Users\perry\Downloads\Phase A is complete and grounded in both the live UI and the actual data files (veydria-spatial.md` (verbose filename, same content).

---

## What this brief is

You are the next instance. **Your job: plan the fix cycles**, in order, for the 19 audit findings. Don't implement yet — make a plan the user (Perry) can approve.

The audit delivered three documents (map content, app UX, cross-cutting summary) as three chat messages, all preserved verbatim in the SCOPING file. The agent had no filesystem-write tool so screenshots are referenced by in-session capture IDs (e.g. `ss_0596fya23`) that no longer exist — when a finding cites visual evidence, treat the textual description as authoritative.

**The mode-selector recommendation I just shipped (`0bccf61`) verified clean** (F-app-1, F-app-2, F-app-4). No regression to fix on that surface.

---

## Triage — all 19 findings

| ID | Phase | Severity | Verdict | Suggested batch |
|----|-------|----------|---------|-----------------|
| **F1** | map | subjective | GM judgment call — region land-area imbalance (Irrah 1144 cells, Ndjadi 196 — 5.8× spread) | C4 (defer / decide) |
| **F2** | map | **critical** | Biome Colors layer doesn't differentiate per-cell biomes (24 distinct biomes exist in data, layer only tints civ-level zones) | **C2** |
| **F3** | map | subjective | Each civ has a single dominant biome (66–75%); GM judgment whether intra-region variety matters | C4 (defer / decide) |
| **F4** | map | polish | Stylized continental label "NGARU-BON" (hyphen) vs tooltip/data "Ngaru Bon" (space) | **C2** |
| **F5** | map | polish | Point features carry no `civ` property; segment region labels are spatially inferred | **C2** (enables F7) |
| **F6** | map | polish | Hex grid is good; default cell size 50 is large at continental zoom — minor | C4 (defer / decide) |
| **F7** | map | **critical** | Tavakh-Qarat (Irrah mainland) vs Tavakh-Rubāṭ (near Oravan) are near-identical names; GM may pick wrong port for sea journey | **C2** (depends on F5) |
| **F8** | map | polish | Compendium renders raw markdown-table pipe text (`\| Local Name \| ...`) for some lore entries | **C3** |
| **F-app-1** | app | polish | ✅ Verification pass — caravan badge trigger works, color correct, active mode never badged | **NONE** |
| **F-app-2** | app | polish | ✅ Verification pass — badge gold `#E8C840` matches gold warning blocks, distinct from red bottlenecks (computed CSS confirmed) | **NONE** |
| **F-app-3** | app | polish | Coverage gap — couldn't reproduce "≥2 severe encounters → badge on safest" with agent's chosen endpoints. Caravan path verified; severe path not | **OQ1** (open question) |
| **F-app-4** | app | polish | ✅ Verification pass — share-mode hide/show rules correct (DOM-verified) | **NONE** |
| **F-app-5** | app | **critical** | Same-tab `hashchange` doesn't re-hydrate map view or journey state; only fresh-tab loads work. Leftover Leaflet tooltips persist | **C1** |
| **F-app-6** | app | polish | URL hash persists only `journeyFrom`/`journeyTo` — not season, mode, or supply. Shared "summer caravan" plan re-hydrates as Any/Direct/default | **C1** (related to F-app-5) |
| **F-app-7** | app | **critical** | `fonts/fonts.css` references woff2 at site root `/fonts/...` instead of project base `/veydria-cartography/fonts/...`; all 5 self-hosted fonts return 503. App falls back to system fonts | **C1** |
| **F-app-8** | app | polish | ✅ Verification pass — compendium search → fly-to → detail panel works, lore cards fully populated. Minor: planner stacks over compendium when both open | **NONE** (optional minor in C3) |
| **F-app-9** | app | polish | ✅ Verification pass — `.journey-planner` cascade fix is in place (CSSOM-confirmed). Pixel-check at 700px not performed (env didn't allow resize) | **OQ2** (open question) |
| **F-app-10** | app | polish | `.journey-planner-header` has same cascade bug `.journey-planner` had pre-fix — desktop padding declared after `@media (max-width:768px)` override; mobile padding never wins | **C1** (trivial reorder) |
| **F-app-11** | app | subjective | `pmartin1915.github.io` origin shares localStorage across all the dev's Pages projects (Veydria coexists with burn-wizard keys). Veydria already namespaces well | **NONE** (advisory) |

**Tally:**
- Critical bugs: 4 (F2, F7, F-app-5, F-app-7)
- Clear polish bugs: 4 (F4, F5, F-app-6, F-app-10)
- Content polish: 1 (F8)
- Verification passes (no action): 5 (F-app-1, -2, -4, -8, -11)
- GM-judgment-needed (defer): 4 (F1, F3, F6, F-app-11)
- Open questions (resolve before planning): 2 (F-app-3, F-app-9)

---

## Recommended cycle ordering

### Open questions to resolve FIRST (before cycle 1)

These can't be skipped — they determine the shape of later cycles.

**OQ1 — F-app-3: confirm the severe-encounter badge trigger.** The audit couldn't reproduce "≥2 severe encounters → badge on safest" with its chosen routes. Either (a) find the exact (start, end, season, supply) tuple that triggers it, or (b) read `web/src/utils/encounters.ts` + the encounter-roll code paths to confirm the predicate is reachable. If the threshold is effectively unhittable in practice, the recommendation feature is half-dead. **Estimated effort: 15 min reading + 15 min testing.**

**OQ2 — F-app-9: pixel-check the mobile bottom-sheet at 700×900.** The CSSOM analysis confirmed source-order is correct, but a real browser at <768px never rendered. Open Chrome DevTools device mode at 700×900 and confirm: (a) bottom-sheet activates, (b) 5-button mode row + Recommended badge fit without horizontal overflow, (c) action-button row wraps. **Estimated effort: 10 min.**

### Cycle 1 — Critical app bugs (one batched commit)

Four findings that break or degrade core UX. All small fixes individually; bundling makes sense because they all touch the app's hash/asset/CSS plumbing.

1. **F-app-7 — Fonts 503.** Fix the `@font-face src` paths in `web/public/fonts/fonts.css` (or wherever `fonts.css` lives — verify) to use a path relative to the css file, OR include the `/veydria-cartography/` base. Re-verify all 5 woff2 return 200 in network tab. **~10 min.** *(Critical — but trivial. The serif "parchment" aesthetic depends on these.)*
2. **F-app-10 — Header cascade.** Move the `.journey-planner-header` desktop rule (App.css ~line 2960) above its `@media (max-width: 768px)` block. Mirror exactly what `0bccf61`'s predecessor did for `.journey-planner`. **~5 min.**
3. **F-app-5 — Same-tab stale hash.** Add a `hashchange` listener that re-parses URL state and re-applies view + journey config without a full reload. Also clear stale Leaflet tooltip/hover state on view change. Find existing hash-parse code (likely `App.tsx` or `url-hash.ts`) and ensure it's invoked on `hashchange`, not only on mount. **~45–60 min.** *(Most complex of the four — careful about React effect ordering and Leaflet's imperative state.)*
4. **F-app-6 — Hash params for season/mode/supply.** Extend the hash serializer to include `season`, `mode`, and pack-animals (the field that drives the caravan badge). Update the hydration path to read them. This is meaningful for shareable plans — without it, a player opening a "summer caravan" share link sees a different config. Once F-app-5 is in, the hash listener should also re-apply these on same-tab changes. **~30 min.** *(Pairs with F-app-5 architecturally — same hydration code paths.)*

**Cycle 1 verification:**
- New unit tests for hash serialization round-trip (if `url-hash.ts` is the home).
- Manual: open a fully-configured planner URL; copy URL; paste into same tab → view re-centers and config re-hydrates. Then `&share=1` round-trip preserves season/mode.
- Network tab: 5 woff2 return 200.
- DevTools device mode at 700px: header padding is `8px/10px`, not `12px`.

### Cycle 2 — Map content + naming (one cycle, possibly multiple commits)

Content fixes. F2 is the largest single piece; F5 enables F7; F4 is trivial standalone.

1. **F4 — Ngaru Bon label.** Find the stylized continental label rendering "NGARU-BON" (likely in the SVG schematic `web/public/veydria-schematic.svg` or in a label-overlay component). Change to "Ngaru Bon" to match the tooltip and data `name`. **~10 min.**
2. **F5 — Tag point features with `civ`.** Add an explicit `civ` (or `region`) property to the 55 non-cell features in `web/public/data/veydria-spatial.geojson`. Then update the journey-planner segment labeler to prefer the explicit tag over spatial inference. **~30 min.** *(Touches data + one helper. Verify no test breaks on the inference fallback.)*
3. **F7 — Disambiguate Tavakh ports.** In the node picker, suffix names with `civ` so "Tavakh-Qarat" reads as "Tavakh-Qarat (Irrah)" and "Tavakh-Rubāṭ" reads as "Tavakh-Rubāṭ (Oravan)". Verify the planner annotates a sea segment when the route crosses the Halkar Straits between mainland and Oravan. **~20 min.** *(Depends on F5 being in.)*
4. **F2 — Biome Colors layer.** Biggest piece. The data has 24 distinct biomes (e.g., Desert / Sabkha / Oasis / Escarpment within Irrah alone); the current layer only tints by civ. Design a per-biome palette (suggest: warm/cold/wet/dry quadrant + saturation for elevation) and update the Biome Colors layer renderer to key fills by `biome`, not by `civ`. Decide whether to keep the civ-tint as a separate layer or merge. **~90–120 min.** *(Largest single item in the whole follow-up set. May warrant its own scoping doc before commit.)*

**Cycle 2 verification:**
- Visual: zoom into Irrah; Desert / Sabkha / Oasis / Escarpment cells visually distinct in Biome Colors layer.
- DOM: continental label reads "Ngaru Bon" (no hyphen) in the SVG.
- Node picker: typing "Tavakh" shows two clearly-disambiguated entries.
- A computed inter-Tavakh route between Oravan and Irrah annotates a sea/strait crossing.

### Cycle 3 — Compendium polish

5. **F8 — Markdown tables in lore.** In the compendium renderer (likely `web/src/components/Compendium*.tsx` — find by grep), detect `|`-delimited markdown tables in `summary` fields and render them as HTML `<table>`. The Irrah disease entry (`features.irrah[1]`, key `ecology.disease.irrah` in `veydria-lore.json`) is the test case. **~45 min.**
6. *(Optional)* — F-app-8 minor: auto-collapse one panel when the other (planner vs compendium) opens. Skip unless trivial.

### Cycle 4 — GM judgment calls (require Perry's decision before planning)

Don't plan these as fixes. Ask Perry to make the call first:

- **F1** — Is the Irrah/Ngaru-Bon hegemon-pair pattern intentional? If yes, no action. If no, this is a spatial-pipeline rebalance (big).
- **F3** — Is "each nation has a signature landscape" the intended design? If yes, F2's per-biome palette is sufficient; if no, terrain-mix changes are needed (also big).
- **F6** — Default hex cell size 50 vs 30 at continental zoom. Subjective.
- **F-app-11** — localStorage namespacing. Veydria already follows `veydria.*`; advisory only.

---

## What NOT to fix (verification passes — keep working)

These are *positive* findings. The audit confirmed the surface works as designed; touching them risks regression.

- **F-app-1** — Caravan trigger badge works (color, tooltip, active-mode suppression all correct).
- **F-app-2** — Badge gold `#E8C840` matches warning blocks; distinct from red bottlenecks. (This corrects a *prior* audit's color error — don't re-introduce.)
- **F-app-4** — Share-mode hide/show rules correct (Mode Risk hidden, Encounter Density hidden, Encounters tab hidden, badge hidden, Mark-explored hidden, GM toolbar items hidden; Bottlenecks shown, Seasonal Restrictions shown, timeline shown).
- **F-app-8** — Compendium search → fly-to → detail panel flow works; lore cards fully populated; etymology / related features / hooks / AI lore all surface correctly.
- **F-app-11** — Veydria already namespaces localStorage well; the foreign keys are from sibling apps on the shared origin.

---

## Per-cycle effort summary

| Cycle | Scope | Findings | Est. effort | Risk |
|-------|-------|----------|-------------|------|
| OQ1+OQ2 | Pre-flight checks | F-app-3, F-app-9 pixel | ~40 min | None |
| C1 | Critical app bugs | F-app-5, F-app-6, F-app-7, F-app-10 | ~100–120 min | Medium (hash listener + Leaflet state) |
| C2 | Map content + naming | F2, F4, F5, F7 | ~150–180 min | Medium (F2 palette design) |
| C3 | Compendium polish | F8 | ~45 min | Low |
| C4 | GM decisions | F1, F3, F6, F-app-11 | n/a until Perry decides | n/a |

Total estimated implementation time: ~6 hours across three cycles, plus Perry's decision time on C4.

---

## Suggestions for the planning pass

- **Don't combine C1 and C2.** They touch different layers (app plumbing vs content/data) and would make a single commit hard to review or revert. C1 is the higher priority — fonts and stale-hash both have user-visible impact today.
- **F2 (biome palette) is large enough to deserve its own SCOPING-*.md** before committing. Sketch a palette mapping for all 24 biomes, get Perry's sign-off on the visual style, *then* implement. The previous big-scope features (encounter mechanics, supply recalibration) followed this pattern — see the SCOPING-*.md historical files in the repo for the template.
- **F-app-5 (stale hash) interacts with how the planner currently re-hydrates.** Before planning, read `web/src/utils/url-hash.ts` and the App-level hash-parse effect to understand the current shape. If the hash is parsed only in a mount effect (no `hashchange` listener), the fix is to add the listener and call the same parse path on event. Beware re-entrancy if the parser also *writes* the hash.
- **Run the Chrome audit again after C1 + C2 ship.** The previous audit cycle observed that Chrome-driven audits surface things unit tests can't (DOM-position, responsive CSS, share-mode renders). After this batch of fixes lands, a re-audit is worth the ~$10 spend.

---

## Files the next instance will likely touch (forward references)

To save you grep-time during planning:

- `web/public/fonts/fonts.css` — F-app-7
- `web/src/App.css` ~line 2960 — F-app-10
- `web/src/utils/url-hash.ts` + `web/src/App.tsx` (search for `hashchange`, `location.hash`, hash-effect) — F-app-5, F-app-6
- `web/public/data/veydria-spatial.geojson` — F5 (add `civ` property to point features)
- `web/public/veydria-schematic.svg` *or* a label-overlay component — F4
- `web/src/components/JourneyPlanner.tsx` (node picker + segment labeler) — F5/F7 follow-on
- Biome-Colors layer renderer (likely in `web/src/components/MapViewer.tsx` or a layer module — grep `biome`, `BiomeColors`, or layer-control wiring) — F2
- `web/public/data/veydria-lore.json` (data) + compendium renderer in `web/src/components/Compendium*.tsx` — F8

---

## Money rule note

The Chrome audit was Perry's separate spend (~$10–20 expected). Implementation cycles stay on Claude Opus Max subscription. No PAL delegation needed for any of the above — they're all clinical / app-specific work.
