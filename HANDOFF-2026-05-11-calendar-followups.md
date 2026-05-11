# Handoff: Calendar Follow-ups — Window War, Legend, Civ Filtering, Export

## Branch
`auto/season-nothing-beats-2026-05-10`

## What happened this session

Shipped all four follow-ups from the calendar review handoff, plus the new Window War crisis integration from worldbuilder.

### 1. Upstream/Downstream Window War integrated into calendar

Read `worldbuilder/factions/03_crises/upstream_downstream_window_war.md` and mapped the crisis to the Ndjadi autumn flood-window season.

**New event:** `ndjadi-window-war`
- **Type:** `political`
- **Start:** Day 265 (same day as flood-window publication)
- **Duration:** 35 days (covers publication week, River-Lord House Assembly week, and the three-week post-levy dispute window)
- **Description:** Annual flood-classification dispute season. The Wa-Kande ka-Bonde upstream coalition challenges the Flood-Yield Registry's ordinary/heavy designation; downstream Vernacular-Habal holders receive residual dam-release flow, often too late for optimal decrue planting.
- **Effect:** Grain-export contracts carry a "classification-risk premium." Smuggler portage volumes spike if Registry certificates freeze.

Overlaps naturally with `ndjadi-flood-window-publication` (day 265, duration 7) and `ndjadi-river-lord-assembly` (day 272, duration 7), providing narrative context for those institutional events.

### 2. Calendar legend panel

Added a compact event-type key below the departure date selector in `JourneyPlanner`.

- **Visibility:** Only shows when `departureDayOfYear !== undefined` (the moment calendar events actually populate the day cards)
- **Layout:** 3-column grid with 7 items — coloured dot + emoji icon + capitalized type name
- **Styling:** Matches existing journey-planner label patterns (`9px` uppercase muted label, `10px` secondary text)
- **Colours & icons:** Drawn from `CALENDAR_EVENT_COLORS` and `CALENDAR_EVENT_ICONS` in `calendar.ts` (festival=gold 🎉, harvest=green 🌾, monsoon=blue 🌧, religious=purple ⛪, political=red 🏛, trade=orange ⚖, misc=grey 📌)

**Files:** `JourneyPlanner.tsx`, `App.css`

### 3. Civilization-filtered events

`buildDailyBreakdown` now filters calendar events to only those relevant to the route's actual geography.

- **Logic:** Extracts unique `civ` values from `route.nodes`, normalizes `ngaru_bon` → `ngaru-bon` (GeoJSON uses snake_case; calendar uses kebab-case), then filters events where `civilization === 'all'` OR `civilization` is in the route civ set.
- **Fallback:** If no nodes have `civ` assigned (synthetic/test routes), all events are shown — backward compatible.
- **Impact:** A Kheshkai→Kheshkai route no longer shows Oravan monsoon events. Basin-wide events (`all`) still appear on every route.

**Tests added:** 2 in `journey-days.test.ts`
1. `filters calendar events to route civilizations` — ndjadi route on day 30 shows `ndjadi-peak-fishing` but excludes `irrah-imajin-council-spring`
2. `includes basin-wide (all) calendar events regardless of route civ` — kheshkai route on day 1 still shows `basin-khazadari-rate-setting`

**Files:** `journey-days.ts`, `journey-days.test.ts`

### 4. Campaign log export integration

Calendar events now flow into the markdown export (`handleCopyMarkdown` in `JourneyPlanner`).

- **Format:** Each calendar event becomes a bullet: `- 📅 **{name}** ({type}) — {effect}`
- **Day-of-year:** The day header now includes the formatted DOY when set: `**Day 3** · Day 127 (spring) · 45 km`
- **Placement:** Calendar events appear after Weather and before Notable/Encounters in each day block

**Files:** `JourneyPlanner.tsx`

### Files changed

| File | Change |
|---|---|
| `web/src/utils/calendar.ts` | +1 event (`ndjadi-window-war`) |
| `web/src/components/JourneyPlanner.tsx` | Calendar legend JSX; import `CALENDAR_EVENT_ICONS`; markdown export includes calendar events + DOY |
| `web/src/utils/journey-days.ts` | Route civ extraction + event filtering |
| `web/src/utils/journey-days.test.ts` | +2 tests for civ filtering |
| `web/src/App.css` | `.journey-calendar-legend*` styles |
| `MASTER.md` | Calendar layer line updated with new capabilities |

### Stats

- `tsc --noEmit`: clean
- `vite build`: green
- `vitest run`: **358/358 passing** (22 files) — up from 356 (+2 new tests)
- Dev server: running at `http://localhost:5173/`

## Dev server

Already running on port 5173. If it dies, restart with:
```bash
cd web && npm run dev
```

## Remaining follow-ups

From the original handoff, these are now the only open items:

1. **Calendar sync from worldbuilder** — when worldbuilder gets a dedicated calendar YAML, add a sync step in `scripts/sync-world-data.mjs` to replace the hardcoded `VEYDRIA_CALENDAR` array.
2. **Month/day display** — `formatDayOfYear` currently shows "Day N (season)". A future nicety could approximate real-world months (e.g. "Day 120 (spring ~late April)") for easier GM mental mapping.

Both are nice-to-haves rather than blockers.
