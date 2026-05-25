# HANDOFF — Supply recalibration Track 1 (cosmic-yeti)

**Date:** 2026-05-24
**Author:** Claude (Opus 4.7, 1M context)
**Predecessor scoping doc:** `SCOPING-supply-recalibration-2026-05-24.md`
**Plan executed:** `~/.claude/plans/you-are-the-next-cosmic-yeti.md`
**Status:** structural change shipped, section 6 bands **not met**, new finding requires Q9 next session.

---

## What shipped

Two commits, both local (no push):

1. **`efb32b5` — feat(sim): pin pre-recalibration baseline + traces/ regression dir**
   - New tracked `traces/` dir at repo root (sibling of gitignored `output/`).
   - `traces/baseline.jsonl` (144 runs, ngaru_bon→oravan slice) + `traces/baseline.summary.csv` + `traces/README.md`.
   - One-line pointer in `SIM-HARNESS-ROADMAP.md` (near "Repro" section).

2. **`0655517` — feat(sim): waypoint resupply + semi-arid tier + summer ration easing**
   - `web/src/utils/journey-supply.ts`:
     - New optional `resupplyAtDay?: (dayNum) => 'full' | 'water' | 'none'` parameter on `computeSupplyTimeline`. Tier applied *after* burn, *before* warning computation.
     - `SEMI_ARID_BIOMES = {Savanna, Scrubland}` → water × 1.25 (arid × 1.5 still wins when both present).
     - `seasonRationsMult.summer = 0.95` (3b probe 0 / Q5).
   - `scripts/sim/run-journey.ts`:
     - Exported `getResupplyTier(category)` helper (civ → full; port/oasis → water; everything else → none).
     - Builds `nameToTier` from `route.nodes`, derives `dayToTier` from `JourneyDay.campLabel` (handles both `Camp at <name>` and `Arrive at <name>`), passes the predicate.
   - Six new unit tests in `journey-supply.test.ts`. 571 → **577 passing**, no regressions.
   - `npx tsc --noEmit` clean. `npm --prefix web run build` clean.

The engine change is correct and additive — existing UI call sites (`SupplyConfig.tsx`, `JourneyDaysTab.tsx`) pass no predicate and see byte-identical behavior to pre-change.

---

## Section 6 bands NOT met — the finding

Post-fix `sim:batch` (4,320 runs, 3.1s):
```
completed:   0     (0.0%)   ← was 0.0% pre-fix
water_out:   4320  (100.0%) ← was 100.0% pre-fix
rations_out: 4312  (99.8%)  ← was 100.0% pre-fix
```

**Mechanism verified working** — inspected `caravan/summer/fastest/ngaru_bon→oravan`:
- Day 6: water = 12.9 (post-burn, leaving Ngaru Bon)
- Day 66: water = -13.5 (still mid-Highland-Steppe Corridor)
- Day 67: water = **14** (camped at Qollari, resupply restored to start+packBonus)

So resupply at civs works exactly as specified. The problem is **the gap between resupply nodes**, not the burn rate.

### Per-civ-pair longest single-leg gap (caravan, summer, direct mode, 14-day water capacity):

| From → To                  | Longest gap |
|----------------------------|------------:|
| oravan ↔ ngaru_bon         | **151 d**   |
| oravan ↔ ndjadi / irrah    | **151 d**   |
| kheshkai ↔ ndjadi          | **107 d**   |
| ndjadi ↔ qollari           | **97 d**    |
| ngaru_bon ↔ qollari        | **96 d**    |
| kheshkai ↔ irrah           | **59 d**    |

No 3b constants probe saves a 150-day leg. Even tripling caravan packBonus (14 → 42 water) doesn't survive 60-day legs.

### Why oases/ports don't help in v1

Per the scoping doc Q2, ports & oases were specified as `'water'`-tier resupply. They're correctly classified by `getResupplyTier`, but they **never appear on routes**:

- `journey-graph.ts:227-241`: each non-civ point feature gets exactly one edge — an `intra_civ` link to its **nearest civilization**.
- Trade routes are single edges connecting civ endpoints directly (no intermediate nodes from line geometry).
- Dijkstra finds civ-to-civ paths via the direct trade-route edge; an oasis side-spur is a strict detour, never a shortcut.

Result: a route from civ A to civ B passes through {A, B, possibly other civs as pivots}. Never through any port/oasis.

