# SCOPING — Supply recalibration (Track 1)

**Date:** 2026-05-24
**Author:** Claude (Opus 4.7, 1M context)
**Predecessor:** approved plan at `~/.claude/plans/you-are-the-next-peppy-papert.md`
**Status:** scoping only. No code changes this session. Successor session lands the fix.

---

## 1. Problem statement

Phase 2 of the sim harness (commit `80801f2`, 2026-05-24) ran the full 4,320-point grid and found:

> "100% of grid points hit water-out, *including the `caravan` preset* (14 rations / 7 water + pack animals). The roadmap target band for `standard` was 5–25%; current state is 100% across every preset. The supply burn vs. continental distance ratio needs fundamental recalibration, not nibble-tuning."
> — `HANDOFF-2026-05-24-sim-batch-shipped.md:15`

**Reproduced this session** (`npm --prefix web run sim:batch`, 2.2s):
```
runs: 4320 (in 2.2s)
route_found: 4320 (100.0%)
completed:   0    (0.0%)
water_out:   4320 (100.0%)
rations_out: 4320 (100.0%)
```

Two reading framings were live at the open of this session:

- **The world is too big.** Civs are 35–100+ days apart; the engine assumes "carry all supply you'll ever need." Real-world Sahara caravans and Silk Road segments used staging posts, not solo loadouts. Fix is structural (resupply waypoints in the engine).
- **The water burn is too fast.** `journey-supply.ts`'s per-day water coefficient may be calibrated for tactical trips, not 60-day continental travel. Fix is one constant.

Back-of-envelope: a 60-day journey burns 60 water units at the standard rate; caravan loadout = 7 + 7 = 14 water. **No physical loadout can survive a continental journey at the current burn rate.** That's the structural read; the constants-tuning read is what probes 1–4 in earlier drafts of this doc tried to discriminate.

### Decision locked this session (2026-05-24): **structural fix wins**

Perry answered Q1 (section 8): **waypoint resupply is canonical.** The intended in-fiction model is that parties resupply at rivers, oases, and settlements — not that they carry 60 days of water on their backs. This collapses the "two readings" framing into one: the engine's "carry everything" assumption is the bug, and tuning supply constants without fixing it is putting bigger bandages on the wrong wound.

This pivots the rest of the scoping doc. The structural fix (formerly probe 5) is now the **primary** Track 1 deliverable. Constant tuning (formerly probes 1–4) is secondary cleanup that happens *after* resupply lands, because then `tight` should still fail sometimes, `standard` should occasionally fail in arid seasons, and `caravan` should usually succeed — calibration the engine can't even attempt today.

---

## 2. Constants / coefficients inventory

**Supply burn** (`web/src/utils/journey-supply.ts`):

| Line | Constant | Value | Notes |
|---|---|---|---|
| 28–33 | `DEFAULT_SUPPLY` | rations 12 / water 6 / normal / none | Default loadout — what UI ships with (Option H, 2026-05-26) |
| 58 | `ARID_BIOMES` | `Desert, Sabkha, Steppe, Escarpment` | Touches one in a day → water ×1.5 |
| 81–83 | `encMult` | light 0.9 / normal 1.0 / heavy 1.1 | Applied to both rations and water |
| 85–87 | `packBonus` | none 0 / few +3 / caravan +7 | Added once at start; bonuses **both rations and water** (lines 93–94) |
| 89 | `forcedRationsMult` | 2.0 (forcedMarch) / 1.0 | Doubles ration burn |
| 90 | `forcedWaterMult` | 1.5 (forcedMarch) / 1.0 | 1.5× water burn |
| 91 | `seasonRationsMult` | winter 1.25 / 1.0 | Only winter; world is tropical |
| 107 | `biomeWaterMult` | arid 1.5 / 1.0 | Per-day, not per-edge |
| 109 | `rationsBurned = encMult × forcedRationsMult × seasonRationsMult` | — | Composition |
| 110 | `waterBurned = encMult × forcedWaterMult × biomeWaterMult` | — | Composition |
| 116–119 | warning thresholds | water-out ≤0, rations-out ≤0, low ≤2 | Priority: water-out > rations-out > water-low > rations-low |

**Supply presets** (`scripts/sim/sim-batch.ts:35-39`, mirrored from `SIM-HARNESS-ROADMAP.md:43`):

