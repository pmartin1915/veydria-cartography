# Spec — Passage onboarding (teach "how to proceed along the road")

**Owner:** Opus (boss, owns design + copy). **Executor:** Kimi (mechanical wiring + tests).
**Branch:** worktree off current master HEAD.

## Goal

The journey planner has a 9-step **planning** tutorial but onboarding never mentions
**Passage mode** (the day-by-day travel game) — the crown feature is invisible to a first-time
GM. Add two coordinated pieces, reusing the existing tour engine:

1. A 10th step on the existing journey tutorial that *describes* the **Set out** button (the
   bridge from "plan" to "play").
2. A new short **Passage tutorial** that auto-fires the first time Passage mode is entered.

This is a UI-wiring task. All design decisions (copy strings, step targets, the two catches
below) are FIXED in this spec — implement them exactly; do not redesign or invent copy.

## House style (match existing tour copy exactly)

Existing steps use curly apostrophes (`’`, not `'`) and em-dashes (`—`). Use the same in all
new copy strings below. Copy strings are given verbatim — reproduce them character-for-character,
no markdown.

---

## Change 1 — new gating key

**File:** `web/src/utils/tour.ts`

After the existing `WELCOME_KEY` export (around line 62), add:

```ts
/** First-run walkthrough of Passage (day-by-day travel) mode. A separate flag so
 *  completing it never marks the journey tutorial or map tour done. */
export const PASSAGE_TUTORIAL_KEY = 'veydria.passage.tutorial.completed.v1'
```

Do not change `isTourCompleted` / `markTourCompleted` — they already take a `key` param.

---

## Change 2 — `data-tour` anchors

These are the spotlight targets. Add the attribute; change nothing else on the element.

**File:** `web/src/components/journey-planner/JourneyResults.tsx`
On the existing **Set out** `<button>` (currently has `data-testid="set-out-btn"`), add
`data-tour="journey-set-out"` (keep `data-testid`).

**File:** `web/src/components/journey-planner/PassageMode.tsx`
- On the `.passage-ledger` `<div>` inside the `PassageLedger` component, add
  `data-tour="passage-ledger"`.
- On the `.passage-journal` `<div>`, add `data-tour="passage-journal"`.
- On the `.passage-action-bar` `<div>`, add `data-tour="passage-actions"`.

---

## Change 3 — Piece 1: 10th journey-tutorial step

**File:** `web/src/components/JourneyPlanner.tsx`, inside the `journeyTourSteps` `useMemo`
array (currently ends with the `export` step around line 296–302).

**Append this as the new LAST element** of the array (after the `export` step object):

```ts
    {
      id: 'set-out',
      targetSelector: '[data-tour="journey-set-out"]',
      placement: 'top',
      title: 'Then live it',
      body: 'Plotting is only half the road. When the party is ready, Set out and travel the crossing a day at a time — supply, weather, and hard choices in real time.',
      onEnter: () => setRouteTab('route'),
    },
```

The reducer already uses `journeyTourSteps.length`, so the step count adapts automatically —
do not touch the reducer.

**CATCH #2 — DO NOT make clicking the live Set out button the in-tour action.** This step only
*describes* Set out; the user advances/finishes with the overlay's built-in "Done" button
(TourOverlay renders Done on the last step automatically). Do not add an onClick that enters
Passage, and do not wire the button into the tour's NEXT. Rationale: the Passage tutorial
(Piece 2) is guarded to not fire while the journey tutorial is active; if Set out were clicked
mid-tutorial, that guard would suppress the Passage tutorial in exactly the guided flow it
exists for, and the stale journey card would point at a button the passage swap unmounts.

---

## Change 4 — Piece 2: the Passage tutorial

**File:** `web/src/components/JourneyPlanner.tsx`

Mirror the existing journey-tutorial wiring (`journeyTourSteps` / `tutState` / `tutDispatch` /
the auto-fire effect / the `<TourOverlay>`). Add a parallel set for Passage.

### 4a. Import the new key

Add `PASSAGE_TUTORIAL_KEY` to the existing import from `../utils/tour` (line 5).

### 4b. Steps array

Add near `journeyTourSteps` (a `useMemo` with empty deps `[]` is correct — no callbacks):

```ts
  const passageTourSteps: TourStep[] = useMemo(() => [
    {
      id: 'welcome',
      title: 'The crossing begins',
      body: 'You’ve set out. From here the road is lived a day at a time — supply burning, weather turning, the party’s fate in your hands.',
    },
    {
      id: 'ledger',
      targetSelector: '[data-tour="passage-ledger"]',
      placement: 'bottom',
      title: 'Your lifeline',
      body: 'Rations and water, counted in days. Each march spends them; settlements resupply. If a choice cuts your carrying capacity, the lowered cap shows here.',
    },
    {
      id: 'actions',
      targetSelector: '[data-tour="passage-actions"]',
      placement: 'top',
      title: 'How you travel',
      body: 'Each day, choose: Continue marches you onward. Rest, Force-march, and Ration trade supply against time. Turn back ends the crossing while you still can.',
    },
    {
      id: 'journal',
      targetSelector: '[data-tour="passage-journal"]',
      placement: 'top',
      title: 'The record',
      body: 'This is where every day, encounter, and choice gets written as it happens — and hard encounters arrive as cards to decide. Travel well.',
    },
  ], [])
```

