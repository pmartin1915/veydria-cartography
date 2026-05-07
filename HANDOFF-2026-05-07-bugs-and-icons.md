# Handoff — Bug Fixes + Icon Polish
*Date: 2026-05-07*
*Build: ✅ `tsc -b && vite build` passes*
*Status: 3 tasks, none yet executed — audit-only session*

---

## Task 1 — [CRITICAL] Dijkstra `|| Infinity` kills all routing

### Root cause — confirmed by simulation

`journey-graph.ts` lines 384–385:
```typescript
const alt = (distMap.get(u) || Infinity) + edgeCost
if (alt < (distMap.get(v) || Infinity)) {
```

`||` treats `0` as falsy. When `u` is the start node, `distMap.get(u) === 0`, so `0 || Infinity = Infinity`. Every edge from the start costs Infinity. Dijkstra never leaves start. **100% of routes fail** (confirmed: 595 pairs tested, 0 successes).

### Fix — 2-line change in `web/src/utils/journey-graph.ts`

```typescript
// line 384 — was: (distMap.get(u) || Infinity)
const alt = (distMap.get(u) ?? Infinity) + edgeCost
// line 385 — was: (distMap.get(v) || Infinity)
if (alt < (distMap.get(v) ?? Infinity)) {
```

`??` (nullish coalescing) only falls back on `null`/`undefined`, not `0`.

### Verify

After fix, run the node simulation from this session or just try "Ngaru Bon → Ki-Mbuhari" in the Journey Planner — should return a multi-hop route through the graph.

---

## Task 2 — Faction/Terrain overlays don't visually update

### Root cause — canvas renderer needs an explicit flush

The `terrain_cost` and `faction_control` useEffects in `MapViewer.tsx` (lines 638–644 and 647–653) correctly call `polygon.setStyle({ fillColor: ... })` on all 3004 terrain cells. Leaflet internally calls `_requestRedraw` which schedules a canvas repaint via `requestAnimationFrame`.

The problem: in React 18 StrictMode (active via `main.tsx`), the map init effect runs twice (mount → cleanup → remount). On the second mount, a fresh canvas renderer is created. When the overlay effects later call `setStyle`, the `requestAnimationFrame` repaint may be suppressed or deferred if the Leaflet map isn't yet fully settled.

### Fix A — force-flush the canvas after each style loop

In `MapViewer.tsx`, modify both overlay effects to fire `viewreset` after the loop. Leaflet's canvas renderer listens to `viewreset` and runs a full `_clear() + _draw()` sync repaint.

**Terrain cost effect** (lines 638–644):
```typescript
useEffect(() => {
  if (!mapRef.current) return
  const enabled = layers.terrain_cost
  for (const { polygon, elevation } of terrainCellMetaRef.current.values()) {
    polygon.setStyle({ fillColor: enabled ? getTerrainCostColor(elevation) : getElevationColor(elevation) })
  }
  mapRef.current.fire('viewreset')
}, [layers.terrain_cost])
```

**Faction overlay effect** (lines 647–653):
```typescript
useEffect(() => {
  if (!mapRef.current) return
  const enabled = layers.faction_control
  if (layers.terrain_cost) return
  for (const { polygon, elevation, civ } of terrainCellMetaRef.current.values()) {
    polygon.setStyle({ fillColor: enabled ? (CIV_COLORS[civ] || '#888') : getElevationColor(elevation) })
  }
  mapRef.current.fire('viewreset')
}, [layers.faction_control, layers.terrain_cost])
```

Add `mapRef` to both effects' dependency arrays since we now use it.

### Fix B (fallback) — if A doesn't work, remove canvas renderer for terrain cells

The canvas renderer was added for performance with 3004 polygons. If SVG handles it acceptably:
- Remove `const canvasRenderer = L.canvas(...)` from the init effect
- Remove `renderer: category === 'terrain_cell' ? canvasRenderer : undefined` from the polygon options
- SVG layers respond to `setStyle` synchronously (no animation frame needed)

Test performance — if the map feels acceptable, leave it as SVG.

### Verify

1. Enable Faction Overlay → oravan coastal area should visibly shift from light elevation greens to **blue-teal** (`#4a7a9a`)
2. Enable Terrain Cost → flat lowlands should turn bright green (`#4a9a3a`), high terrain red-brown
3. Disable either → returns to elevation coloring
4. Both on simultaneously → terrain_cost takes priority, faction overlay waits

---

## Task 3 — Replace emoji icons with SVG icons

### Strategy

- **LayerControls** and **JourneyPlanner** `NodeIcon`: change the `icon` field type from `string` to `ReactNode`, replace each emoji with a mini inline SVG.
- **JourneyPlanner** season/edge/warning icons (inline JSX): replace emoji with mini SVGs in JSX directly.
- **encounters.ts** `encounterTypeIcon`: must stay a `string` (used in markdown export on line 298). Replace emoji with clean Unicode symbols that render well in monospace.

### Complete emoji inventory