| Preset | rations | water | encumbrance | packAnimals | Effective water carry (with bonus) |
|---|---|---|---|---|---|
| `tight` | 3 | 2 | light | none | 2 |
| `standard` | 7 | 3 | normal | none | 3 |
| `caravan` | 14 | 7 | heavy | caravan | 7 + 7 = **14** |

**Party presets** (`scripts/sim/sim-batch.ts:41-45`):

| Preset | pace | mount | size | forcedMarch |
|---|---|---|---|---|
| `light-fast` | fast | foot | small | false |
| `standard` | normal | foot | medium | false |
| `heavy-slow` | slow | foot | large | false |

**Distance / speed** (`web/src/utils/journey-graph.ts`):

| Line | Constant | Value | Notes |
|---|---|---|---|
| 464–469 | `speedByType` (km/day) | trade_route 50, chokepoint 12.5, intra_civ 25, civ_link 25 | **Load-bearing** — divides km into segmentDays at line 474 |
| 60–73 | `getPaceMultiplier` | slow 0.75, fast 1.33, mounted ×1.5 (open road), forcedMarch ×1.25, large+chokepoint ×0.9 | Multiplies `speedByType` |
| 324–327 | chokepoint distance penalty | mountain_pass 2.5, river_crossing 1.8, maritime_strait 1.5, default 2.0 | Inflates `distanceSvg` for chokepoints |
| 358–378 | mode weights | fastest: trade ÷2, chokepoint ÷0.5; safest: chokepoint ×3; cheapest: chokepoint ×2 | Affects route choice, not segmentDays |
| 426–429 | seasonal block | blocked edge × 10 cost | Routing penalty, not consumption |

**Scale** (`web/src/utils/measure.ts:8`): `KM_PER_SVG_UNIT = 2.5`. Continental extent ≈ 3000 km on the 1200-unit canvas.

---

## 3. Work plan — primary: waypoint resupply affordance

Constant-tuning probes are demoted to section 3b (post-resupply calibration). This section scopes the structural work that has to land first.

### 3a. Resupply waypoint affordance — what gets built

The minimum viable shape (kept small so it can be one tight cycle):

1. **Identify resupply nodes — differentiated by category** (Q2 answer locked 2026-05-24):
   - **Civilizations** (`category === 'civilization'`, 6 of them): full resupply of **both** rations and water.
   - **Ports & oases** (`category === 'port' | 'oasis'`): **water only**. Restores `waterLeft`; rations untouched.
   - **Landmarks** (`category === 'landmark'`): **no resupply**. They're navigational, not logistical.
   - **(Deferred to a second cycle.)** Rivers as linear features granting water-only top-up when a day's edge crosses them. Geojson would need river polylines tagged eligible.
   - Implement the tier check as a small predicate: `getResupplyTier(node): 'full' | 'water' | 'none'`. Keeps the differentiation in one place.

2. **Top-up mechanics — keep it brutally simple in v1:**
   - When a `JourneyDay` ends with `campLabel` matching a resupply node (the existing `campLabelAt` helper at `web/src/utils/journey-days.ts:134` already produces `Camp at <name>` for nodes), apply the tier's restore at the *end* of that day's burn, before warnings are computed:
     - `full` tier: `rationsLeft = supply.rationsPerPerson + packBonus`; `waterLeft = supply.waterPerPerson + packBonus`.
     - `water` tier: `waterLeft = supply.waterPerPerson + packBonus` (rations untouched).
     - `none`: skip.
   - **No cost in v1.** Free top-up, no day spent, no gold. Cost mechanics wait for Phase 3 policies to want them. (Author's prediction: you'll want a cost dimension inside two cycles; designed so it can be added without rewriting the predicate.)

3. **Bundle with this cycle — semi-arid biome tier** (Q3 answer locked 2026-05-24):
   - Add `SEMI_ARID_BIOMES = new Set(['Savanna', 'Scrubland'])` at `journey-supply.ts:58` (sibling to existing `ARID_BIOMES`).
   - In the per-day loop (lines 99–107), if a day touches `SEMI_ARID_BIOMES` (and no arid biome), set `biomeWaterMult = 1.25`. Existing arid ×1.5 takes priority.
   - Why bundled: post-resupply, aridness becomes the primary route discriminator. A step function (arid or not) makes routes bimodal; a softer middle tier gives the section-6 asymmetry the engine needs for free.

