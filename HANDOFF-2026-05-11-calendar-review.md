# Handoff: Calendar Canon Review & Hardening

## Branch
`auto/season-nothing-beats-2026-05-10`

## What happened this session

The previous instance replaced the 14 placeholder `VEYDRIA_CALENDAR` events with ~50 researched canon events drawn from `worldbuilder/timeline/calendar/*.yaml`. This instance reviewed everything for cleanliness, robustness, and intuitiveness, then tightened up the implementation.

### Canon events now in place

| Civilization | Events | Themes |
|---|---|---|
| Oravan | 7 | NW monsoon, cyclone shoulders, clove-nutmeg harvest, Tavamala Consecration, convoy blessing, wave-tithe |
| Ndjadi | 7 | Flood rise/crest, flood-window publication, River-Lord Assembly, decrue planting, peak fishing, hungry gap |
| Irrah | 8 | Cool caravan season, date harvest, frankincense spring/autumn tapping, Imajīn Caravan Council, Azmarāʔ star-reading, water-allocation ruling |
| Kheshkai | 8 | Spring thaw, lightning summer, autumn slaughter, winter tebenevka, Three-Year Skyward, pasture-rotation hearing, seasonal festival circuit |
| Qollari | 7 | Summer planting, chuño window, midwinter caravan season, Three-Year Skyward, solstice rites, Calendar Schism disputed window |
| Ngaru-Bon | 8 | Green hunger, msasa sowing, growing season, highland harvest, smelting season, Master-Smith Consecration, equinoctial forge-relighting |
| Basin-wide | 9 | Four Triple-Seal Court port sessions, Khazadari biennial rate-setting, four Court rotation transitions |

All 7 event types are represented: `festival`, `harvest`, `monsoon`, `religious`, `political`, `trade`, `misc`.

### Fixes applied

1. **Stale header comment** (`calendar.ts`) — removed the "placeholder events" language; now accurately describes the canon dataset.
2. **`eventActiveOn` hardening** — added an early-return for `durationDays >= 365` so year-long (or longer) events are correctly treated as always-active. The existing wrap-around logic only handled single-year wraps.
3. **Distinct icon mapping** — `political` was `'⚖'` (same as `trade`). Changed `political` to `'🏛'` so every type has a unique icon (future-proofing).
4. **Integration tests** (`journey-days.test.ts`) — added 2 tests:
   - Verifies `calendarEvents` and `dayOfYear` are populated when `departureDayOfYear` is passed to `buildDailyBreakdown`
   - Verifies day-of-year wraps from 365 → 1 correctly on year-boundary journeys
5. **Edge-case test** (`calendar.test.ts`) — added a test for year-long events (`durationDays: 365`).

### Files changed

| File | Change |
|---|---|
| `web/src/utils/calendar.ts` | ~50 canon events; fixed header comment; hardened `eventActiveOn`; distinct political icon |
| `web/src/utils/calendar.test.ts` | +1 test for year-long events |
| `web/src/utils/journey-days.test.ts` | +2 integration tests for calendar event population + year-wrap DOY |
| `MASTER.md` | Calendar layer line now notes "Researched canon events drawn from worldbuilder/timeline/calendar/*.yaml" |

### Stats

- `tsc --noEmit`: clean
- `vite build`: green
- `vitest run`: **356/356 passing** (22 files) — up from 353 (+3 new tests)
- Dev server: running at `http://localhost:5173/`

## Dev server

Already running on port 5173 (PID 23652). If it dies, restart with:
```bash
cd web && npm run dev
```

## Open questions / follow-ups

1. **Calendar legend panel** — a small floating key showing the 7 event-type colour mappings (festival=gold, harvest=green, monsoon=blue, religious=purple, political=red, trade=orange, misc=grey). Could live in the JourneyPlanner or as a map overlay.
2. **Civilization-filtered events** — currently `getEventsForDay` returns ALL active events for a given day. A future enhancement could filter by the civilizations the route actually passes through, so GMs only see relevant local events instead of the full world calendar.
3. **Campaign log export integration** — calendar events that occur during the journey could be summarized in the markdown export (`handleCopyMarkdown`).
4. **Calendar sync from worldbuilder** — when worldbuilder gets a dedicated calendar YAML, add a sync step in `scripts/sync-world-data.mjs` to replace the hardcoded `VEYDRIA_CALENDAR` array.
5. **Month/day display** — `formatDayOfYear` currently shows "Day N (season)". A future nicety could approximate real-world months (e.g. "Day 120 (spring ~late April)") for easier GM mental mapping.