The differentiated-tier framework (civs full, ports/oases water-only) is *correct* and ready, but on the current graph topology the water-tier path has zero applicable nodes.

---

## What Q9 should resolve (next-session decision)

The structural read in scoping doc section 1 was right ("the world is too big, fix is resupply waypoints"). The Q2 tier list is right. What wasn't anticipated: **the graph topology has no resupply-eligible nodes on trade routes themselves.** Three plausible directions, each gets a real-design conversation:

### Option A — Insert intermediate trade-route nodes from line geometry
- `buildGraph` already iterates trade-route `LineString` vertices for distance (`journey-graph.ts:261-268`). Could expose every Nth vertex (or every vertex past some min-distance) as an anonymous "waypoint" node with category `'trade_waypoint'` and tier `'water'` (well-trafficked road = wells along the way).
- Pros: zero authoring; surfaces existing geojson detail.
- Cons: invents semantic nodes; many waypoints in arid stretches may not actually have water in fiction.

### Option B — Author new waypoint features in the geojson
- Add 1–3 new `oasis` / `caravanserai` / `way_station` Point features along the longest trade routes, deliberately placed. The `intra_civ` connection model needs extension — these would need to connect to *both* endpoints of a trade route as midpoint nodes.
- Pros: in-fiction; intentional placement; world-building leverage.
- Cons: requires `journey-graph.ts` change to handle midpoint connectivity, AND new authoring work.

### Option C — Accept v1 scope: only intra-civ trips complete
- Mark "long continental journeys" as out-of-scope until either A or B lands.
- 3b probe 1 (raise tight/standard water burn) becomes meaningful only when standard journeys can actually complete — currently they can't, so tuning the failure rate is moot.
- Phase 3 (Track 2) policies still blocked.

### My read (not a decision)

Option B is the most in-fiction and the least likely to cause emergent weirdness later. It also matches the GM model — wells, caravanserai, and trade-stops *are* a worldbuilding asset, not just a routing trick. Option A is faster but invents geography the worldbuilder didn't author. Option C honestly describes the v1 state but leaves Track 2 permanently blocked.

The 3b probes in the scoping doc (probe 1: shrink caravan packBonus; probe 2: chokepoint penalty) were designed to fine-tune AFTER resupply provided a survivable substrate. Neither makes sense on a graph where survival is topologically impossible.

---

## What did NOT happen (per scope)

- ❌ 3b probes 1–3 not applied. Constants can't bridge 150-day gaps; would burn a probe budget without learning anything.
- ❌ No engine forks beyond 3a (per scope and Q1).
- ❌ Q1 / Q2 not re-litigated (per user instruction).
- ❌ Track 2 (Phase 3 policies) not started (per user instruction and the predecessor handoff's "Phase 3 cannot meaningfully be built on this baseline" — still true).
- ❌ No push (per user instruction).
- ❌ No UI changes. The `SupplyConfig` and `JourneyDaysTab` panels pick up resupply automatically when called with the predicate, which the UI doesn't yet do — that's a follow-on.

---

## Verification of this handoff

- ✅ Both commits land cleanly. `git log --oneline -5`:
  ```
  0655517 feat(sim): waypoint resupply + semi-arid tier + summer ration easing
  efb32b5 feat(sim): pin pre-recalibration baseline + traces/ regression dir
  80801f2 feat(sim): Phase 2 batch runner + grid stats
  ```
- ✅ `npx tsc --noEmit` clean from `web/`.
- ✅ `npm test` → 577 / 577 pass.
- ✅ `npm --prefix web run build` clean.
- ✅ Baseline tracked at `traces/baseline.jsonl` + `traces/baseline.summary.csv`. README documents refresh policy.
- ✅ Sim mechanism verified by inspecting a specific trace (caravan/summer/fastest, ngaru_bon→oravan): resupply fires on day 67 at Qollari, water resets from -13.5 to 14.

---

## For the next session

1. **Read** `SCOPING-supply-recalibration-2026-05-24.md` for the Q1–Q8 decision context.
2. **Read** this handoff section "What Q9 should resolve" — three options, no decision.
3. **Ask Perry** which of A/B/C to pursue. The right answer probably depends on how much worldbuilder authoring he wants to do in this cycle.
4. **Do not** re-run baseline before deciding — the current `traces/baseline.*` is the right pre-change snapshot for whichever path is chosen.
5. **Do not** rerun 3b probes 1–3 until the topology question is settled; they're noise until then.
