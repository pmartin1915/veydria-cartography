# Player-view rigor (ROADMAP Tier 2b) - spec, awaiting approval

Status: DRAFT 2026-09-30. Not built. Written against master 4283a01.

## Audit: what already exists (do not redo)
- `shareMode` = `share=1` in the URL hash (App.tsx). It hides: Log, Annotations panel, Encounters tab,
  encounter rows in Days, Roll one-off, mode-risk and density warnings, mode recommendation, Mark-route-explored,
  edit mode; annotations passed to map layers are `[]`.
- `campaign-log.ts` has `playerSafe`: drops encounters, crises, pins, hex notes, feature notes. Used by the
  Player MD handout and by `copyRouteMarkdown(shareMode)`.
- Fog: `fog=1` rides with `share=1` (url-hash.ts).

## Gaps found (the work)
1. **InfoPanel leaks GM fields to players.** `InfoPanel.tsx` has no share awareness. In share mode it still
   renders `strategic_value`, `bottleneck`, `consequence_if_closed` (FIELD lists at L38-42). These are the
   "bottleneck strategic reasoning" the roadmap names. `<InfoPanel>` in App.tsx L1828 is not passed `shareMode`.
2. **No `gmOnly` on annotations** and no `properties.gm_only` convention for features. Today annotations are
   all-or-nothing hidden in share mode, so a GM cannot publish one pin to players.
3. **No isolation test.** Nothing asserts that share-mode output excludes GM content. The gates are scattered
   (63 `shareMode` references), so a new component can leak silently.
4. **No two-link export.** One Share popover; the roadmap wants explicit "GM link" and "Player link".
5. **Comparison routes** are still shown to players (roadmap says show only the chosen route). Verify at
   JourneyControls.tsx ~L178-215 before changing.

## Decisions Perry must make (these block the build)
- D1. Is the GM-only field set exactly {strategic_value, bottleneck, consequence_if_closed}, or wider (e.g.
  chokepoint `description`, trade-route `commodities`)? Default proposed: the three.
- D2. Gap 2: build `gmOnly` on annotations now, or defer? Proposed: defer (nobody has asked; share mode just hides all).
- D3. Gap 5: hide comparison routes from players? Proposed: yes.
- D4. Gap 4: is a second explicit link worth a UI change, or is the existing Share popover enough? Proposed: skip.

## Proposed build (assuming proposed defaults), one session, /orchestrate-ready
Files: `web/src/components/InfoPanel.tsx` (+ `shareMode?: boolean` prop, filter the 3 fields),
`web/src/App.tsx` (pass `shareMode` at L1828), a new `web/src/utils/share-mode-isolation.test.ts` or
component test, `JourneyControls.tsx` (comparison gate, only if D3 yes).
Tests: (a) InfoPanel with a trade_route/chokepoint feature renders none of the three fields when
`shareMode`, and all of them when not; (b) planner in share vs GM mode for one fixed route: assert the GM-only
strings are absent from the share DOM.
Verify gate: `cd web && npm run test` (956+ green), `npm run build`, `npm run check:size` (200 KiB gz budget,
161.95 KiB at last measure).
Not touched: passage.ts, journey architecture, anything in .orchestrate "Never touch".
