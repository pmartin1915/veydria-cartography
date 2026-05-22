# Sim harness — AI-playable test bench for Veydria's journey mechanic

**Created:** 2026-05-22
**Owner:** Perry (and an LLM "player")
**Why this exists:** The journey planner has accumulated enough mechanics — pace, mount, party size, forced march, rations, water, encumbrance, pack animals, seasons, weather rolls, encounters, calendar events, fog of war — that "does it feel right?" is no longer a one-session question. A harness that lets an AI drive thousands of journeys with controlled inputs gives us actual signal on math correctness, progression speed, difficulty curve, and (with policies) decision-space quality.

---

## North star

> Given any (start, end, party, supply, season, route mode, departure day), the harness produces a reproducible per-day trace, and a batch runner produces enough traces that we can answer "what fraction of plausible campaigns succeed without supply outage?" "where on the map is the engine too punishing or too generous?" "which decisions actually matter?" — without sitting at the table.

The harness is **read-only against the journey engine**. It calls the same pure utils the UI calls (`buildGraph`, `findRouteWithFallback`, `buildDailyBreakdown`, `computeSupplyTimeline`, `generateEncounters`). It does not fork them. Whatever the harness measures is what a real GM would experience.

---

## Phase 1 — Single-journey trace (this cycle's deliverable)

**Output:** `scripts/sim/sim-journey.ts` — a CLI that takes inputs as flags, composes the existing utils, and prints a single JSON trace to stdout.

**Trace contents:**
- `inputs`: the resolved params
- `route`: `{ totalKm, estimatedDays, nodes[], edges[], bottlenecks, seasonalWarnings, pivots[] }`
- `days[]`: one row per day with `{ dayNum, kmCovered, weather, encounters[], calendarEvents[], notable[], rationsLeft, waterLeft, warning }`
- `summary`: derived metrics — `{ encountersTotal, encountersByType, encountersBySeverity, rationsOutDay, waterOutDay, completed, daysCount }`

**What this proves:**
1. The journey utils compose cleanly outside the browser (already confirmed via the import probe).
2. The data model is rich enough to answer the next phase's questions without engine changes.
3. A reproducible baseline trace exists that any future cycle can diff against (regression detection comes free).

**Out of scope for Phase 1:** statistical aggregation, multiple runs, decision policies, UI driving.

---

## Phase 2 — Batch runner + stat summaries

**Output:** `scripts/sim/sim-batch.ts` — iterates a parameter grid and emits two artifacts.

**Default grid (configurable):**
- Every (civ start, civ end) pair where start ≠ end (~30 ordered pairs for 6 civs)
- All 4 seasons × all 4 modes (16 settings)
- 3 supply presets: `tight` (3-day rations, 2-day water), `standard` (default), `caravan` (with pack animals)
- 3 party presets: `light-fast` (small, fast pace), `standard`, `heavy-slow` (large, slow, heavy encumbrance)
- That's ~30 × 16 × 3 × 3 ≈ 4,300 journeys per full run

**Artifacts:**
- `traces.jsonl` — one full trace per line (compact). Reusable input for any later analysis.
- `summary.csv` — one row per run with the headline metrics (`days`, `rationsOutDay`, `waterOutDay`, `encountersTotal`, `completed`, the supply/encounter/severity rollups, and all input params as columns). Pivots in Excel/Polars/duckdb in seconds.

**What this proves / answers:**
- Math correctness: any run that produces `NaN`, negative days, or impossible routes shows up immediately.
- Progression speed: histogram of `days` reveals whether the average campaign is a session or a season.
- Supply pressure calibration: what fraction of standard runs hit `rations-out` or `water-out`? If it's near 0% the model is toothless; if near 100% it's tyrannical. Target band is probably 5–25% for the standard preset.
- Difficulty heatmap: pivot success rate by (start, end). Pairs that always fail at standard supply are mechanic-broken, not story-interesting.
- Encounter density: encounters per day, by season and biome. Surfaces the "this route is just one rest stop" or "every day is a fight" cases.

**Effort:** ~150 lines on top of Phase 1.

---

## Phase 3 — Policies ("play as the character")

**The shift:** Phases 1–2 observe what the engine emits. Phase 3 introduces *decisions* — at the start of each day, an agent picks an action that can change the outcome.

**Engine work this requires** (the only non-trivial bit of the roadmap):
- A step-based wrapper around `buildDailyBreakdown` that exposes `nextDay(state, action) → { state, dayOutcome }`. The current API is a "compute the whole itinerary up front" function; we need to be able to interleave a decision between days.
- Either re-implement buildDailyBreakdown's per-day loop in the harness (reusing its helpers) or expose its loop body as a named export. Recommend the latter — the helpers (`locateAtDay`, `campLabelAt`, `notableForDay`, `rollWeather`) are already pure.