4. **Where the code goes** (no engine fork):
   - `web/src/utils/journey-supply.ts:computeSupplyTimeline` gets a new optional parameter: `resupplyAtDay?: (dayNum: number) => 'full' | 'water' | 'none'`. Inside the per-day loop (lines 98–129), after burn but before warning computation, apply the tier's restore.
   - `scripts/sim/run-journey.ts` (the shared spine) computes the predicate from `JourneyDay.campLabel` + a resupply-node lookup, passes it in. The lookup uses `getResupplyTier(node)` defined alongside it.
   - The UI's `JourneyDaysTab.tsx` and `SupplyConfig.tsx` pick this up for free — same code path.

5. **What this costs in LOC:** ~40 in `journey-supply.ts` (parameter + tier branch + `SEMI_ARID_BIOMES`), ~30 in `run-journey.ts` (predicate + node tier lookup), 0 in UI. Roughly half a day's work; bundle the biome tier in the same commit.

6. **Verification after landing 3a:**
   - `npm --prefix web run sim:batch` → `standard` completion lands somewhere non-zero. If it's already in [5%, 25%], skip 3b entirely. If it's now 80–100%, 3b's calibration is needed.
   - `tsc --noEmit` clean. `npm test` — all 571 still pass (resupply is additive; no behavior change when predicate returns false).

### 3b. Constant tuning — post-resupply calibration (only if needed)

Run **only after 3a ships** and only if completion rates miss the section 6 target bands. One variable at a time. Each iteration = constant edit + `npm --prefix web run sim:batch` + read `completed %`.

| Order | Trigger | Edit | Target signal |
|---|---|---|---|
| 0 | Always (Q5 answer locked) | Add `seasonRationsMult.summer = 0.95` at `journey-supply.ts:91`. Cosmetic flavor tweak; tropical biology. | Minor easing of summer ration pressure. Bundle in the same commit as 3a. |
| 1 | `standard` > 25% after 3a (resupply too permissive) | Raise `tight` and `standard` water burn, or shrink `packBonus` for `caravan` at `journey-supply.ts:86` | `standard` lands in [5%, 25%] |
| 2 | `caravan` < 40% after 3a (something is still gating caravan) | Investigate route mode: which civ pairs always fail? Likely a chokepoint penalty issue at `journey-graph.ts:324-327`, not a supply issue | `caravan` lands in [40%, 80%] |
| 3 | All seasons identical (no winter pressure) | Bump `seasonRationsMult.winter` at `journey-supply.ts:91` from 1.25 to 1.5 | Winter completion meaningfully lower than other seasons |

**Rule:** stop the moment `standard` lands in [5%, 25%], `tight` in [0%, 5%], and `caravan` in [40%, 80%] (section 6 bands).

---

## 4. Decision tree

```
  3a. Implement waypoint resupply (civs + named points; full top-up, no cost)
  │
  ├── standard completion lands in [5%, 25%] ────────────────> ✅ DONE
  │
  ├── standard < 5% (resupply too sparse / model still too punishing)
  │   └── Survey which civ pairs still fail at standard.
  │       ├── If failures are arid-biome routes only:
  │       │     answer Q3 (aridness tiers) and re-run.
  │       └── If failures are non-arid too:
  │             extend resupply nodes to include landmarks (tier-2),
  │             then re-run.
  │
  └── standard > 25% (resupply too permissive)
      └── Run 3b probe 1: raise tight/standard water burn or
          shrink caravan packBonus. Iterate to [5%, 25%].
```

---

## 5. Baseline snapshot plan

Option C from `HANDOFF-2026-05-24-sim-batch-shipped.md:101-103`, amended with Q8's answer (locked 2026-05-24).

**Create a tracked `traces/` directory at repo root** (sibling to `output/`, NOT under it — `output/sim/` stays gitignored and clobberable). Inside:

1. **`traces/baseline.jsonl`** — 144 runs from `--from-civs ngaru_bon --to-civs oravan` (longest plausible journey, surfaces the most pressure). 4 seasons × 4 modes × 3 supply × 3 party = 144 runs.
2. **`traces/baseline.summary.csv`** — pivot-ready companion to the jsonl, for quick diffing.
3. **`traces/README.md`** — what the baseline is, when to refresh it, the exact CLI command that produced it. One short page.
4. **Update `SIM-HARNESS-ROADMAP.md`** with a one-line pointer to `traces/` as the regression-baseline location.

