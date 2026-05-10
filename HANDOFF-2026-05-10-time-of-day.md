# Handoff — Time-of-Day Overlay

*Date: 2026-05-10*
*Branch: auto/season-nothing-beats-2026-05-10*
*Commit: (to be made)*

## What shipped

**Time-of-day overlay** — a small atmospheric control that tints the Leaflet map container to match Dawn, Dusk, or Night moods. Day is the default (no filter).

### UX

- **Header button** between Log and Help — shows a distinct icon per mode (sun for Day, rising sun for Dawn, setting sun for Dusk, crescent moon for Night) plus text label
- **Click to cycle** through Day → Dawn → Dusk → Night → Day
- **`T` keyboard shortcut** — cycles while not typing in an input
- **Smooth 0.5s CSS transition** on filter changes
- **Persistent** — last choice saved to `localStorage:veydria.timeOfDay.v1`
- **Mobile-safe** — button label hides on narrow viewports (existing `.search-trigger` responsive rule), icon remains visible

### CSS Filters

| Mode | Filter |
|---|---|
| Day | `none` |
| Dawn | `brightness(0.9) sepia(0.2) hue-rotate(-15deg) saturate(1.05)` — warm golden |
| Dusk | `brightness(0.75) sepia(0.1) hue-rotate(20deg) saturate(0.9)` — cooler, dimmer |
| Night | `brightness(0.5) contrast(1.05) hue-rotate(5deg) saturate(0.75)` — dark blue |

Applied via parent class on `.app-main` (`.time-of-day-dawn`, etc.) so Leaflet container inherits it without component changes.

## Files changed

| File | Change |
|---|---|
| `web/src/utils/time-of-day.ts` | New utility — types, filter presets, labels, cycle/save/load |
| `web/src/utils/time-of-day.test.ts` | 9 tests — order, filters, labels, cycling, localStorage round-trip |
| `web/src/App.tsx` | State, `handleCycleTimeOfDay`, `t` keyboard shortcut, class on `<main>`, header button with SVG icons |
| `web/src/App.css` | Filter CSS per mode, `.leaflet-container` transition, `.time-of-day-btn` hover style |
| `web/src/components/KeyboardHelp.tsx` | Added `T` shortcut entry |

## Verification

- **Tests:** 322/322 pass (20 files)
- **TypeScript:** `tsc --noEmit` clean
- **Build:** `vite build` green
- **Python:** `pipeline.py validate` green

## State of the tree

```
On branch auto/season-nothing-beats-2026-05-10
Changes not staged for commit:
  (modified)   web/src/App.css
  (modified)   web/src/App.tsx
  (modified)   web/src/components/KeyboardHelp.tsx
  (new)        web/src/utils/time-of-day.ts
  (new)        web/src/utils/time-of-day.test.ts
```

## Next moves

The "In Progress / Next" section of MASTER.md is now empty of dev features. Plausible next picks from the backlog:

- **Multi-route comparison** *(medium)* — overlay Direct vs Safest vs Cheapest routes simultaneously
- **Dedicated mobile player mode** *(medium)* — share-mode renders cleanly on phone with no editing chrome
- **Time-of-day could be expanded** — a slider instead of discrete presets, or tie into a future calendar layer
