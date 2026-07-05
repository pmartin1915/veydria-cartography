# Trail mode view layer — spec for /orchestrate (Step 3)

Status: **specced 2026-07-01, ready for /orchestrate.** Engine shim (`trail.ts`, Step 2a) and
sim harness (`sim:trail`, Step 2b) are committed on this branch. This spec covers ONLY the
view layer. Parent spec: `ai/OREGON-TRAIL-SPEC.md`.

## Frozen files — the executor may NOT modify

`web/src/utils/journey-days.ts`, `journey-supply.ts`, `encounters.ts`, `passage.ts`,
`trail.ts`, and anything under `scripts/sim/`. `git diff` on these must be empty.
If the view needs something the trail.ts API doesn't expose, STOP and report the gap —
do not patch the engine.

## Files to create / modify

| File | Action |
|---|---|
| `web/src/components/journey-planner/TrailMode.tsx` | CREATE — sibling of `PassageMode.tsx` |
| `web/src/components/journey-planner/TrailMode.test.tsx` | CREATE — mirror `PassageMode.test.tsx` patterns |
| `web/src/components/journey-planner/JourneyResults.tsx` | MODIFY — mode selector on "Set out" |
| `web/src/components/JourneyPlanner.tsx` | MODIFY — launch/render TrailMode (mirror `passageActive`, lines ~824–837, ~1138) |
| `web/src/App.css` | MODIFY — `.trail-*` classes extending `.journey-day*` / `.passage-*` patterns |

## Launch flow

`JourneyResults` "Set out" button (JourneyResults.tsx ~line 71) becomes a two-option control:
**Passage** (existing behavior) | **Trail**. `JourneyPlanner` gets `trailActive` state parallel
to `passageActive` (line ~124); exactly one may be true. TrailMode renders in the same slot as
PassageMode (`journey-planner-body` swap, ~824–837) and receives the same props:

```tsx
interface TrailModeProps {
  route: JourneyRoute
  season?: Season
  mode: RouteMode
  party: PartyConfig
  supply: SupplyConfig
  edgeBiomes?: (string | undefined)[]
  departureDayOfYear?: number
  onExit: () => void
  onPositionChange?: (nodeIndex: number | null) => void
}
```

Position reporting mirrors PassageMode (lines 67–83) using `currentTrailNodeIndex(state)`;
clear to `null` on unmount.

## Setup card (before initTrail) — the OT naming ritual

Before the run starts, TrailMode shows a one-screen setup card:

- **2–5 member rows**, each an editable text input pre-filled from a small curated default
  pool of canon Veydrian names (define `DEFAULT_TRAIL_ROSTER` inside TrailMode.tsx or a tiny
  `trail-roster.ts`; 8–10 names with civ + role tags is enough for v1 — naming your own party
  is the load-bearing OT ritual, defaults are just placeholders).
- Member count defaults to `party` size clamped to [2,5].
- "Begin the trail" button calls:

```ts
initTrail({
  journeyOpts: /* same opts object JourneyPlanner already builds for initPassage */,
  members,                       // from the setup card
  runSeed: Date.now() >>> 0,     // UI entropy; trail.ts is pure
})
```

Store `runSeed` in component state; it is displayed on the score screen (replay/debug hook —
`djb2Hash` is exported from trail.ts if a string→seed field is ever wanted, not required v1).

## Screen layout (top to bottom)

1. **TravelVignette** — reuse as-is (same props PassageMode passes; `selectedSegmentIdx` from
   `currentTrailNodeIndex`). No scrolling-parallax work in v1; that is the standalone game's job.
2. **Roster ledger** (`.trail-roster`, sticky like `.passage-ledger`): one row per member —
   name, role tag, health badge (`well | ill | very ill | dead`), current `ailment` when ill.
   Dead members stay listed, struck through, with `diedDay`. Also show rations/water from
   `state.journey` (same fields PassageLedger reads: `rationsLeft`, `waterLeft`, scars).
3. **Trail log** (`.trail-journal`): render `state.log` (plain strings, append-only). Style with
   `.journey-day` card base. Death lines get a distinct variant (see Grave markers).
