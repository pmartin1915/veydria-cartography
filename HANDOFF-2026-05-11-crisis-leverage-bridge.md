# Handoff: Crisis Leverage Bridge

## Branch
`auto/season-nothing-beats-2026-05-10`

## Commits
- `a6847a4` — calendar: month approximation, YAML source, and sync infrastructure
- `eb42165` — audit: accessibility fix + departure toggle overflow safety
- `fde99e5` — docs: handoff for calendar nice-to-haves + full audit
- *(this session)* — feat: crisis leverage bridge (calendar metadata + UI + export)

## What shipped

### Lightweight crisis bridge

Added `crises` metadata to 8 calendar events, creating a bridge between the cartography map and the worldbuilder crisis docs without duplicating prose.

**Schema (in `data/calendar-events.yaml`):**
```yaml
crises:
  - id: harbor-oath-war
    window: 1
    note: Harbor Covenant gains leverage; Syndics lose volume
```

**Tagged events:**

| Event | Crisis | Window |
|---|---|---|
| `oravan-nw-monsoon` | Harbor Oath War | 1 |
| `ndjadi-decrue-planting` | Harbor Oath War | 2 |
| `irrah-cool-caravan-season` | Harbor Oath War | 3 + Metal Interdict | 2 |
| `basin-court-rotation-ht-dt` | Harbor Oath War | 4 |
| `ngaru-bon-smelting-season` | Metal Interdict | 1 |
| `kheshkai-spring-thaw` | Metal Interdict | 3 |
| `kheshkai-three-year-skyward` | Metal Interdict | 4 |
| `qollari-three-year-skyward` | Metal Interdict | 4 |

**Generator updated:** `generator/export/calendar_ts.py` now passes `crises` through to `web/src/generated/calendar-events.ts`.

**TypeScript helpers added** (`web/src/utils/calendar.ts`):
- `hasCrisis(event)` — boolean
- `getCrisisIds(events)` — unique crisis ID list
- `formatCrisisRef(crisis)` — e.g. `"Harbor Oath War #3"`

### UI changes

**Days tab:** Calendar event badges now show a ⚡ icon when the event is tagged as a crisis leverage window. The tooltip includes the formatted crisis reference(s).

**Legend panel:** New "⚡ Crisis" toggle button next to "Event key". When active, non-crisis events are dimmed (opacity 0.35 + grayscale), making leverage windows visually prominent.

**CSS additions** (`App.css`):
- `.journey-calendar-event.crisis` — amber-tinted background
- `.journey-calendar-event.dimmed` — opacity + grayscale
- `.journey-calendar-legend-toggle` + `.active` — toggle button styling

### Campaign log export

Day-by-day markdown now includes calendar events with crisis footnotes:
```markdown
- 📅 **NW Monsoon** (monsoon) — ⚡ Leverage: Harbor Oath War #1
```

### Tests

- `calendar.test.ts`: 6 new tests (crisis metadata on canon events, `getCrisisIds`, `formatCrisisRef`)
- `campaign-log.test.ts`: 1 new test (crisis footnote formatting)
- Total: **370/370 passing** (up from 364)

## Validation

| Check | Result |
|---|---|
| TypeScript compilation | Clean (`tsc --noEmit`) |
| Vitest tests | **370/370 passing** (22 files) |
| Vite production build | Green, ~406KB JS (~124KB gzipped) |
| Python pipeline validate | Green |

## Files touched

- `data/calendar-events.yaml`
- `generator/export/calendar_ts.py`
- `web/src/generated/calendar-events.ts`
- `web/src/utils/calendar.ts`
- `web/src/utils/calendar.test.ts`
- `web/src/components/JourneyPlanner.tsx`
- `web/src/utils/campaign-log.ts`
- `web/src/utils/campaign-log.test.ts`
- `web/src/App.css`
- `MASTER.md`

## Remaining open items

None. The crisis leverage bridge is fully implemented. Future crises can be added by editing `data/calendar-events.yaml` (in worldbuilder when it gets the file, or here as canonical source until then) and re-running `npm run generate:calendar`.
