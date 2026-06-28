# Spec: Draggable Journey Planner panel + sensible default position (v2, post-Kimi-review)

## Context
The Journey Planner (`.journey-planner`) is `position:absolute; top:60px; left:16px;
width:320px; max-height:calc(100% - 80px)` (desktop rule in `web/src/App.css` ~L2976).
The Layers panel (`.layer-controls`) is `position:absolute; bottom:16px; left:16px`
(`web/src/App.css` ~L768). Both hug the LEFT edge, so a tall planner overlaps the
Layers panel — the user reported "the planner spawns directly in front of the layers
window." Make the planner **draggable** (to move it off Layers) AND give it a
**sensible default position that doesn't overlap Layers**.

Branch off `master`. Desktop-only feature. Component:
`web/src/components/JourneyPlanner.tsx`; styles in `web/src/App.css`. This is a
client-only Vite SPA (no SSR) — `window` is always defined at runtime and in jsdom
tests, so `window.innerWidth` may be read directly.

## Acceptance criteria (testable)
1. **Draggable by header.** On desktop, the user can drag the panel by its header
   (`.journey-planner-header`) to reposition it. Pointer-based (pointerdown/move/up
   with `setPointerCapture`), not mouse-only.
2. **Desktop = `innerWidth > 768`.** The mobile bottom-sheet CSS is `@media
   (max-width: 768px)` (fires at <= 768). To avoid both firing at exactly 768, the
   JS "is desktop" gate MUST be `window.innerWidth > 768` (strictly greater). Drag +
   inline positioning apply ONLY when desktop; at <= 768 no inline left/top is
   applied so the bottom-sheet CSS wins, and drag is disabled.
3. **Header buttons keep working + keep pointer cursor.** The star / "?" / "x"
   buttons in the header must NOT initiate a drag and must show `cursor: pointer`
   (not grab). Ignore any pointerdown whose
   `target.closest('button, input, select, a, label, [role="button"]')` is truthy.
   FIRST verify the actual header DOM in JourneyPlanner.tsx and make the ignore
   selector cover every interactive element actually present in the header.
4. **Sensible default that clears Layers.** On first mount, default the panel to the
   RIGHT side: `left = innerWidth - 320 - 16`, `top = 60`, then clamp per AC6.
   Remove the desktop CSS `left: 16px` (position now comes from inline `style={{
   left, top }}`, applied only when desktop per AC2). Verify the top-right of the map
   is otherwise clear (Leaflet zoom control, legend) — the map Legend is bottom-right
   and Layers bottom-left, so top-right should be free; if the Leaflet zoom control
   sits top-right, nudge `top`/`left` so they don't collide.
5. **Position persists across open/close within the session (no reset).** Initialize
   position once on mount; keep it across planner open/close. It need NOT persist
   across full page reload (do not wire kvStore). (This supersedes any "reset on
   reopen" idea — session-persist is the desired behavior.)
6. **Clamp against the offset parent, keeping the panel grabbable.** Clamp so the
   FULL panel stays horizontally within the bounds, and at least the full HEADER
   stays vertically within the bounds (so a dragged-down panel can always be grabbed
   again). Compute bounds from the panel's actual offset parent
   (`el.offsetParent.getBoundingClientRect()` or its clientWidth/Height) rather than
   assuming raw `innerWidth`/`innerHeight`, since `.journey-planner` is absolutely
   positioned inside a container that starts below the app header. Re-clamp on the
   desktop/mobile resize handler (AC7).
7. **Minimal resize handling.** Add ONE `resize` listener (cleaned up on unmount)
   that (a) re-evaluates the desktop gate (AC2) and (b) re-clamps the current
   position into bounds. No continuous re-layout beyond this is required.
8. **Text-selection + drag affordance.** While a drag is active, suppress text
   selection (toggle `user-select: none` on the header/body or `preventDefault` on
   pointermove only). Header shows `cursor: grab` at rest and `grabbing` while
   dragging (desktop only); interactive children keep `cursor: pointer` (AC3).
9. **Elevation.** Ensure the planner sits above the Layers panel while interacting —
   `.layer-controls` and `.journey-planner` are both `z-index:999`; raise the
   planner to `1000` (permanently is fine, or only while dragging).
10. **Children still anchor correctly.** The Party/supply overlay sheet and From/To
    dropdowns are `position:absolute` children of `.journey-planner`; confirm they
    still anchor to the panel after it is moved.
11. **Pure, unit-tested helpers.** Extract the two bits of math as pure functions in
    a small module (e.g. `web/src/utils/planner-position.ts`):
    `defaultPlannerPosition(parentW: number): {left:number; top:number}` and
    `clampPlannerPosition(pos, parentW, parentH, panelW, headerH): {left:number;
    top:number}`. Add a unit test file asserting: default is right-aligned (left =
    parentW - 320 - 16) and never < 16; clamp keeps the full panel in-bounds
    horizontally and at least the header in-bounds vertically; clamp is a no-op for
    an already-in-bounds position. JourneyPlanner.tsx imports these.
12. **Gates green.** `cd web && npm run build` (tsc -b + vite) clean; `cd web &&
    npm test` (vitest) all pass INCLUDING the new helper tests; do not weaken or
    delete existing tests.

## Implementation guidance
- Self-contained pointer-drag handler in JourneyPlanner.tsx (~40-70 lines). NO new
  dependency (no react-draggable). `setPointerCapture` on the header; track the
  pointer delta from pointerdown; on pointermove update position = clamp(start +
  delta); release capture on pointerup.
- Position state: `useState(() => clampPlannerPosition(defaultPlannerPosition(W),
  ...))`. Apply `style` to `.journey-planner` ONLY when desktop (AC2); otherwise pass
  no positional style.
- Keep all existing classes, refs, and the entry animation on the panel root.
- Do NOT touch Passage mode, tour overlays, route logic, or the tabs/sticky behavior.

## Out of scope (do NOT do)
- Persistence across reloads/sessions; panel resizing; changes to the Layers panel;
  mobile drag; new dependencies; keyboard-drag (pointer-only is an accepted v1
  limitation — no a11y work this slice).

## Verification before declaring done
- `cd web && npm run build` -> clean.
- `cd web && npm test` -> all pass (incl. new planner-position tests).
- Playwright sanity (encouraged): open planner at >=1200px; confirm it spawns on the
  right (not over bottom-left Layers); drag the header; confirm the "x" still closes
  (drag not swallowed); confirm no console errors during the flow.