Sequencing within the recalibration session:
1. Generate the baseline (3s).
2. Commit it: `feat(sim): pin pre-recalibration baseline + traces/ regression dir`.
3. Implement 3a (and 3b probe 0).
4. Re-run sim:batch on the same slice, compare summary.csv side-by-side against the committed baseline.
5. Iterate 3b probes if needed.
6. **Do not regenerate `traces/baseline.jsonl`** during the recalibration cycle — it's the pre-fix snapshot, by definition. The *next* refresh happens when a future cycle wants a new pre-change reference (e.g. before Phase 3 lands).

---

## 6. Success criteria

From `SIM-HARNESS-ROADMAP.md:54`:

> "Target band is probably 5–25% for the standard preset."

**Numeric definition of "done":**

| Preset | Target completion rate |
|---|---|
| `tight` | 0% – 5% (the "you'll need to forage / resupply or turn back" preset) |
| `standard` | **5% – 25%** (the band from the roadmap; the load-bearing target) |
| `caravan` | 40% – 80% (the "you prepared seriously" preset; should usually but not always work) |

Also required:
- **Asymmetric**: completion should vary meaningfully by season (winter harder than summer in tropical world is fine; the gradient should exist). At least one season-mode combination should produce 0% even for caravan, or the engine is too permissive.
- **No false 100%**: no preset should be 100% across the full grid. If caravan hits 100%, the next session needs to expand probe N+1 to make harder routes.

**One pass-fail metric**: `standard` preset's completion rate across the full grid lands in [5%, 25%]. Everything else is sanity-check.

---

## 7. What's explicitly NOT in scope

Per `SIM-HARNESS-ROADMAP.md:126` ("No engine forks") and the predecessor handoff's bound — amended for the Q1 decision:

- ✅ **In scope:** the resupply waypoint affordance (section 3a). This is **not** a fork — it adds a new optional parameter to `computeSupplyTimeline`; the existing call sites continue to work unchanged when the predicate is absent. The harness still measures what the UI computes because both go through the same updated code path.
- ❌ **No engine forks beyond 3a.** If 3b probes need a new constant, it goes into `journey-supply.ts` or `journey-graph.ts` directly. No parallel implementation paths.
- ❌ **No resupply *cost* model in v1** (gold, trust, time spent). Top-up is free at any qualifying node. Cost mechanics wait for Phase 3 policies to want them.
- ❌ **No river-as-linear-feature resupply** (the deferred tier-3 from section 3a). Geojson would need river polylines tagged eligible; that's a separate authoring cycle.
- ❌ **No Phase 3 work** (decision policies). Per the predecessor handoff: *"Phase 3 (decision policies) cannot meaningfully be built on this baseline. Until standard journeys can complete, 'policy survival rate' is uniformly 0% and no decision space matters."* Track 2 stays deferred until Track 1 (3a + any necessary 3b) lands.
- ❌ **No worldbuilder canon wiring** (Track 3). `web/src/utils/encounters.ts` placeholders stay.
- ❌ **No UI changes** beyond what falls out automatically. The `SupplyConfig` panel in `web/src/components/journey-planner/SupplyConfig.tsx` doesn't need a new control; resupply just *happens* in the daily breakdown. If we want a visible "Resupplied at X" line in `JourneyDaysTab.tsx`, that's a small follow-on.
- ❌ **No new tests** beyond one targeted unit test for the resupply predicate. The existing 571 must continue to pass; that's the regression guard.

---

## 8. Open questions for Perry — **all answered 2026-05-24**

Preserved as a decision log so a future instance can see the reasoning, not just the outcomes.

1. **~~In-fiction model for water on continental journeys?~~** ✅ **Waypoint resupply is canonical.** Pivot in section 1; work plan in section 3a.

2. **~~What counts as a resupply node?~~** ✅ **Differentiated by category.** Civs: full (rations + water). Ports & oases: water only. Landmarks: nothing. Implementation in section 3a step 1; tier helper `getResupplyTier(node)`.

3. **~~Should `packBonus` apply to water at all?~~** ⏸ **Deferred.** Resupply makes this less load-bearing. Revisit only if 3b probes need the lever; otherwise water-bonus stays as-is.

