# Session Handoff — 2026-05-10 · Saved Journeys

## Branch
`auto/season-nothing-beats-2026-05-10`  
Head: `7114a7f` + uncommitted work below  
Status: **clean working tree after commit**

## Verification
- `npm test -- --run` (web): **288/288 pass** across 17 test files
- `npm run build` (web): ✅ green
- `python pipeline.py validate` (generator): ✅ green

## Commit (intended)

```
feat: saved journeys — veydria.journeys.v1, My journeys panel, inline rename
```

## Summary of work delivered

Replaced the ad-hoc "Saved Routes" history feature with a properly-versioned **Saved journeys** system.

### 1. New persistence layer — `journey-saved.ts`
- **File:** `web/src/utils/journey-saved.ts`
- **Key:** `veydria.journeys.v1` (follows `veydria.X.vN` convention)
- **Schema:** `SavedJourney` extends old `HistoryEntry` with optional `name` field
- **Migration:** `loadSavedJourneys()` attempts a one-time defensive migration from legacy `veydria-journey-history`. Corrupt legacy fields are handled gracefully (defaults applied).
- **Functions:** `loadSavedJourneys`, `saveJourneys`, `addSavedJourney`, `deleteSavedJourney`, `renameSavedJourney`, `clearSavedJourneys`
- **Auto-name:** `makeDefaultName()` generates `"A → B"` or `"A → C → B"` labels from route endpoints.

### 2. Tests — `journey-saved.test.ts`
- **File:** `web/src/utils/journey-saved.test.ts` (23 tests)
- Coverage: empty storage, invalid JSON, non-array, valid parse, legacy migration, corrupt-field migration, v1-prefers-over-legacy, duplicate detection, name update on duplicate, truncation to 20 entries, rename/trim/clear.

### 3. JourneyPlanner integration
- **File:** `web/src/components/JourneyPlanner.tsx`
- Imports switched from `journey-history` → `journey-saved`
- State renamed: `history` → `savedJourneys`, `historyOpen` → `savedOpen`
- Handlers renamed: `handleLoadHistory` → `handleLoadSaved`, etc.
- UI text updated: "Saved Routes" → "My journeys", "Route saved to history" → "Saved to My journeys", etc.
- **Inline rename:** Click any journey name in the list to edit. `Enter` commits, `Escape` cancels, blur commits. Empty name clears to undefined (falls back to auto-generated route label).
- Save action now auto-generates a default name from the route before persisting.

### 4. CSS
- **File:** `web/src/App.css`
- Added `.journey-history-name` (clickable, hover highlight) and `.journey-history-name-input` (inline edit field matching existing accent styling).

### 5. MASTER.md
- Moved **Saved journeys** from Backlog → Shipped section.
- Updated backlog description to reflect inline rename and migration.

## Files touched

```
MASTER.md                              — Saved journeys shipped
web/src/utils/journey-saved.ts         — new persistence layer
web/src/utils/journey-saved.test.ts    — 23 tests
web/src/components/JourneyPlanner.tsx  — My journeys UI + inline rename
web/src/App.css                        — .journey-history-name + input styles
```

## Notes for the next instance
- The old `journey-history.ts` and `journey-history.test.ts` still exist in the tree. They are no longer imported by production code. Safe to delete in a future cleanup pass if desired.
- Bundle size: index.js ~365 kB (was ~363 kB), CSS ~86.6 kB — both well under thresholds.
- No schema bumps needed; `veydria.journeys.v1` is the first version.
- CI remains manual: verify `npm test -- --run` and `python pipeline.py validate` before merge.
