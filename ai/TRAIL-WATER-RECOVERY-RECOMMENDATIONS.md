# Trail Water Recovery: Design Recommendations

**Project:** veydria-cartography / Trail mode  
**Date:** 2026-08-14  
**Context:** Post-feel-check findings (commit 9795d21). The feel-check drove 7 configs through the real Trail UI and found: water is the binding bottleneck, there is no recovery lever for it, and the result is grind-not-fun. This document synthesizes deep research across the Oregon Trail lineage, modern survival games, and design theory into concrete, implementable recommendations.

---

## Executive Summary

The central finding from the feel-check is correct: **water is monotonically decreasing with no recovery lever**, and hunt only restores rations. This creates a deterministic countdown, not a game. The fix is not to buff starting water or nerf burn rates — it's to add **meaningful water recovery mechanics** that give the player agency.

**Recommendation:** Implement a **tiered stack** of water recovery mechanics, starting with the smallest viable fix that reuses existing code architecture, then layering depth.

| Tier | Mechanics | Est. Effort | Impact |
|------|-----------|-------------|--------|
| **Tier 1 (MVP)** | Water-forage (parallel to hunt) + Stream refill points + Rest water recovery | ~1–2 days | Fixes death spiral; creates 3 distinct recovery vectors |
| **Tier 2 (Depth)** | Rain catchment + "Dig seep" desert Devil's Bargain + Companion water-finding | ~3–5 days | Adds planning depth, drama, and character investment |
| **Tier 3 (Polish)** | Hunt butchery (blood/marrow water) | ~1 day | Rewards attentive players with small optimization |

---

## 1. Diagnosis: Why Water Is the Binding Bottleneck

### The Math

With `DEFAULT_SUPPLY` = 6 water per person and a per-day burn of ~1.0 (base) × 1.5 (arid) = 1.5 water/day in desert biomes, a 6-day water supply runs out in **4 days** of arid travel. Since:

- `HUNT_ODDS` yields **rations only**, never water
- `rest` burns 1 water/day with no recovery (trail.ts signature wait: `waterLeft - 1`)
- `fort` resupply never triggered in 7 feel-check runs (~35 driven days)
- Signature choices carry `waterDelta` but in practice it's negative or zero

…the player has **zero levers** once water starts draining. The "hunt-when-low" policy is optimizing the wrong resource.

### The Design Theory Diagnosis

Per the MDA framework and Bouchard's Oregon Trail design philosophy, this creates a **negative feedback loop that rewards inaction**: the less the player does, the slower water depletes. The "optimal" strategy is to do as little as possible — which collapses into a single deterministic path. This is **toxic scarcity**, not engaging scarcity.

**Key insight from the Oregon Trail lineage:** The original 1985 game didn't actually track water as a discrete resource. Water was **implicit** — managed through river crossings, weather, and forts. The explicit water meter only appeared in Oregon Trail II (1995). The lesson: **the problem isn't that water is tracked explicitly; it's that there's no way to get it back.**

---

## 2. Recommended Solutions

