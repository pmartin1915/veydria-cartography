# Handoff — Ready for Chunk 4: Map Annotations

*Date: 2026-05-06*
*Prev chunks: Chunk 2 (lore cards + difficulty) ✅, Chunk 3 (encounters) ✅*
*Build: ✅ `npm run build` passes*

---

## Current state

Phase 6 is 2/3 complete. The app now has:
- **Lore-rich segment tooltips** — commodities, consequence-if-closed, etymology, function
- **Route difficulty badge** — Merchant-grade / Explorer-grade / Mixed-trail
- **Deterministic encounter generator** — 30 beats, seeded by route signature, season-filtered
- **Tabbed route results** — Route tab (path + warnings) and Encounters tab (beat cards)
- **Extended markdown export** — includes difficulty + encounters

---

## Chunk 4 spec: Map Annotations

### Goal
A pin tool that lets the GM drop pins on the map, label them, write notes, and persist them in localStorage. Pins export with the route markdown as "GM Notes" and can also export standalone as "Campaign Notes".

### What to build

#### 4.1 Pin tool state & UI
- **New state in `MapViewer.tsx`:** `pinMode: boolean` — when active, the next map click drops a pin instead of panning/zooming.
- **Pin button** in the top toolbar (next to measure mode) — toggles pin mode.
- **Pin data model:**
  ```ts
  interface MapAnnotation {
    id: string
    x: number  // SVG coordinate
    y: number  // SVG coordinate
    label: string
    body: string
    color: string
    createdAt: number
  }
  ```
- **Visual:** Pins are `L.divIcon` markers with a 📍 or custom SVG. Color is configurable (default `#c4a86b`).
- **Click existing pin:** Opens an edit panel (inline or sidebar — see §4.3).

#### 4.2 Persistence
- **New file:** `web/src/utils/annotations.ts`
  - `loadAnnotations(): MapAnnotation[]` — reads `localStorage.getItem('veydria-annotations-v1')`
  - `saveAnnotations(annotations: MapAnnotation[])` — writes to localStorage
  - `createAnnotation(x, y, label?, body?, color?)` — factory with UUID
  - `deleteAnnotation(id)` — filter + save
- **No sync/sharing.** localStorage only. That's explicitly out of scope for Phase 6.

#### 4.3 Edit panel
- **Option A (inline):** Click pin → small popup with label input, textarea for body, color picker, delete button. Simple, Leaflet-native.
- **Option B (sidebar):** Add an "Annotations" section to the right info panel. Click pin → panel opens with edit form.
- **Recommendation:** Option A (Leaflet popup) is faster and keeps the map as the workspace. The sidebar is already crowded with the journey planner.
- **Popup content:**
  - Label input (text, single line)
  - Body textarea (3 rows)
  - Color picker (small palette: parchment-gold, rust-red, sea-blue, forest-green, charcoal)
  - Save + Delete buttons
  - Created timestamp

#### 4.4 Annotations sidebar list
- **New section in `JourneyPlanner.tsx` or a new floating panel?** 
- **Recommendation:** Add a collapsible "Annotations" section at the bottom of the existing left sidebar (below the journey planner). It lists all pins with label + snippet. Clicking a list item flies to the pin on the map.
- If the sidebar feels too tall, make the annotations section collapsible with a toggle.

#### 4.5 Export integration
- **Route markdown:** Add a `### GM Notes` section at the end (before the footer) listing annotations that fall near the route. "Near" = within 40px SVG distance of any route segment. Include label, body, and rough location.
- **Standalone campaign notes export:** New button "Export Notes" in the annotations sidebar that copies all annotations as markdown to clipboard.
  ```markdown
  ## Campaign Notes — Veydria
  
  ### Pin: Bandit Camp
  *Near the Lam-Chen pass*
  
  The players spotted smoke here. Possible ambush site for next session.
  
  ---
  
  ### Pin: Hidden Cove
  *Off the Oravan coast*
  
  Fisher-folk mentioned a drowned city. Need to research this.
  ```

#### 4.6 MapViewer integration details
- Pins should render in a dedicated `L.LayerGroup` (like `journeyRouteLayerRef`).
- Pin mode should set `map.getContainer().style.cursor = 'crosshair'` and trap the next click.
- After dropping a pin, exit pin mode automatically.
- Pin drag: allow dragging pins to reposition (use Leaflet's `draggable: true`, update coordinates on `dragend`).

---

## Files to modify / create

| File | Action |
|---|---|
| `web/src/utils/annotations.ts` | **Create.** Persistence, CRUD, factory. |
| `web/src/components/MapViewer.tsx` | **Modify.** Pin mode toggle, click handler, pin rendering, drag handling, popup edit form. |
| `web/src/components/JourneyPlanner.tsx` | **Modify.** Add annotations list section, export-notes button, wire into markdown export. |
| `web/src/App.tsx` | **Modify.** Lift annotations state or pass callbacks if needed. |
| `web/src/App.css` | **Modify.** Pin styles, popup form styles, annotations list styles. |

---

## Architecture notes

- **Coordinate space:** Pins store SVG coordinates (`x`, `y`). Convert to Leaflet latlng with `svgToLatLng(x, y)` for rendering. This keeps pins stable unless the SVG itself changes — same drift behavior as everything else.
- **Pin mode vs. measure mode:** These should be mutually exclusive. If measure mode is on, pin mode can't be on, and vice versa. Use the same pattern: a boolean prop + callback.
- **Popup form in Leaflet:** Use a React portal or raw DOM manipulation. Leaflet popups accept HTML strings, so the simplest approach is a plain HTML form inside the popup with event listeners that call React state updaters via refs. Alternatively, use `react-leaflet`'s `Popup` component if the project already has it — but the project uses raw Leaflet, so raw DOM is fine.
- **Z-index:** Pins should be above terrain but below journey route lines and measure labels. Use `zIndexOffset` on markers.

---

## Deferred / out of scope

- Fog of war / exploration mode (Phase 7)
- Real-time collaboration (Phase 7+)
- Annotation categories or tags
- Annotation search/filter

---

## Resume point

Start by creating `web/src/utils/annotations.ts` with the data model and localStorage CRUD. Then add pin mode to `MapViewer.tsx`. Then build the popup edit form. Then wire the sidebar list and exports.

Reference: `research/2026-05-06-phase-6-research.md` §2.3 for original spec, §8 for sequencing.