**Policy interface:**
```ts
type Action =
  | { kind: 'continue' }
  | { kind: 'rest' }                  // burn a day, no progress, no rations consumed
  | { kind: 'force-march' }           // 2x ration / 1.5x water burn, +25% distance
  | { kind: 'ration' }                // half ration burn, but day adds 1 exhaustion
  | { kind: 'reroute', mode: RouteMode } // re-Dijkstra from current position
  | { kind: 'turn-back' }             // outcome = 'aborted-day-N'

type Policy = (state: JourneyState, options: Action[]) => Action
```

**Baseline policies:**
- `naive` — always `continue`. Establishes the "no agency" baseline.
- `greedy-speed` — force-march unless supply warning, then ration.
- `risk-averse` — rest whenever weather is severe; ration at first low-warning; turn back if both rations and water are critical.
- `human-like` — turns back if outcome looks unrecoverable; force-marches the last 2 days if close.

**What this proves / answers:**
- Decision-space quality: outcome variance across policies, holding inputs constant. Low variance → decisions don't matter (boring). Sky-high variance → decisions are coin flips (frustrating).
- Mechanic mastery curve: spread between `naive` and `human-like` survival rates on hard combos. A 5% spread means the player has nothing to learn. A 60% spread means there's a real skill ceiling.
- Mechanic dead-ends: actions that never appear in any winning policy's traces (e.g. if no policy ever picks "ration", remove the affordance or buff it).

**Effort:** ~300 lines + ~50 lines of engine refactor.

---

## Phase 4 — Decision-space metrics for "fun"

Phase 3 produces traces under policies. Phase 4 mines those traces for the fun question.

**Metrics:**
- **Pivot day frequency:** what fraction of journeys have at least one day where the *optimal* action differs from the *easy* action? Those are the moments a player makes a choice that feels real.
- **Surprise rate:** days where an encounter or weather roll changes the optimal action mid-leg vs. days that play out as expected.
- **Recovery distance:** when a player makes the wrong call on day N, how many later days does it take to recover (vs. become unrecoverable)? Short recovery = forgiving. No recovery = punishing.
- **Mode regret:** for each (start, end), the survival-rate gap between the chosen route mode and the best one. High regret means the mode picker is doing real work; near-zero means modes are cosmetic.

**Output:** a single markdown report (`sim-fun-report.md`) the GM can read in 10 minutes and decide what to tune.

**Effort:** ~200 lines, mostly aggregation.

---

## Phase 5 — UX feedback loop (optional, low priority)

Phase 4 identifies the journeys where decisions matter most. Phase 5 drives Playwright to those exact planner states (via deeplink) and screenshots the relevant decision UI. We then audit: is the information the policy used actually surfaced in the planner panel? Are warnings visible? Are alternatives one click away?

**Why low priority:** the audit cycle that just shipped showed Playwright on this app is doable but expensive. Better to wait until Phases 2–4 have flagged specific decision points worth a UX pass.

---

## Cross-cutting decisions

- **TS imports.** vite-node (already a transitive devDep via vitest) handles `.ts` imports from `web/src/utils/...` without compilation. No new dependency. Scripts live at `scripts/sim/` (repo root), mirroring the existing `scripts/sync-world-data.mjs` pattern.
- **Repro.** Every trace embeds its input params. The journey utils are already seeded from `(route + season + mode)`, so two runs with the same params produce identical traces — Phase 1 commits a baseline `traces/baseline.jsonl` for regression detection.
- **No engine forks.** If a metric needs new data, the right move is to add it to the engine output, not duplicate logic in the harness. The whole value here is that the harness measures what the player experiences.
- **Refactor known to be needed:** `GeoJSONFeature` / `GeoJSONCollection` should move out of `App.tsx` to `web/src/types/geojson.ts`. The current shape works under vite-node only because both are interfaces (type-stripped at transform). Phase 3's engine wrapper is a fine moment to bundle this refactor.

---

## What success looks like

- Phase 1: I can run `npm run sim:journey -- --from ngaru_bon --to oravan --season summer` and get a complete trace back. (This cycle.)
- Phase 2: I can run `npm run sim:batch` and answer "what fraction of standard-preset journeys hit `water-out`?" in under a minute.
- Phase 3: I can run `npm run sim:batch -- --policy risk-averse` and compare survival rates across policies.
- Phase 4: I can read a 1-pager that tells me which two parameters most need balance work this week.
- Phase 5 (if reached): I can look at a flagged decision point in the planner and either confirm "yes, the player has the info they need" or open a UX ticket with a screenshot.
