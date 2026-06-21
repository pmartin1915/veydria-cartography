# Passage mode v1 — spec (journey-as-game)

Status: **specced, not built.** The crown of the experience-polish arc. Perry chose the **Hybrid** interactivity tier (2026-06-21).

## Goal
Turn the journey from a static, computed-up-front GM readout into a **lived, day-by-day crossing** with dread and small triumphs (Oregon Trail × A Dark Room × GoT). Atlas mode plans the route; **Passage mode plays it.**

## Core insight (don't lose this)
The play-loop machinery already exists and is unit-tested in the **sim harness only**: `nextDay(state, action)` with `Action = continue | rest | force-march | ration | reroute | turn-back`, `JourneyState`, and `DayOutcome = in-progress | arrived | aborted` in `web/src/utils/journey-days.ts`. v1 is mostly **surfacing that API to a human** + a light choice layer + the visual flip. We are not inventing the engine.

## v1 scope (Hybrid)
1. **Entry.** From a computed route (route + party + supply present), a "Set out" action in `JourneyResults`/`JourneyPlanner` enters Passage mode. Seed the initial `JourneyState` from the current route/party/supply.
2. **The loop.** Each day shows: current leg/location, weather + time-of-day, the **supply ledger** (rations/water remaining, rendered as dwindling stores, can show negative "debt"), and the day's event. The player picks an **action** (the 6 base actions) — `nextDay` advances state, the day is appended to the **journal log**.
3. **Hybrid encounters.** Most days resolve via base actions with narrated beats (reuse `encounters.ts` generation, already deterministic/seeded). A **small curated set of signature encounters** (target 3–5: e.g. river ford, bandit parley, storm at sea, fever in camp) present **2–3 branching choices** with measurably distinct outcomes (rations/water/days/risk deltas).
4. **Endings.** `arrived` (reached destination), `aborted` (turn-back), and a **perish/forced-back** state on supply exhaustion — each a distinct closing journal entry + visual.
5. **Visual flip (Passage temperature).** In Passage mode the map **dims/desaturates**, marks the **current position**, and (v1-light) hints the leg ahead; chrome (layer panel, toolbar) recedes in favor of the single-column journal. Full fog-of-war + candle-glow tightening on low supply = polish, can be v1.1.

## Defaults (set, not asked — revisit if wrong)
- **Audience:** GM-run at the table (not player-facing share mode) for v1.
- **Persistence:** ephemeral session state for v1. **"Save a playthrough"** (distinct from saving a route plan) is the first fast-follow.
- **Determinism:** same route + same choices → same outcome. Events stay seeded; player **choices** are what branch.

## Data model (the one genuinely new piece)
Add an optional branching layer over the read-only beats — keep it small and additive:
```ts
interface EncounterChoice {
  label: string                 // "Ford now" / "Wait out the flood" / "Seek another crossing"
  outcome: {
    rationsDelta?: number
    waterDelta?: number
    daysDelta?: number          // waiting/detour costs time
    narrative: string           // grave little paragraph, em-dash-free (VOICE-SPEC Option B)
    risk?: 'none' | 'minor' | 'grave'
  }
}
```
Attach via a **registry** mapping signature encounter key/type → `EncounterChoice[]` (don't bloat every beat). Apply the chosen `outcome` deltas to `JourneyState` before/around the `nextDay` call (or extend `nextDay` to accept an encounter-outcome). Keep the engine's existing burn/outcome logic authoritative.

## Acceptance criteria (testable)
- "Set out" from a computed route enters Passage mode with a `JourneyState` seeded from route/party/supply.
- "Continue" advances exactly one day; supply decreases per the existing burn model; the day appends to the journal.
- Reaching the destination → `arrived` ending; exhausting water/rations → perish/forced-back ending; "turn back" → `aborted` ending.
- ≥3 signature encounters present branching choices whose outcomes measurably differ (assert supply/day deltas).
- Map dims + marks current position in Passage mode; **exiting returns Atlas mode byte-for-byte unchanged**.
- Determinism: same route + same choice sequence → identical final state (unit-test the reducer/outcome layer).
- All existing tests pass; new unit tests cover choice-outcome application + each ending condition; one e2e walks a short route to an ending.

## Stays on Opus / delegable
- **Opus (me):** the state-machine seam (how choices compose with `nextDay`), the encounter-choice data model, the Passage visual-flip design, final review. Encounter-choice **prose** should honor worldbuilder VOICE-SPEC (em-dash-free) and only attested content.
- **Delegable to /orchestrate (Kimi) against this spec:** the journal UI scaffolding, action/choice wiring, map-dimming overlay, the signature-encounter registry entries, and tests — with Opus reviewing the diff. (Per global money/quota rules: bulk impl against a written spec → Kimi.)

## Sequencing
v1.0 = loop + endings + map-dim + 3 signature encounters (ephemeral, GM-run). v1.1 = save-a-playthrough + fog/candle-glow polish + more signature encounters.

See [[journey-experience-vision]], [[sim-harness]] (balance instrumentation), and `web/src/utils/journey-days.ts` (the engine).
