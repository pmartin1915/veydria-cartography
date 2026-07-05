# Oregon Trail '88 mode — Veydria skin (spec)

Status: **specced, not built.** Architecture settled 2026-07-01 (Opus session).

## Goal

A dedicated game mode that emulates the **1988 Oregon Trail** 1:1 in loop and feel, reskinned
with Veydria lore: named party members who sicken and die, illness events, river crossings,
hunting, fort trading, grave markers with one-sentence epitaphs, and a final score/rank screen.

This is a **sibling** to Passage mode — same frozen engine under the hood, completely different
feel. Passage = A Dark Room × choice cards. Trail = scrolling side-view × named deaths ×
hunting × capricious attrition.

---

## Core architectural decision — why Shallow is the ONLY option

The supply engine (`journey-supply.ts`) is **per-capita and aggregate**: burn is
per-person-per-day, `party.size` is cosmetic (only read in `describeParty()`). In a per-capita
model, losing a party member **leaves supply-runway unchanged or improves it** — there is no
per-capita variant where losing a person costs supply-days. Therefore per-member death *cannot*
be a supply mechanic without rewriting the engine. The "Shallow" model is not a v1 shortcut;
it is the only coherent approach that keeps the engine frozen.

Member health is a **parallel narrative + scoring layer** riding alongside an untouched
`JourneyState`, exactly as Passage's choice/scar/extraDays layer does.

**`journey-days.ts` and `journey-supply.ts` are NOT modified by this feature. Not one line.**

---

## Seeding

Death/illness rolls are **seeded** (not true-random). True-random would break the
`sim:passage` counterfactual harness — outcome deltas could no longer be attributed to choices
vs RNG. Same reason `passage.ts` deferred probabilistic grave-risk.

Seed design — **per-run seed** (each new playthrough differs; any single run stays replayable
and sim-forkable):

- `initTrail` takes a `runSeed: number` as an input. `trail.ts` itself is **pure** — no
  `Date`/`Math.random` anywhere in the module.
- The **UI** supplies entropy: `runSeed = Date.now() >>> 0` (or `crypto.getRandomValues`).
- The **sim harness** passes a fixed seed for reproducible forks.
- Per-member death/illness roll: `mulberry32(runSeed ^ routeSeed ^ (day * 1000) ^ memberIdx)`.
  Mixing `routeSeed` (a pure function of route+season+mode) with `runSeed` means two runs on
  the same route differ; one run stays byte-identical when given the same seed.

---

## Type definitions (`web/src/utils/trail.ts`)

```ts
import type { JourneyState } from './journey-days'
import type { EncounterChoice } from './passage'  // reuse existing choice interface

// ── Member roster ──────────────────────────────────────────────────────────

export type Health = 'well' | 'ill' | 'very ill' | 'dead'

// Ordinal used in stepMemberHealth; DO NOT reorder.
const HEALTH_ORDER: Health[] = ['well', 'ill', 'very ill', 'dead']

export interface TrailMember {
  id: string          // stable slot id, e.g. 'm0' .. 'm4'
  name: string        // canon Veydrian name (linguistics morphemes only)
  civ: string         // CIV key — flavors ailments, epitaphs, final rank label
  role?: string       // cosmetic tag: 'scout' | 'porter' | 'merchant' | …
  health: Health
  ailment?: string    // current Veydrian disease name while ill/very-ill
                      // e.g. 'salt-sickness', 'dune-cough', 'river murrain'
  diedDay?: number    // set once, never overwritten; undefined while alive
  epitaph?: string    // one-sentence grave text, set at death, e.g.:
                      // "Sera died of salt-sickness on the Sabkha Corridor. Day 11."
}

// ── Trail state ────────────────────────────────────────────────────────────

export type TrailOutcome =
  | 'in-progress'
  | 'arrived'      // reached destination (≥1 member alive)
  | 'aborted'      // player used turn-back action
  | 'perished'     // supply debt floor: rationsLeft ≤ PERISH_RATIONS_FLOOR
                   //                  or waterLeft  ≤ PERISH_WATER_FLOOR
                   // (reuse Passage constants: -6 / -3)
  | 'party-wiped'  // NEW: every member dead, orthogonal to supply
                   // checked independently each day after health steps

export type TrailPending =
  | { kind: 'signature'; key: string; choices: EncounterChoice[] }
  // ^ reuse SIGNATURE_CHOICES registry from passage.ts (ford, bandits, etc.)
  | { kind: 'ford' }   // river crossing — fires existing 'ford' signature beat
  | { kind: 'hunt' }   // biome-gated dice-roll; v1 = no animation (see below)
  | { kind: 'fort' }   // waypoint resupply / trade screen

export interface TrailState {
  journey: JourneyState              // frozen engine state — never bypassed
  members: TrailMember[]             // parallel roster (load-bearing for scoring)
  runSeed: number                    // captured at initTrail; stored for harness replay
  log: string[]                      // terse day/event lines ("Day 8 — Sera is ill.")
  pending: TrailPending | null       // non-null: UI must resolve before advancing
  outcome: TrailOutcome
  signatureCounts: Record<string, number>  // per-key call count → prose variation
}
```

