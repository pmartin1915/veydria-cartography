# Spec: Trail mode view layer (TrailMode.tsx)

**Primary spec: `ai/TRAIL-VIEW-SPEC.md` in this worktree — read it FIRST and follow it.**
This file is a binding ADDENDUM resolving ambiguities found in review. Where the two
disagree, this addendum wins.

## A. Engine API contract (verified against trail.ts — if anything mismatches, STOP and report)

From `web/src/utils/trail.ts` (FROZEN):

- `initTrail(opts: InitTrailOpts): TrailState` where `InitTrailOpts = { journeyOpts: JourneyStateOpts; members: Pick<TrailMember,'id'|'name'|'civ'|'role'>[]; runSeed: number }`.
  Member ids: `'m0'..'m4'`.
- `trailAct(state, action)` — action kinds for Trail v1: `'continue' | 'rest' | 'force-march' | 'ration' | 'turn-back'` (exact strings; `reroute` exists but is OUT of Trail v1 — no reroute button).
- `trailChoose(state, choiceIndex): TrailState`
- `currentTrailNodeIndex(state): number`
- `scoreTrail(state): TrailScore = { survivors; daysElapsed; supplyMargin; rank: string }` — render `rank` verbatim (it's a provisional generic label; do not invent rank logic).
- `TrailState = { journey: JourneyState; members: TrailMember[]; runSeed; log: string[]; pending: TrailPending | null; outcome: TrailOutcome; signatureCounts }`
- `TrailMember = { id; name; civ; role?; health: 'well'|'ill'|'very ill'|'dead'; ailment?; diedDay?; epitaph? }`
- `TrailPending = { kind:'signature'; key; choices: EncounterChoice[] } | { kind:'ford' } | { kind:'hunt' } | { kind:'fort' }` — `choices` is the SAME `EncounterChoice[]` PassageMode already renders; copy PassageMode's choice-card rendering.
- `TrailOutcome = 'in-progress' | 'arrived' | 'aborted' | 'perished' | 'party-wiped'`
- The engine yields AT MOST ONE pending per travelled day (single `nextDay` call inside
  `trailAct`), and `trailChoose` never produces a new pending — so the Continue handler's
  hunt auto-resolve is a plain `if`, no loop needed.

## B. Resolutions to spec ambiguities

1. **Seed test seam**: add optional `initialSeed?: number` to `TrailModeProps`. "Begin the
   trail" uses `initialSeed ?? (Date.now() >>> 0)`, computed once at click. Tests always
   pass `initialSeed` — no `Date.now` mocking, no assertions on wall-clock paths.
2. **Mode mutual exclusivity** (JourneyPlanner): launching Trail sets
   `trailActive=true, passageActive=false`; launching Passage does the reverse; `onExit`
   from either sets its flag false. Both false = the normal results view. Never both true.
3. **Setup card**: member-row count defaults from `party.size` — small→3, medium→4,
   large→5 — and the user can add/remove rows within [2,5]. Each row = one text input for
   the NAME only, pre-filled from `DEFAULT_TRAIL_ROSTER`; civ + role come from the roster
   pool entry and display as a static tag beside the input (not editable v1). Renaming
   keeps the entry's civ/role. Members passed to `initTrail` as
   `{ id: 'm'+index, name (trimmed; fall back to the pool default if blank), civ, role }`.
4. **Vignette timing**: before `initTrail`, the setup card is the ENTIRE TrailMode body
   (no vignette, no ledger, no log). Vignette/ledger/journal/action-bar render only once
   a run exists.
5. **Death rendering**: log lines are rendered as plain journal entries — do NOT parse or
   specially style log strings. Grave-marker cards are driven ONLY by the member diff
   (`diedDay` newly set after an action); insert the grave card into the journal at that
   point (after the day's log lines). Multiple same-day deaths → one card each, member order.
6. **Hunt button semantics**: Hunt means "travel today; if game appears, hunt it"
   (`trailAct(continue)` then `trailChoose(state, 0)` when pending is hunt). If the day's
   pending is signature/fort instead, that card shows — hunting was unavailable. Give the
   button `title="Travel on and hunt if game appears"`. No disabled-state logic in v1.
7. **Outcome headlines** (exact copy):
   - `arrived` → "You have arrived."
   - `aborted` → "The party turned back."
   - `perished` → "The party's supplies gave out."
   - `party-wiped` → "The party has perished to the last."
8. **`mode` prop**: use it exactly the way PassageMode uses its `mode` prop (pass-through
   to TravelVignette / journeyOpts). Mirror, don't innovate.
9. **Position reporting**: mirror PassageMode's `onPositionChange` effect (lines ~67–83 of
   PassageMode.tsx) verbatim, substituting `currentTrailNodeIndex(state)`; report `null`
   on unmount.

## C. Testing clarifications

- All TrailMode tests use a fixed `initialSeed` and fixed props → runs are deterministic.
- Assert on STRUCTURE (roster row count, health badge text, grave-card presence, choice-card
  count, score-screen fields, log growth), not on exact narrative strings — content vocabulary
  is Step 4 and will change.
- Determinism test: two renders with identical props + initialSeed, drive the same action
  sequence, assert identical `state.log` arrays (expose state for this via the component's
  rendered log entries, not internals).
- Do not modify or skip any existing test. `PassageMode.test.tsx` must stay green.

## D. Acceptance gate (replaces the spec's verification block)

```
cd web && npx tsc --noEmit && npx vitest run     # zero failures, zero newly-skipped
git diff --name-only                              # must contain NO file under web/src/utils/ or scripts/sim/
```

Plus: no functional change to `JourneyResults`'s existing Passage path — choosing Passage
must behave exactly as today.

Commit your work in the worktree:
`feat(trail): Trail mode view layer — setup card, roster ledger, journal, hunt flow, score screen (Step 3)`

## E. Notes

- `web/node_modules` is junctioned into the worktree — do not run `npm install`.
- Match surrounding code style; no new dependencies; no drive-by refactors.
- Anchor line numbers may have drifted — locate by pattern.
