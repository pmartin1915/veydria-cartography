# Handoff — Chunk 4 Audit & Hardening

*Date: 2026-05-06*
*Previous: `HANDOFF-2026-05-06-chunk4-complete.md`*
*Build: ✅ `tsc -b && vite build` passes (6.50s)*
*Tests: ✅ 22/22 functional tests pass*

---

## Bugs Found & Fixed

### 1. [CRITICAL] Popup destroyed during pin drag
**File:** `MapViewer.tsx`  
**Problem:** When dragging a pin, `dragend` updates annotation state, triggering a full layer rebuild. The open popup vanished mid-interaction without firing its cleanup handler.

**Fix:**
- Added `marker.on('dragstart', () => marker.closePopup())` — closes popup before drag starts
- Added `openPopupIdRef` to track which annotation has an open popup
- After rebuilding markers, if `openPopupIdRef` points to an annotation that still exists, reopen its popup on the new marker instance (safety net for external updates)
- Added `annotationMarkersRef` for ID→marker lookup

### 2. [HIGH] Escape key closed global UI while typing in popup
**File:** `App.tsx`  
**Problem:** Pressing Escape inside the annotation popup's textarea/input also exited pin mode, closed the info panel, and cleared measure/journey modes.

**Fix:**
- Added `INPUT` / `TEXTAREA` guard in the global Escape handler: first Escape blurs the input, subsequent Escape does global cleanup
- Added `e.stopPropagation()` + `e.key === 'Escape'` handler inside the popup form so Escape cleanly cancels the popup without bubbling to the global handler

### 3. [HIGH] Journey button inconsistent with keyboard shortcut
**File:** `App.tsx`  
**Problem:** Clicking the Journey header button did NOT disable pin mode. Pressing `J` key DID disable pin mode. Inconsistent UX.

**Fix:**
- Updated Journey button `onClick` to `if (next) setPinMode(false)` — same behavior as the `J` keyboard shortcut

### 4. [MEDIUM] Annotation export toast leaked timeouts
**File:** `App.tsx`  
**Problem:** `handleExportAnnotations` used bare `window.setTimeout` with no cleanup. Rapid clicks stacked timeouts. Unmounting while a timeout was pending caused a setState-on-unmounted warning.

**Fix:**
- Added `annotationToastTimeoutRef` (cleared on unmount)
- Clear previous timeout before setting a new one

### 5. [MEDIUM] No Cancel button in popup
**File:** `MapViewer.tsx`, `App.css`  
**Problem:** Popup only had Save and Delete. Users who opened a pin, made edits, then changed their mind had to click outside the popup to discard changes.

**Fix:**
- Added Cancel button to `buildAnnotationPopupContent`
- Added `handleCancel` that calls `marker.closePopup()`
- Added `.annotation-popup-cancel` CSS styles (neutral grey, hover highlight)

### 6. [MEDIUM] Enter key in label input did nothing
**File:** `MapViewer.tsx`  
**Problem:** Users expect Enter in a single-line input to submit the form.

**Fix:**
- Added `keydown` listener on label input and textarea
- `Enter` (without Shift) → `e.preventDefault()` + `handleSave()`
- `Escape` → `e.stopPropagation()` + `handleCancel()`
- Listeners properly cleaned up in `popupclose`

### 7. [MEDIUM] Pins could be dropped/dragged off-map
**File:** `MapViewer.tsx`  
**Problem:** Clicking outside the SVG image bounds or dragging a pin off the edge produced negative or >1200/800 coordinates. Pins would disappear from view.

**Fix:**
- Added `latLngToSvgClamped()` helper that clamps x to `[0, SVG_WIDTH]` and y to `[0, SVG_HEIGHT]`
- Used in pin-drop click handler and dragend handler

### 8. [LOW] NaN / Infinity / empty ID could corrupt localStorage
**File:** `annotations.ts`  
**Problem:** `isValidAnnotation` accepted `NaN`, `Infinity`, and empty-string IDs. Corrupted localStorage entries would pass validation and break downstream math or deduplication.

**Fix:**
- Added `!Number.isNaN(o.x) && Number.isFinite(o.x)` guards
- Same for `y` and `createdAt`
- Added `o.id.length > 0` guard

---

## Additional Hardening

| Area | Change |
|---|---|
| **Label trimming** | `handleSave` now calls `labelInput?.value.trim()` instead of raw value — prevents all-whitespace labels |
| **Drag cursor** | Added `cursor: grab` / `cursor: grabbing` to `.annotation-marker` for visual affordance |
| **Popup reopen safety** | If annotations change while a popup is open (e.g., external sync), the popup is automatically restored on the rebuilt marker |
| **Event cleanup** | Popup `keydown`, `click` listeners all removed in `popupclose` — no dangling references |

---

## Files Modified

| File | Lines Changed |
|---|---|
| `web/src/components/MapViewer.tsx` | ~110 — popup tracking, dragstart close, clamped coords, Enter/Escape handlers, Cancel button, marker refs |
| `web/src/App.tsx` | ~25 — Escape guard, Journey button pin-mode disable, toast timeout ref, cleanup |
| `web/src/utils/annotations.ts` | ~5 — NaN/Infinity/finite/empty-ID validation |
| `web/src/App.css` | ~25 — Cancel button styles, grab/grabbing cursor |

---

## Verified

- [x] `npx tsc -b --noEmit` — clean
- [x] `npx vite build` — clean (6.50s)
- [x] Dev server loads (`http://localhost:5173/` → 200)
- [x] 22 functional tests for annotations module (CRUD, export, route proximity, validation, localStorage round-trip)

---

## Remaining pre-existing limitations (not bugs)

1. **No diffing in annotation layer** — full rebuild on every annotation change. Acceptable for typical pin counts (10–50).
2. **flyToAnnotation uses zoom 2.5** — may be close for edge-of-map pins. Pre-existing.
3. **No maxBounds on map** — user can pan beyond the SVG. Pre-existing.
4. **No markdown escaping in labels** — users can intentionally use `**bold**` in pin labels. Treated as a feature.