---

## Health transition — `stepMemberHealth`

One pure function, the core mechanic. Exact probability constants are
**sim-calibrated** (like `modeBurnMultipliers` in `journey-supply.ts`) and live in the
implementation, not the spec — but the invariants are spec-level:

```ts
interface HealthPressure {
  severity: 0 | 1 | 2    // day's worst encounter beat: none | moderate | severe
  supplyStress: 0 | 1 | 2 // from JourneyState warnings: low=1, out=2 (max of rations/water)
  arid: boolean            // classifyAridity(day) === 'arid'
  atFort: boolean          // camping at a resupply waypoint this day
}

function stepMemberHealth(
  current: Health,
  roll: number,   // [0, 1) — caller computes from the per-run seeded RNG
  p: HealthPressure,
): Health
```

### Invariants (all mandatory — not implementation details)

1. **Graduated only.** At most **one step** per day in either direction; never `well → dead`
   in a single day. This gives the player a recoverable window (rest, reach a fort).
2. **Bidirectional.** `worsenChance` rises with `severity`, `supplyStress`, and `arid`.
   `healChance` is positive only on a **clean day** (`severity === 0 && supplyStress === 0`)
   and is boosted by `atFort`. Neglect trends toward death; rest + supply + forts reverse it.
3. **Death is a roll, not automatic.** `very ill → dead` fires only when the roll exceeds the
   worsening threshold. A `very ill` member on clean days has real (not negligible) healChance.
4. **`dead` is absorbing.** `stepMemberHealth('dead', …) === 'dead'` always.
5. **`diedDay` and `epitaph` are set once on the turn health first reaches `dead`** and are
   never overwritten. Epitaph format: "\_Name\_ died of \_ailment\_ at/near \_location\_. Day N."
6. **NOT monotonic attrition.** Recovery is deliberate v1 design. Do not "simplify" to
   one-way degradation.

---

## Terminal states and scoring

Terminal checks run each day **after** all member health steps and after the supply floor check:

```ts
// 1. Supply floor (same as Passage)
const PERISH_RATIONS_FLOOR = -6
const PERISH_WATER_FLOOR = -3
if (journey.rationsLeft <= PERISH_RATIONS_FLOOR || journey.waterLeft <= PERISH_WATER_FLOOR)
  → outcome = 'perished'

// 2. Party wipe (new, orthogonal — you can party-wipe with supply remaining)
else if (members.every(m => m.health === 'dead'))
  → outcome = 'party-wiped'

// 3. Arrival
else if (journey.outcome === 'arrived')
  → outcome = 'arrived'
```

### Final score/rank

```ts
interface TrailScore {
  survivors: number        // members.filter(m => m.health !== 'dead').length
  daysElapsed: number      // journey.dayNum at terminal
  supplyMargin: number     // journey.rationsLeft + journey.waterLeft (can be negative)
  rank: string             // civ-appropriate label from CIV_LABELS (compendium-data.ts)
                           // e.g. "Trail Warden", "Dune Walker", "Dust-Blown Pilgrim"
}

function scoreTrail(state: TrailState): TrailScore
```

The view layer consumes a `TrailScore` object — it does not re-derive the score from raw state.
The exact rank-label thresholds and civ-label strings are implementation details; the
**structure** is spec-level.

---

## Public API (mirrors `passage.ts`)

```ts
interface InitTrailOpts {
  journeyOpts: Parameters<typeof initJourneyState>[0]  // same opts as Passage
  members: Pick<TrailMember, 'id' | 'name' | 'civ' | 'role'>[]  // 2–5 members
  runSeed: number   // caller supplies; UI = Date.now()>>>0, harness = fixed
}

export function initTrail(opts: InitTrailOpts): TrailState

export function trailAct(state: TrailState, action: Action): TrailState
// action = continue | rest | force-march | ration | reroute | turn-back
// On 'continue': step all living members' health, append log lines for changes/deaths,
//               surface any pending (signature / ford / hunt / fort).
// Mirrors passageAct.

export function trailChoose(state: TrailState, choiceIndex: number): TrailState
// Resolve the current pending; mirrors passageChoose.
// Clamps rationsDelta to resupply ceiling (same as passageChoose):
//   nextRations = Math.min(rationsDelta > 0 ? ceilRations : Infinity, nextRations)
// IMPORTANT: hunting adds rations via rationsDelta, but is clamped to the ceiling —
// v1 cannot stockpile above starting cap. This is correct behaviour, not a bug.

export function zeroTrailSignatureCosts(journey: JourneyState): JourneyState
// Same semantics as zeroSignatureCosts in passage.ts — zero the engine's baked
// encounter cost so the CHOICE owns 100% of supply movement.

export function currentTrailNodeIndex(state: TrailState): number
// Same as currentNodeIndex in passage.ts.
```

