# Handoff: Per-Feature GM Notes

## Branch
`auto/season-nothing-beats-2026-05-10`

## What shipped

### Per-feature GM notes

Added a persistent notes textarea to every feature's InfoPanel, letting GMs jot location-specific ideas, hooks, or reminders without dropping a pin.

**Data layer** (`web/src/utils/feature-notes.ts`):
- Canonical key: `veydria.featureNotes.v1`
- Schema: `Record<featureId, noteText>`
- API: `loadFeatureNotes`, `saveFeatureNotes`, `getFeatureNote`, `setFeatureNote`, `deleteFeatureNote`, `getAllFeatureNotes`
- Defensive loading: filters non-string values, returns `{}` on corrupt/missing data
- `setFeatureNote` trims whitespace and auto-deletes empty notes

**UI** (`web/src/components/InfoPanel.tsx`):
- "GM Notes" section at the bottom of the InfoPanel body, below Lore & Sources
- `<textarea>` with placeholder "Add private notes about this location..."
- 300ms debounced save to localStorage via `setTimeout`
- Note loads when feature changes (via `useEffect` on `featureId`)
- State is local to the component; no global re-renders on keystroke

**CSS** (`web/src/App.css`):
- `.info-gm-notes-textarea` — matches existing input aesthetic (parchment tint, subtle border, accent focus ring)
- `resize: vertical` so users can expand

**Campaign log export** (`web/src/utils/campaign-log.ts`):
- New `featureNotes` field on `CampaignLogInput`
- "Feature Notes" section rendered between "Campaign Notes" (pins) and "Hex Notes"
- Feature IDs are title-cased for readability (`aethelian_basin` → "Aethelian Basin")
- `App.tsx` `handleDownloadCampaignLog` passes `getAllFeatureNotes()`

**Dead code cleanup**:
- Deleted unused `web/src/utils/journey-history.ts` and `journey-history.test.ts`

### Tests

| File | Tests | Coverage |
|---|---|---|
| `feature-notes.test.ts` | 17 | empty storage, invalid JSON, array rejection, non-string filtering, get/set/update/trim/delete, getAll |
| `campaign-log.test.ts` | +2 | feature notes section rendered; omitted when empty |

**Total: 373/373 passing** (up from 370)

### Validation

| Check | Result |
|---|---|
| TypeScript compilation | Clean (`tsc --noEmit`) |
| Vitest tests | **373/373 passing** (22 files) |
| Vite production build | Green, ~408KB JS (~125KB gzipped) |
| Python pipeline validate | Green |

### Files touched

- `web/src/utils/feature-notes.ts` — new
- `web/src/utils/feature-notes.test.ts` — new
- `web/src/components/InfoPanel.tsx` — GM Notes section + imports
- `web/src/utils/campaign-log.ts` — Feature Notes export section
- `web/src/utils/campaign-log.test.ts` — +2 tests
- `web/src/App.tsx` — import `getAllFeatureNotes`, pass to `downloadCampaignLog`
- `web/src/App.css` — `.info-gm-notes-textarea` styles
- `MASTER.md` — feature inventory + architecture diagram updated
- `web/src/utils/journey-history.ts` — deleted
- `web/src/utils/journey-history.test.ts` — deleted

## Remaining open items

None. The per-feature GM notes feature is fully implemented.
