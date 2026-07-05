# Spec — Reroute Polish (feat/reroute-polish)

## Context

Branch `feat/passage-reroute` (PR #47 open) shipped reroute mid-journey + resupply
activation. Two deferred items in `ai/IDEAS.md` are now ready to implement.

## Acceptance criteria

### Item 1 — Unreachable-pick feedback (dead-click fix)
- [ ] Clicking a node that has no route in `passageReroute` does NOT close the picker
- [ ] A "No road that way." message appears inside the picker (below the list) after the failed click
- [ ] Successful reroute clears the error; closing/cancelling the picker clears the error
- [ ] Clearing the search input clears the error
- [ ] One new unit test in `web/src/utils/passage.test.ts`: calls `passageReroute` with an unreachable destination and asserts returned value `=== input` (strict identity)

### Item 2 — Per-reroute mode toggle
- [ ] Reroute picker shows a Fastest / Safest toggle (two buttons), inserted between the prompt and the node list
- [ ] Default selection: `safest` if the journey's `mode` prop is `'safest'`; `fastest` otherwise
- [ ] Selecting a mode button highlights it (`.active` class) and clears any `rerouteError`
- [ ] The reroute action uses the locally-selected mode (not the fixed `mode` prop)
- [ ] Toggle is styled to match the existing `.journey-mode-btn` pattern in App.css

### Gate (both items together)
- [ ] `cd web && npx tsc -b` — zero errors
- [ ] `cd web && npm test` — all tests green (973+ existing + 1 new)
- [ ] `cd web && npm run build` — succeeds, bundle chunk < 200 kB gzip (current: 162 kB / 200 kB limit)

## Files to touch (ONLY these)

| File | Change |
|------|--------|
| `web/src/components/journey-planner/PassageMode.tsx` | All logic + JSX changes |
| `web/src/App.css` | `.passage-reroute-error`, `.passage-reroute-mode-toggle`, `.passage-reroute-mode-btn` |
| `web/src/utils/passage.test.ts` | One new unit test |

**Do NOT touch:** `passage.ts`, `journey-days.ts`, `JourneyPlanner.tsx`, engine files, e2e tests.

## Implementation detail — Item 1

`passageReroute` (passage.ts:720-744) returns the exact same `state` reference on two
failure paths: line 722 (no graph) and line 726 (engine returned `advanced: false`).
Identity check (`next === state`) is the detection signal — no new return type needed.
Note: this is an implicit contract with passage.ts (both early-exit paths return `state` unchanged). passage.ts is off-limits; do not break this contract.

Replace the current `handleReroute` (PassageMode.tsx:125-129):

```ts
const [rerouteError, setRerouteError] = useState<string | null>(null)

const handleReroute = (newEndId: string) => {
  const next = passageReroute(state, newEndId, rerouteMode)  // rerouteMode from Item 2
  if (next === state) {
    setRerouteError('No road that way.')
    return
  }
  setState(next)
  setRerouteError(null)
  setRerouteSearch('')
  setRerouteOpen(false)
}
```

Clear `rerouteError` when: (a) successful reroute, (b) Cancel button clicked, (c) search input changes (every `onChange` keystroke — not just when empty). Do NOT clear on every render; only on these explicit events.

Error UI (inside picker panel, after the node list):
```tsx
{rerouteError && <p className="passage-reroute-error">{rerouteError}</p>}
```

CSS:
```css
.passage-reroute-error {
  font-size: 0.75rem;
  color: #9ca3af;   /* check if --passage-dim exists; prefer that var if so */
  text-align: center;
  margin-top: 0.25rem;
}
```

Unit test pattern — look at existing tests in passage.test.ts and match the factory/
setup helpers. The test needs a passage state that is in-progress (`journey` populated,
`pending` false, `graph` set) and a `newEndId` that has no path in the graph. Simplest:
a graph with nodes A→B and target C (disconnected). Assert
`passageReroute(state, 'C', 'fastest') === state`.

## Implementation detail — Item 2

Import check: `RouteMode` is exported from `web/src/utils/journey-graph.ts`. Verify it is already imported in `PassageMode.tsx` before adding it; if not, add it to the existing import line.

New local state (add near top of PassageMode component body):
```ts
const [rerouteMode, setRerouteMode] = useState<RouteMode>(
  mode === 'safest' ? 'safest' : 'fastest'
)
```

Reset `rerouteMode` each time the picker opens: when `rerouteOpen` becomes `true`, reset to `mode === 'safest' ? 'safest' : 'fastest'`. Use a `useEffect` on `rerouteOpen` or inline in the button handler that sets `setRerouteOpen(true)`.

Toggle JSX — insert inside the picker panel between `.passage-reroute-prompt` and
`.passage-reroute-list`:
```tsx
<div className="passage-reroute-mode-toggle">
  {(['fastest', 'safest'] as RouteMode[]).map(m => (
    <button
      key={m}
      className={`passage-reroute-mode-btn${rerouteMode === m ? ' active' : ''}`}
      onClick={() => { setRerouteMode(m); setRerouteError(null) }}
    >
      {m === 'fastest' ? 'Fastest' : 'Safest'}
    </button>
  ))}
</div>
```

CSS — read the exact `.journey-mode-btn` rules in App.css and copy them verbatim
for `.passage-reroute-mode-btn`: border, background, padding, border-radius, hover state,
and focus state (including any CSS variable references). The active state gets the same
filled/highlighted style as `.journey-mode-btn.active` or equivalent. The toggle container
(`.passage-reroute-mode-toggle`) should be `display: flex; gap: 0.5rem; margin-bottom: 0.5rem`
or similar to match the visual rhythm. The toggle sits inside `.passage-reroute-picker`.

## Branch

Work on `feat/reroute-polish` cut from `feat/passage-reroute`.
Single commit with both items: `feat(passage): reroute-polish — unreachable feedback + mode toggle`
Leave working tree clean.