---

## Frozen-engine confirmation — OT actions on existing channels

No new engine primitives are needed:

| OT '88 action  | Veydria mechanism                                                        |
|----------------|--------------------------------------------------------------------------|
| Hunting        | `rationsDelta > 0` via `trailChoose` — clamped to resupply ceiling       |
| Fort trade     | `rationsDelta` / `waterDelta` via `trailChoose` on `pending.kind='fort'` |
| River crossing | Fires existing `'ford'` key in `SIGNATURE_CHOICES` (passage.ts)          |
| Pacing choice  | Existing `Action.kind` values: `rest` / `force-march` / `ration`         |
| Illness beat   | `stepMemberHealth` in `trailAct` (new logic, but no engine mod needed)   |

---

## OT → Veydria content hooks (not fully authored yet)

These feed the event card and death-notification screens. Author once the view layer is
specced; canon ratification can follow separately.

| OT original        | Veydrian equivalent                                              |
|--------------------|------------------------------------------------------------------|
| Dysentery          | River murrain / salt-sickness                                    |
| Typhoid            | Harmattan collapse / dune-fever                                  |
| Cholera            | Sabkha sickness                                                  |
| Exhaustion         | Sun-debt / heat-binding                                          |
| Broken leg         | Scarp-fall / draft-animal thrown                                 |
| Measles            | Sandpox (Oravan civ variant)                                     |
| Snake bite         | Scorpion clutch / viper-step                                     |
| Fort (supply stop) | Waypoint settlement (veydria-geography.json `point` features)    |

Epitaph template (one sentence, no poetry): "\_Name\_ died of \_ailment\_ \_location phrase\_. Day N."

---

## Hunting mini-game (v1: dice-roll)

```ts
// When pending.kind === 'hunt', trailChoose resolves it:
// biome → successChance → rationsDelta (clamped to ceiling)

const HUNT_ODDS: Record<string, { chance: number; yield: number }> = {
  Savanna:    { chance: 0.70, yield: 3 },
  Forest:     { chance: 0.60, yield: 3 },
  Scrubland:  { chance: 0.50, yield: 2 },
  Highland:   { chance: 0.40, yield: 2 },
  Desert:     { chance: 0.20, yield: 1 },
  Sabkha:     { chance: 0.15, yield: 1 },
  Steppe:     { chance: 0.45, yield: 2 },
  default:    { chance: 0.30, yield: 2 },
}
// Roll uses the seeded RNG (not Math.random).
// A hunting animation is NOT in v1 scope. The view layer resolves hunt as a
// two-choice card: "Hunt" (resolve the roll) | "Press on".
```

---

## Entry point (view layer — out of scope this session)

`JourneyResults → "Set out"` will gain a **mode selector: Passage | Trail**. Trail launches
`TrailMode.tsx` — a sibling to `PassageMode.tsx`. Scrolling landscape reuses `TravelVignette.tsx`
backdrops and silhouettes. This UI is the `/orchestrate` (Kimi) chunk; spec it once `trail.ts`
exists and is verified.

---

## Out of scope (v1)

- Multiplayer / shared session
- Worldbuilder canon ratification of new ailment names *(author first, ratify separately)*
- Hunting animation *(dice-roll only)*
- Saving a Trail run to the campaign log *(Passage does this; Trail can add it later)*
- Per-member hunger ("Full" model) — explicitly rejected; incoherent under per-capita supply
- Any modification to `journey-days.ts` or `journey-supply.ts`

---

## Build sequence

1. ✅ **Spec** — this file (2026-07-01)
2. **Engine shim** — implement `web/src/utils/trail.ts` + unit tests; wire into sim harness
   for probability constant calibration. Verification: `npx tsc` clean; identical `runSeed` →
   identical run; existing Passage/Atlas traces byte-unchanged.
3. **View layer** — via `/orchestrate` (Kimi): `TravelVignette`-based scrolling landscape, day
   panel, event/choice cards, death + grave-marker screen, fort trade, hunt card, final score
   screen. Spec that session once the shim is verified.
4. **Content** — Veydrian ailment names + epitaph templates by civ (see content hooks above).