Each solution is evaluated against four criteria: **(A)gency** (does the player have a meaningful choice?), **(F)it** (does it match the OT '88 feel Perry wants?), **(I)mplementation** (how much code?), and **(R)isk** (what could go wrong?).

---

### Solution 1: Biome-Gated Water Foraging (`FORAGE_WATER_ODDS`)

**What it is:** Add a `FORAGE_WATER_ODDS` table parallel to the existing `HUNT_ODDS`. When the player encounters a `hunt` pending, the choice becomes **three-way**: Hunt (food only), Forage (food + water), or Press on. Forage yields water scaled by biome (wet = high yield, arid = low yield).

**Why it works:** Reuses the exact `HUNT_ODDS` architecture. The pending system already surfaces `hunt` — we just add a new choice. The player now has a genuine three-way trade-off every time hunt fires.

**Specific code changes:**

```typescript
// In trail.ts, add parallel to HUNT_ODDS:
export const FORAGE_WATER_ODDS: Record<string, { chance: number; yield: number }> = {
  Savanna:   { chance: 0.85, yield: 5 },
  Forest:    { chance: 0.80, yield: 4 },
  Scrubland: { chance: 0.70, yield: 3 },
  Highland:  { chance: 0.60, yield: 2 },
  Desert:    { chance: 0.35, yield: 1 },
  Sabkha:    { chance: 0.25, yield: 1 },
  Steppe:    { chance: 0.55, yield: 2 },
  default:   { chance: 0.50, yield: 2 },
}

// In trail.ts trailAct, expand hunt pending to offer three choices:
// { kind: 'hunt', choices: [
//   { label: 'Hunt for food', /* rations roll */ },
//   { label: 'Forage for water', /* water roll */ },
//   { label: 'Press on', /* nothing */ }
// ]}

// In trailChoose, when pending.kind === 'hunt':
// choiceIndex 0 = Hunt (rations roll, existing)
// choiceIndex 1 = Forage (water roll, new)
// choiceIndex 2 = Press on (existing)
```

**A-F-I-R:** High Agency (three-way choice), Very High Fit (direct OT '85 extension), Low Implementation (~40 LOC), Low Risk (reuses proven architecture).

---

### Solution 2: Guaranteed Stream/River Refill Points

**What it is:** Add **guaranteed stream/river refill points** at specific mile markers along the route (not random encounters). These are not forts — no trading, no resting — just a brief stop choice. Some streams are contaminated (risk of ailment).

**Why it works:** The feel-check found **zero fort triggers** in all 7 runs. The route data has resupply nodes, but the medium/long routes never reach them before the water spiral finishes. Guaranteed stream points between waypoints create a **rhythm of small, frequent decisions** rather than rare, massive fort events.

**Specific code changes:**

In `journey-days.ts` or `journey-graph.ts`, the route data already has edges with segment lengths. We can add a `streamPoints` array to the route generation or compute them from edge midpoints that cross known water features.

A simpler approach: add a new `TrailPending` kind:

```typescript
// In trail.ts, add to TrailPending:
| { kind: 'stream'; waterAmount: number; contaminated: boolean }

// In trailAct, when advancing a day, check if the day's edges cross a stream point:
// (computed from edge midpoint + geojson water feature lookup, similar to biomeForEdge)
// If so, surface { kind: 'stream', waterAmount: 15, contaminated: Math.random() < 0.25 }

// In trailChoose, when pending.kind === 'stream':
// choiceIndex 0 = "Refill barrels" (+waterAmount water, -0.5 days)
// choiceIndex 1 = "Boil and refill" (+waterAmount water, -0.75 days, safe)
// choiceIndex 2 = "Push on without stopping" (no change)
```

The contamination mechanic maps to the existing `pickAilment` system — `contaminated` → roll for ailment (e.g., 'river-murrain') on the next health step.

**A-F-I-R:** High Agency (time vs. water trade-off), Very High Fit (river crossings were the OT '85 signature mechanic), Medium Implementation (~80 LOC), Medium Risk (requires route geometry + geojson water feature lookup).

---

### Solution 3: Rest-to-Recover Water (`campSpring`)

**What it is:** When the party rests, they recover a small amount of water (finding a camp spring, melting frost, collecting dew from canvas). Base: +3 water, scaled by biome aridity (wet = +5, arid = +1). No new UI needed — the existing `rest` action in `journey-days.ts` already exists.

**Why it works:** Rest is currently a trap — it burns water without recovering it. In the OT '85, resting improved health. Here, resting should also provide a small water recovery, making it a **genuine third option** in the daily decision triangle (travel vs. hunt vs. rest) rather than "the thing you do when you can't hunt."

**Specific code changes:**

In `journey-days.ts`, the `nextDay` function handles `Action = { kind: 'rest' }`. The burn modifiers for rest are `{ rations: 0, water: 1 }` (already exists). We add a **water recovery bonus** before the burn:

```typescript
// In journey-supply.ts, add a camp spring recovery function:
export function campSpringRecovery(
  aridity: AridityLevel,
): number {
  if (aridity === 'none') return 5
  if (aridity === 'semi-arid') return 3
  return 1 // arid
}

// In journey-days.ts nextDay, when action.kind === 'rest':
// const springWater = campSpringRecovery(aridity)
// waterLeft = Math.min(waterLeft + springWater, ceilWater)
// then apply normal rest burn
```

**A-F-I-R:** Medium Agency (rest now has a genuine benefit), Very High Fit (literally what OT '85 did — rest improved recovery), Very Low Implementation (~20 LOC), Low Risk.

---

### Solution 4: Weather-Triggered Rain Catchment

**What it is:** The existing weather system already generates rain/storm/snow. When precipitation occurs, the party's wagon barrels automatically collect water. If the player chooses to **camp in the rain** (instead of pushing on), they gain a bonus +50% catchment.

**Why it works:** Leverages the existing weather system that currently has no mechanical connection to water. Creates **dramatic relief** — a storm after 5 days of desert travel is a genuine moment of salvation. Adds **planning depth** via a weather forecast in the morning brief.

**Specific code changes:**

In `journey-days.ts`, the `nextDay` function already receives `weather` as part of the day state. We add a catchment step:

```typescript
// In journey-supply.ts, add:
export const WEATHER_CATCHMENT: Record<WeatherType, number> = {
  clear: 0,
  cloudy: 0,
  rain: 2,
  storm: 4,
  snow: 1,
  // ... etc
}

// In journey-days.ts nextDay, before burn:
// const catchment = WEATHER_CATCHMENT[weather] * (action.kind === 'camp-rain' ? 1.5 : 1.0)
// waterLeft = Math.min(waterLeft + catchment, ceilWater)
```

A new `Action` kind: `{ kind: 'camp-rain' }` — only available when weather is rain/storm. In the Trail UI, this surfaces as a third choice when `hunt` pending is available: "Hunt / Forage / Camp in the rain."

**A-F-I-R:** High Agency (push through vs. camp for bonus), High Fit (Bouchard explicitly intended weather to affect water), Low Implementation (~60 LOC), Medium Risk (weather RNG must be tuned to matter but not guarantee survival).

---

### Solution 5: "Dig Seep" Desert Devil's Bargain

**What it is:** In arid biomes when water drops below a threshold (e.g., ≤ 2 days' supply), trigger a **signature encounter**: "The ground is cracked and dry. You could dig for a seep, but it might cost you a day for nothing." Choices: dig (1 day, 65% chance +8 water, 35% nothing + exhaustion) or push on (0 days, but risk dehydration).

**Why it works:** It's a **pure risk/reward choice with stated odds** — exactly the OT '85 river-crossing design philosophy (geography-specific, high-stakes, no guaranteed safe option). The existing `SIGNATURE_CHOICES` + `EncounterChoice` architecture already supports this.

**Specific code changes:**

```typescript
// In encounters.ts or trail-content.ts, add a new signature beat:
export const SIGNATURE_CHOICES = {
  // ... existing beats ...
  digSeep: [
    {
      label: 'Dig for a seep',
      outcome: {
        narrative: 'The party digs for a seep.',
        daysDelta: 1,
        waterDelta: 8, // applied 65% of the time via a seeded roll
        // 35%: no water, +1 severity on next health step (exhaustion)
      },
    },
    {
      label: 'Push on and pray',
      outcome: {
        narrative: 'The party presses on.',
        daysDelta: 0,
        waterDelta: 0,
        // risk: if water reaches 0 before next resupply, dehydration damage
      },
    },
  ],
}

// In trail.ts signatureForDay, add a check:
// If aridity === 'arid' AND waterLeft <= 2 (or some threshold), 
// inject digSeep as the signature for the day.
```

**A-F-I-R:** High Agency (pure risk/reward), Very High Fit (river-crossing philosophy), Low Implementation (~50 LOC), Low Risk (uses existing encounter architecture).

---

### Solution 6: Companion Water-Finding Skill ("Luisa's Spring")

**What it is:** If the Trail mode supports companions (future feature), a companion with water-finding skill (e.g., an indigenous guide) provides a **passive bonus** to forage water yields and a **15% chance per day** of a free "found a spring" event (+10 water, 0 days) when water is low.

**Why it works:** Makes companion choice **mechanically meaningful** for survival, not just narrative. The player must decide: do you bring the water-finder (safety) or the fighter (encounter protection)? This is a **preparation decision** — classic loadout optimization.

**A-F-I-R:** High Agency (companion choice matters), Moderate Fit (OT '85 had named family members but they were mechanically identical; this is a modern evolution), Low Implementation (~40 LOC), Medium Risk (only works if companion system exists).

**Note:** This is a **Tier 2** solution because it depends on companion infrastructure that may not exist in Trail v1.

---

### Solution 7: Hunt Butchery (Blood/Marrow Water)

**What it is:** When a hunt succeeds, add a **post-hunt choice**: "Take meat only" (fast, no water) vs. "Render blood and marrow" (+2 water, +0.5 days). Large game (buffalo/oryx) yields +4 water and +1 fuel but costs +1 day.

**Why it works:** Creates a **speed vs. resource optimization** trade-off that depends on the current state of all resources (food, water, time, fuel). The correct answer is situational, not universally optimal.

**A-F-I-R:** High Agency (post-hunt speed vs. resources), Moderate-High Fit (extends the hunting loop, which Bouchard called "the principal appeal"), Low Implementation (~50 LOC), Low Risk.

**Note:** This is a **Tier 3** solution — a small optimization reward for attentive players. It doesn't fix the death spiral, but it adds texture.

---

## 3. Implementation Roadmap

### Phase 1: Fix the Death Spiral (Tier 1 only)

**Goal:** Water should no longer be monotonically decreasing. A successful playthrough should show **at least 3 recovery peaks**.

**Changes:**

1. **Add `FORAGE_WATER_ODDS`** to `trail.ts` (parallel to `HUNT_ODDS`).
2. **Expand hunt pending to three choices** in `trailAct`: Hunt / Forage / Press on.
3. **Add stream refill logic** to `trailAct` or `journey-days.ts`: check if day's edges cross a stream point, surface a `stream` pending.
4. **Add `campSpringRecovery`** to `journey-supply.ts` and wire it into `nextDay` for `rest` action.
5. **Add `digSeep` signature encounter** to the encounter registry, gated by aridity + low water.

**Estimated total:** ~120–150 LOC across `trail.ts`, `journey-supply.ts`, `journey-days.ts`, and `encounters.ts`.

**Verification:** After implementation, re-run the feel-check script. The water trajectory should show **recovery peaks** (not monotonic decline). The "medium route" (previously died day 5) should survive to arrival with skilled play.

### Phase 2: Add Depth (Tier 2)

**Goal:** Make weather and companions matter. Create planning depth and drama.

**Changes:**

1. **Add `WEATHER_CATCHMENT`** to `journey-supply.ts`.
2. **Add `camp-rain` action** to `Action` union and `nextDay` handler.
3. **Add weather forecast** to morning brief UI.
4. **Add companion water-finding skill** (if companion system exists).

### Phase 3: Polish (Tier 3)

**Goal:** Add texture and reward attentive play.

**Changes:**

1. **Add hunt butchery step** to `trailChoose` hunt resolution.

---

## 4. Balance Targets

After implementing Tier 1, the following invariants should hold:

| Metric | Before (Current) | After (Target) |
|--------|------------------|----------------|
| Water trajectory | Monotonic decline | At least 3 recovery peaks in a successful run |
| Medium route survival (standard supply) | 0% (dies day 5) | 40–60% with skilled play |
| Short route survival | 100% (trivial) | 80–90% (still forgiving) |
| Long route survival | 0% (dies day 9) | 20–40% (genuinely hard) |
| "Hunt-when-low" policy effectiveness | 0% (optimizes wrong resource) | Meaningful (now optimizes rations, forage optimizes water) |
| Action entropy | ~1.0 (only one viable choice) | >1.5 (at least 2 distinct strategies regularly used) |
| Fort/stream trigger rate | 0% | 2–4 stream points per medium route |
| Recovery lever count | 0 | 3+ (forage, stream, rest, digSeep) |

---

## 5. What NOT to Do

Based on the research, these approaches are **not recommended**:

| Don't | Why |
|-------|-----|
| **Buff starting water** (e.g., 6 → 10) | Just extends the countdown; doesn't add agency. The feel-check already showed 12/6 and 6/6 died on the same day because rations don't matter. |
| **Nerf water burn rate** | Same problem — longer countdown, no choices. |
| **Add a "find water" button** | A button with no trade-off (no time cost, no risk) is not a choice. |
| **Make hunt restore water too** | Collapses the two-resource economy into one. The tension between rations and water is the core of the design. |
| **Make forage a separate action** (not a hunt-branch) | Adds UI complexity without adding meaningful choice. The three-way branch is cleaner. |
| **Add random rain events with no player response** | Passive recovery fails the "meaningful choice" test (no awareness, no consequence). |

---

## 6. Appendix: How the Original Oregon Trail Handled Water

| Game | Water Treatment | Key Levers | Lesson for Veydria |
|------|-----------------|------------|-------------------|
| **OT 1971** | Implicit — abstracted into food | Hunt, forts, eat well | Water can be implicit, but then it can't be the binding bottleneck |
| **OT 1985** | Semi-implicit — spatially contextual via rivers & weather | River crossings (ford/caulk/ferry), rest, forts, weather | **The river crossing is the iconic OT decision.** Geography-specific, high-stakes, condition-dependent. |
| **OT II 1995** | Explicit — canteens, water kegs, "No Water" zones | Buy canteens before departure, reach rivers/springs, rest | Preparation drama and spatial risk work well together. |
| **OT 2021** | Event-driven — thirst events, contaminated water | Medicine, rest, camps, trade | Narrative event structure makes water problems feel like story moments, not meter drains. |
| **Organ Trail** | Fuel (water equivalent) | Scavenge, trade, jobs, car upgrades | Active recovery (scavenging minigame) is more engaging than passive recovery. |

**The synthesis:** Veydria should combine the **OT '85 river-crossing philosophy** (geography-specific, high-stakes decisions) with the **OT II preparation drama** (canteens/water skins) and the **OT 2021 event structure** (narrative thirst events with cascading consequences). The modern survival game lesson is that **active recovery** (foraging, scavenging, crafting) is more engaging than passive recovery.

---

## Sources

1. **Bouchard, R. Philip** — "You Have Died of Dysentery: Exploring The Oregon Trail's Design History" (format.com/magazine, 2025). Primary source from the 1985 lead designer.
2. **Bouchard, R. Philip** — "Imagining the New Design" (philipbouchard.com/oregon-trail). Design retrospective on the 21 innovations.
3. **Brice, Matt** — "Meaningful Choice in Games: Practical Guide & Case Studies" (Gamasutra, 2013). Four components of meaningful choice.
4. **Hunicke, LeBlanc, Zubek** — "MDA: A Formal Approach to Game Design" (2004). Mechanics-Dynamics-Aesthetics framework.
5. **Oregon Trail II Wiki (Fandom)** — "Thirst" page. Documents canteens, water kegs, and "No Water" zones.
6. **Entertainium** — "The Oregon Trail Is A Lovely Reimagining" (2022). Reviews 2021 remake water/cholera events.
7. **Organ Trail Wiki (Fandom)** — "Supplies" and "Strategies" pages. Documents fuel/food/scavenging mechanics.
8. **The Gemsbok** — "A Mechanical Critique of Darkest Dungeon" (2020). Stochastic recovery mechanics.
9. **Subsurface Games** — "Spicing Up Your Resource Management" (2022). Resource-specific mechanical identities.
10. **The Long Dark Wiki** — "Cooking" and "Melting Snow/Boiling Water" pages. Two-step water recovery pattern.

---

*End of recommendations. Ready for implementation when Perry gives the go-ahead.*