### 4c. Reducer

```ts
  const [passTutState, passTutDispatch] = useReducer(
    (s: TourState, act: TourAction) => tourReducer(s, act, passageTourSteps.length),
    { active: false, stepIndex: 0 },
  )
```

### 4d. Auto-fire effect (fires once on first Passage entry)

Add a ref and an effect keyed on `passageActive`:

```ts
  const passageTutFiredRef = useRef(false)
  useEffect(() => {
    if (!passageActive || passageTutFiredRef.current) return
    if (shareMode || mainTourActive || tutState.active) return
    if (typeof window !== 'undefined' && window.innerWidth < 768) return
    if (isTourCompleted(PASSAGE_TUTORIAL_KEY)) return
    passageTutFiredRef.current = true
    const t = window.setTimeout(() => passTutDispatch({ type: 'START' }), 600)
    return () => window.clearTimeout(t)
  }, [passageActive, shareMode, mainTourActive, tutState.active])
```

(`useRef`/`useReducer`/`useEffect`/`useMemo` are already imported in this file. `passageActive`,
`shareMode`, `mainTourActive`, `tutState` are all already in scope.)

### 4e. Second overlay

Add a second `<TourOverlay>` immediately after the existing one (around line 1228–1233):

```tsx
      <TourOverlay
        steps={passageTourSteps}
        state={passTutState}
        dispatch={passTutDispatch}
        storageKey={PASSAGE_TUTORIAL_KEY}
      />
```

**No replay button** for the Passage tutorial in v1 (it needs Passage active to have anchors).
Auto-fire-once on first entry only.

---

## Change 5 — e2e gating (MANDATORY — do not skip)

A tour firing on Passage entry will backdrop the existing Passage e2e walk-through and break
it. In BOTH specs' `addInitScript` blocks, add the new key next to the existing three
(`veydria.tour.completed.v1`, `veydria.journey.tutorial.completed.v1`, `veydria.welcome.seen.v1`):

```js
    localStorage.setItem('veydria.passage.tutorial.completed.v1', done)
```

- `web/e2e/smoke.spec.ts` (the block around lines 28–32)
- `web/e2e/tooltip.spec.ts` (the block around lines 35–39)

Use the exact same `done` variable already in scope in each block.

---

## Change 6 — unit test

**File:** `web/src/utils/tour.test.ts` (extend it; do not create a new file).

Add a test that `PASSAGE_TUTORIAL_KEY` round-trips independently of the other keys:

- `isTourCompleted(PASSAGE_TUTORIAL_KEY)` is `false` before marking.
- After `markTourCompleted(false, PASSAGE_TUTORIAL_KEY)`, `isTourCompleted(PASSAGE_TUTORIAL_KEY)`
  is `true`, AND `isTourCompleted(MAIN_TOUR_KEY)` / `isTourCompleted(JOURNEY_TUTORIAL_KEY)`
  remain `false` (keys are independent).

Follow the existing test file's setup (match its kvStore/localStorage reset pattern between
tests; import `PASSAGE_TUTORIAL_KEY`).

---

## Acceptance criteria

1. `cd web && npx tsc -b` — clean (no errors).
2. `cd web && npm test` — all pass; total count increases by the new round-trip test. If any
   existing test asserts a fixed journey-tutorial step count, update it to the new count (+1)
   and report that you did.
3. `cd web && npm run build` — green.
4. `cd web && npm run test:e2e` — green (the Passage walk-through smoke test still completes,
   proving the new key gates the tutorial off in e2e). If the port-5180 flake bites, re-run in
   isolation and report.
5. `git diff --name-only` touches ONLY the seven files under "Files". No new dependencies.
6. Copy strings reproduced verbatim (curly apostrophes + em-dashes), no markdown.
7. The journey tutorial's new step uses the overlay's built-in Done button — no onClick that
   enters Passage (Catch #2).

## Files (the only files to touch)

- `web/src/utils/tour.ts`
- `web/src/utils/tour.test.ts`
- `web/src/components/JourneyPlanner.tsx`
- `web/src/components/journey-planner/JourneyResults.tsx`
- `web/src/components/journey-planner/PassageMode.tsx`
- `web/e2e/smoke.spec.ts`
- `web/e2e/tooltip.spec.ts`

## Notes / do-not-touch

- Do NOT portal the new overlay or change `TourOverlay` — verified the `.passage-mode` filter
  is on `.app-main.passage-mode .leaflet-container` (a descendant the overlay is not nested
  under), so fixed-position anchoring is unaffected.
- Do NOT change the reducer, `tour.ts` helpers (beyond the new key), or any Passage engine code.
- Do NOT add a replay entry point for the Passage tutorial.
- Run npm from `web/`. `node_modules` will be junctioned into the worktree.
- Do NOT commit/push; leave the worktree dirty for Opus review. If any instruction is ambiguous
  or an existing test breaks, STOP and report rather than forcing it green.