4. **Controls** — three mutually exclusive blocks, exactly like PassageMode (~117–166):
   outcome panel | pending card | action bar.

## Action bar and the hunt-every-day problem

`trailAct(state, {kind:'continue'})` surfaces `pending {kind:'hunt'}` **every travelled day**
when the route has biome data (documented v1 simplification in trail.ts). A modal card every
day would be spam. The view absorbs it:

- Action bar buttons: **Continue · Hunt · Rest · Force-march · Ration · Turn back**
  (Passage's five + Hunt).
- **Continue**: call `trailAct(continue)`; if the returned state has `pending.kind === 'hunt'`,
  immediately call `trailChoose(state, 1)` ("Press on") in the same handler. No card shown.
- **Hunt**: call `trailAct(continue)`; if `pending.kind === 'hunt'`, call `trailChoose(state, 0)`
  and show the roll result from the new log line. If the day's pending is a signature/fort
  instead, fall through to the card (hunting is unavailable that day).
- `rest | force-march | ration | turn-back` pass straight to `trailAct` (no pending possible).

Pending kinds that DO render as cards:

- **`signature`**: render `pending.choices` exactly like Passage's choice cards
  (`.passage-choice-cards` pattern — label, risk flavor, narrative on resolve).
  Resolve via `trailChoose(state, choiceIndex)`.
- **`fort`**: single-button card — "Resupply at the waypoint" → `trailChoose(state, 0)`.
- **`ford`**: reserved kind; if it ever appears, single-button "Ford the river" → `trailChoose(state, 0)`.

## Grave markers and death beats

When a member dies, `applyDayHealth` appends a log line containing the epitaph. The view:

- Renders that log entry as a **grave-marker card** (`.trail-grave`): headstone-framed block,
  member name, epitaph text verbatim, "Day N". Terse and clinical — the OT register. No poetry.
- Detect death entries by diffing `members` before/after the action (a member whose `diedDay`
  just got set), NOT by parsing log strings.

## Score screen (terminal outcomes)

When `state.outcome !== 'in-progress'`, replace controls with the ending panel:

- Outcome headline by kind: `arrived` / `aborted` / `perished` (supply floor) /
  `party-wiped` ("The party has perished to the last.").
- `scoreTrail(state)` → survivors x/y, days elapsed, supply margin, **rank** (PROVISIONAL
  generic labels are fine — Step 4 Content replaces them; do not invent new rank logic).
- Grave list: each dead member's epitaph.
- `runSeed` in small print.
- "Return to Atlas" → `onExit()` (mirror `.passage-ending-panel`).

## Styling

Namespace `.trail-*`, extending existing bases — reuse `.journey-day`, `.journey-day-header`,
`.journey-day-num`, `.journey-day-supply`, `.passage-ledger` grid, `.passage-choice-cards`.
Match the app's existing parchment/manuscript register. No new fonts, no pixel-art styling in
v1 (that's the standalone game).

## Testing (mirror PassageMode.test.tsx)

- Setup card renders, member names editable, Begin starts a run with fixed `runSeed` (inject
  seed in tests — never assert on `Date.now` paths).
- Continue auto-resolves hunt pending (no card), Hunt resolves choiceIndex 0 and logs a result.
- Signature pending renders choice cards; choosing appends the choice log line.
- Death → grave-marker card with epitaph; roster shows struck-through member.
- Terminal outcome → score screen with `scoreTrail` values; Return to Atlas calls `onExit`.
- Determinism: two runs with identical props + runSeed produce identical log arrays.

## Verification gate (executor must run)

```
cd web && npx tsc --noEmit && npx vitest run
git diff --stat web/src/utils/  # must show NO changes to frozen files
```

Plus one manual/Playwright pass: full run departure→terminal on a short route.

## Out of scope (v1 view)

Pixel-art/parallax travel screen · hunting animation · saving Trail runs to campaign log ·
per-civ rank labels and ailment vocabulary (Step 4 Content) · reroute during Trail runs.