4. **~~Should `ARID_BIOMES` expand?~~** ✅ **Yes — add `SEMI_ARID_BIOMES` = {Savanna, Scrubland} at ×1.25.** Existing arid ×1.5 takes priority when both are present. Bundle into the 3a commit (section 3a step 3).

5. **~~Should ration burn drop in non-winter seasons?~~** ✅ **Yes — `seasonRationsMult.summer = 0.95`.** Small cosmetic flavor tweak (tropical biology). Bundle into 3a commit as 3b probe 0 (always-apply).

6. **~~Acceptable level of asymmetry?~~** ✅ **Impossible routes are good drama.** The seasonal-block ×10 penalty at `journey-graph.ts:426-429` already does this for the two routes that warrant it; leave it. Section 6's "at least one combo produces 0%" requirement stands.

7. **~~Is `speedByType` (50/12.5/25/25 km/day) authoritative?~~** ⏸ **Deferred.** Not a Track 1 lever. If a world-scale realism pass is wanted later, that's a separate scoping doc.

8. **~~Where does the baseline live long-term?~~** ✅ **Tracked `traces/` dir at repo root, with `README.md`.** `baseline.jsonl` + `baseline.summary.csv` committed once per cycle that changes the engine. Roadmap gets a one-line pointer. Details in section 5.

---

## Appendix — Order of operations for the successor session

All open questions answered (section 8); the successor can execute without further input from Perry.

1. Read this file end-to-end. Read `SIM-HARNESS-ROADMAP.md` for north-star context.
2. **Pin the baseline first** (section 5):
   - Create `traces/` dir at repo root.
   - Run `npm --prefix web run sim:batch -- --from-civs ngaru_bon --to-civs oravan --out traces`. Rename the outputs to `baseline.jsonl` and `baseline.summary.csv`.
   - Write `traces/README.md` (what it is, when to refresh, exact CLI used).
   - Add one-line pointer to `SIM-HARNESS-ROADMAP.md` referencing `traces/` as the regression-baseline location.
   - Commit: `feat(sim): pin pre-recalibration baseline + traces/ regression dir`.
3. **Implement section 3a** (resupply waypoint affordance + semi-arid tier):
   - `web/src/utils/journey-supply.ts`: add `SEMI_ARID_BIOMES` (section 3a step 3); add `seasonRationsMult.summer = 0.95` (3b probe 0); add `resupplyAtDay?: (dayNum: number) => 'full' | 'water' | 'none'` parameter to `computeSupplyTimeline`; apply tier-aware restore in the per-day loop after burn, before warning computation.
   - `scripts/sim/run-journey.ts`: add `getResupplyTier(node)` helper (civs → `'full'`, ports/oases → `'water'`, landmarks → `'none'`); build the predicate from `JourneyDay.campLabel` and pass it to `computeSupplyTimeline`.
   - One targeted unit test: tier helper returns correct tier for each category; predicate triggers full restore on day with civ camp, water-only on oasis camp, no restore on landmark camp.
4. Run `npm --prefix web run sim:batch`. Read `output/sim/summary.csv`. Check the section 6 bands.
5. If section 6 bands aren't met, run section 3b probes 1–3 (post-resupply calibration). Stop when bands are met.
6. Verification before commit: `npx tsc --noEmit` clean from `web/`; `npm test` — all 571 pass; `npm --prefix web run build` clean. Then commit `feat(sim): waypoint resupply + semi-arid tier + summer ration easing` (and push only on Perry's explicit ask).
7. Update `~/.claude/projects/C--Users-perry-DevProjects-veydria-cartography/memory/sim-harness.md` with the new completion rates and the resupply mechanic. Write successor handoff `HANDOFF-2026-MM-DD-supply-recalibration-shipped.md`.
8. **Do not start Track 2 (Phase 3 policies) in the same session.** Survival data needs at least one full re-run after the recalibration ships before policies are meaningful.

---

## Verification of this scoping doc (per peppy-papert lines 144–152)

- ✅ All eight required sections present.
- ✅ Constants inventory cites file:line for every entry.
- ✅ Probes are one-variable-at-a-time.
- ✅ Success criterion is numeric (5–25% standard-preset completion).
- ✅ Blocker is real: re-running `sim:batch` this session produced identical 100% water-out finding.