| File | Line | Emoji | Replacement plan |
|---|---|---|---|
| `LayerControls.tsx` | 28 | ⛰ terrain | SVG mountain path |
| `LayerControls.tsx` | 29 | 🌊 basin | SVG waves path |
| `LayerControls.tsx` | 30 | `〜` rivers | keep — clean unicode |
| `LayerControls.tsx` | 31 | 🏴 faction | SVG flag path |
| `LayerControls.tsx` | 32 | 🥾 terrain cost | SVG footstep/grid path |
| `LayerControls.tsx` | 38 | 🏛 civilization | SVG pillars path |
| `LayerControls.tsx` | 40 | 🌿 oasis | SVG leaf path |
| `LayerControls.tsx` | 41 | ✧ sacred sites | keep — clean unicode |
| `LayerControls.tsx` | 47 | ⚓ ports | SVG anchor path |
| `LayerControls.tsx` | 48 | ⛨ chokepoints | SVG shield path |
| `LayerControls.tsx` | 49 | ⤳ trade routes | keep — clean unicode |
| `LayerControls.tsx` | 95 | ✏️ edit mode | SVG pencil path |
| `JourneyPlanner.tsx` | 36 | 🏛 civ node | SVG pillars |
| `JourneyPlanner.tsx` | 37 | ⚓ port node | SVG anchor |
| `JourneyPlanner.tsx` | 38 | 🌿 oasis node | SVG leaf |
| `JourneyPlanner.tsx` | 40 | ⛨ chokepoint node | SVG shield |
| `JourneyPlanner.tsx` | 43 | 📍 fallback pin | SVG pin |
| `JourneyPlanner.tsx` | 74 | 🌸 spring | SVG flower |
| `JourneyPlanner.tsx` | 75 | ☀️ summer | SVG sun |
| `JourneyPlanner.tsx` | 76 | 🍂 autumn | SVG leaf-fall |
| `JourneyPlanner.tsx` | 77 | ❄️ winter | SVG snowflake |
| `JourneyPlanner.tsx` | 279–280 | 📜 trade / ⛰ choke | SVG scroll / mountain |
| `JourneyPlanner.tsx` | 289 | ⚠️ warning md | `[!]` (markdown stays text) |
| `JourneyPlanner.tsx` | 403 | 🧭 header icon | SVG compass |
| `JourneyPlanner.tsx` | 476 | 🗓️ any season | SVG calendar |
| `JourneyPlanner.tsx` | 788–789 | 📜 ⛰ edge icons (JSX) | SVG inline |
| `JourneyPlanner.tsx` | 803 | ⚠️ bottlenecks title | SVG triangle-alert |
| `JourneyPlanner.tsx` | 817 | 🌦️ seasonal | SVG cloud-rain |
| `JourneyPlanner.tsx` | 872 | 📍 annotations | SVG pin |
| `encounters.ts` | 173 | 🗣 social | `◎` |
| `encounters.ts` | 174 | 🌿 environmental | `❋` |
| `encounters.ts` | 175 | ⚔ combat | `✦` |
| `encounters.ts` | 176 | ✦ opportunity | `◈` |

### SVG paths to use (24×24 viewBox, stroke="currentColor" strokeWidth="2" fill="none")

These match the existing SVG style used throughout the header buttons:

```
mountain:     <path d="M3 20l5-8 4 5 3-4 5 7H3Z"/>
waves:        <path d="M2 14c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3-2 4.5 0"/>
              <path d="M2 10c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3-2 4.5 0"/>
flag:         <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
              <line x1="4" y1="22" x2="4" y2="15"/>
footsteps:    <path d="M8 4v4m0 0c0 4-3 5-3 8h6c0-3-3-4-3-8zm8 4v4m0 0c0 4-3 5-3 8h6c0-3-3-4-3-8z"/>
pillars:      <rect x="2" y="20" width="20" height="2"/><rect x="6" y="4" width="3" height="16"/>
              <rect x="15" y="4" width="3" height="16"/><rect x="2" y="4" width="20" height="3"/>
leaf:         <path d="M12 22V12M12 12C12 7 17 3 22 2c0 5-3 10-10 10zm0 0C12 7 7 3 2 2c0 5 3 10 10 10"/>
anchor:       <circle cx="12" cy="5" r="3"/>
              <line x1="12" y1="8" x2="12" y2="22"/>
              <path d="M5 12H2a10 10 0 0020 0h-3"/>
shield:       <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
pencil:       <path d="M17 3a2.8 2.8 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
pin:          <path d="M12 2C8.7 2 6 4.7 6 8c0 4.5 6 14 6 14s6-9.5 6-14c0-3.3-2.7-6-6-6z"/>
              <circle cx="12" cy="8" r="2.5"/>
sun:          <circle cx="12" cy="12" r="4"/>
              <line x1="12" y1="2" x2="12" y2="4"/>
              <line x1="12" y1="20" x2="12" y2="22"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="2" y1="12" x2="4" y2="12"/>
              <line x1="20" y1="12" x2="22" y2="12"/>
flower:       <circle cx="12" cy="12" r="3"/>
              <circle cx="12" cy="5" r="2"/><circle cx="12" cy="19" r="2"/>
              <circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
              <circle cx="7.05" cy="7.05" r="2"/><circle cx="16.95" cy="16.95" r="2"/>
snowflake:    <line x1="12" y1="2" x2="12" y2="22"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
              <line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/>
leaf-fall:    <path d="M2 22c4-2 8-8 8-14 0 4 2 9 7 12"/>
              <path d="M12 22c-2-4-2-8 2-12"/>
compass:      <circle cx="12" cy="12" r="10"/>
              <polygon points="12,2 14,12 12,16 10,12"/>
              <polygon points="12,22 10,12 12,8 14,12" fill="currentColor" opacity="0.3"/>
scroll:       <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14,2 14,8 20,8"/>
              <line x1="8" y1="13" x2="16" y2="13"/>
              <line x1="8" y1="17" x2="16" y2="17"/>
warning:      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
cloud-rain:   <line x1="16" y1="13" x2="16" y2="21"/>
              <line x1="8" y1="13" x2="8" y2="21"/>
              <line x1="12" y1="15" x2="12" y2="23"/>
              <path d="M20 16.58A5 5 0 0018 7h-1.26A8 8 0 104 15.25"/>
calendar:     <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
```

