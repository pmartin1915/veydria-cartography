# Handoff: Time / Calendar Layer

## Branch
`auto/season-nothing-beats-2026-05-10`

## What shipped
**Time / calendar layer** — civilizational calendar overlay on the journey day-by-day breakdown.

### Architecture

```
calendar.ts (new)
├── CalendarEvent interface
├── VEYDRIA_CALENDAR: readonly placeholder events
├── getEventsForDay(day) → active events
├── getEventsForRange(start, duration) → Map<day, events>
├── getSeasonalEvents(season) → season-filtered events
├── dayToSeason(day) → Season
├── formatDayOfYear(day) → "Day N (season)"
└── eventActiveOn(event, day) → boolean (handles year-wrap)

journey-days.ts (modified)
├── JourneyDay gains calendarEvents?: CalendarEvent[] and dayOfYear?: number
└── buildDailyBreakdown gains optional departureDayOfYear parameter

JourneyPlanner.tsx (modified)
├── departureDayOfYear state (number | undefined)
├── Departure control: toggle button + range slider (1-365)
├── Calendar event badges rendered in each day card
└── Cleared on handleClear() and planner close
```

### UI

- **Departure control** appears below the "Compare routes" toggle. A button shows "Any" (inactive) or formatted date like "Day 120 (spring)" (active). Click to toggle; when active, a range slider lets the GM pick the departure day.
- **Calendar event badges** appear in each day card in the Days tab, between weather and notable items. Each badge has:
  - Colour-coded left border (per event type)
  - Small dot
  - Event name
  - Civilization tag (if not 'all')
  - Tooltip with description + effect

### Placeholder calendar data

14 events across 6 civilizations + Basin-wide. Types: festival, harvest, monsoon, religious, political, trade, misc.

| Civilization | Events |
|---|---|
| Oravan | Spice Harvest, Monsoon Departure, Wave-Tithe |
| Ndjadi | Delta Planting, First Flood |
| Irrah | Date Harvest, Sand Still |
| Kheshkai | Smelt Bloom, Shaman Conclave |
| Qollari | Calendar Rite, Mist Market |
| Ngaru-Bon | Ice Road Opening, Long Night |
| Basin-wide | Port Convocation, Monsoon Shift |

**These are placeholders.** Replace with researched canon from worldbuilder.

### Files changed

| File | Change |
|---|---|
| `web/src/utils/calendar.ts` | New module: data model, queries, placeholder events |
| `web/src/utils/calendar.test.ts` | New: 19 tests |
| `web/src/utils/journey-days.ts` | `JourneyDay` gains calendar fields; `buildDailyBreakdown` gains `departureDayOfYear` |
| `web/src/components/JourneyPlanner.tsx` | Departure control UI, calendar badge rendering, reset handling |
| `web/src/App.css` | `.journey-departure-*`, `.journey-day-calendar`, `.journey-calendar-event`, `.journey-day-doy` |
| `MASTER.md` | Marked shipped; updated test count |

### Stats

- `tsc --noEmit`: clean
- `vite build`: green
- `vitest run`: **353/353 passing** (22 files)
- `pipeline.py validate`: green
- Git: `9e2856a` (feature) + `70a9953` (docs) on `auto/season-nothing-beats-2026-05-10`

## Open questions / follow-ups

- **Replace placeholder events** with researched canon from worldbuilder. The `CalendarEvent` schema supports everything needed: id, name, civilization, type, startDay, durationDays, description, effect, season.
- **Calendar sync from worldbuilder** — when worldbuilder gets a dedicated calendar YAML, add a sync step in `scripts/sync-world-data.mjs` and replace the hardcoded `VEYDRIA_CALENDAR` array.
- **Year-wrap events** — the `eventActiveOn` function correctly handles events that span Dec→Jan (e.g. startDay 360, duration 10). The UI rendering and range queries both respect this.
- **Could add a calendar legend** — small panel showing event type colour key (festival=gold, harvest=green, monsoon=blue, etc.).
- **Could integrate into campaign log export** — calendar events that occur during the journey could be listed in the markdown export.