### Implementation approach

**LayerControls.tsx**: Change `icon: string` field to `icon: ReactNode`. Replace each emoji with:
```tsx
icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><...paths.../></svg>
```
Update `<span className="layer-toggle-icon">{icon}</span>` — already renders ReactNode fine.

**JourneyPlanner.tsx `NodeIcon`**: Change from emoji string lookup to a `switch` on `category` returning an inline SVG:
```tsx
function NodeIcon({ category }: { category: string }) {
  const size = 13
  const props = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const
  switch (category) {
    case 'civilization': return <svg {...props}><rect x="2" y="20" width="20" height="2"/><rect x="6" y="4" width="3" height="16"/><rect x="15" y="4" width="3" height="16"/><rect x="2" y="4" width="20" height="3"/></svg>
    case 'port': return <svg {...props}><circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/><path d="M5 12H2a10 10 0 0020 0h-3"/></svg>
    case 'oasis': return <svg {...props}><path d="M12 22V12M12 12C12 7 17 3 22 2c0 5-3 10-10 10zm0 0C12 7 7 3 2 2c0 5 3 10 10 10"/></svg>
    case 'landmark': return <svg {...props}><polygon points="12,2 22,12 12,22 2,12"/></svg>
    case 'chokepoint': return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    case 'contested_site': return <svg {...props}><polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9"/></svg>
    default: return <svg {...props}><path d="M12 2C8.7 2 6 4.7 6 8c0 4.5 6 14 6 14s6-9.5 6-14c0-3.3-2.7-6-6-6z"/><circle cx="12" cy="8" r="2.5"/></svg>
  }
}
```

**JourneyPlanner.tsx season icons** (inline in JSX at line 74-77): Replace the `icon` string in `SEASONS` with `ReactNode` or render an SVG directly where used.

**JourneyPlanner.tsx warning/bottleneck icons** (lines 803, 817, 872): Replace inline emoji with inline `<svg>` tags.

**encounters.ts** (must remain `string`): Replace with clean Unicode:
```typescript
case 'social': return '◎'          // hollow circle — dialogue/meeting
case 'environmental': return '❋'   // snowflake-like — nature event
case 'combat': return '✦'           // four-point star — danger
case 'opportunity': return '◈'      // diamond — reward
```
Update the markdown export line (298) as well — `◎ social` reads cleanly.

---

## Execution order

1. Fix `journey-graph.ts` (5-minute change, highest value)
2. Fix overlay canvas flush in `MapViewer.tsx` (test fix A first)
3. Replace LayerControls icons (most visible surface)
4. Replace JourneyPlanner icons (header, node icons, edge icons)
5. Replace encounter icons (quick, low risk)

## Files to change

| File | Change |
|---|---|
| `web/src/utils/journey-graph.ts` | 2-line `??` fix |
| `web/src/components/MapViewer.tsx` | +2 lines per overlay effect (mapRef guard + fire viewreset) |
| `web/src/components/LayerControls.tsx` | icon field type + 9 SVG replacements |
| `web/src/components/JourneyPlanner.tsx` | NodeIcon → SVG switch, season/warning/header icons |
| `web/src/utils/encounters.ts` | 4 Unicode char replacements |

## Verify checklist

- [ ] Journey from any port to any oasis produces a route (was: always null)
- [ ] Route path makes geographic sense (port → nearest civ → trade route → ...)
- [ ] Faction overlay: oravan areas turn blue-teal when enabled
- [ ] Terrain cost: lowlands bright green, mountains red-brown
- [ ] Toggling either off restores elevation colors
- [ ] No emojis visible in LayerControls panel
- [ ] No emojis visible in JourneyPlanner sidebar
- [ ] Encounter icons in route tab look clean at small size
- [ ] `tsc -b && vite build` clean
