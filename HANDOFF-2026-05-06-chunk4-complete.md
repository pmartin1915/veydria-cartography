# Handoff — Chunk 4: Map Annotations ✅ COMPLETE

*Date: 2026-05-06*
*Prev chunks: Chunk 2 (lore cards + difficulty) ✅, Chunk 3 (encounters) ✅, Chunk 4 (annotations) ✅*
*Build: ✅ `npm run build` passes*

---

## What was built

### 4.1 Pin tool state & UI
- **New `pinMode` state** in `App.tsx` — toggled via header button or `P` key
- **Pin button** in top toolbar (next to Measure) — shows "Pin" / "Drop pin..." states
- **Mutual exclusion:** Pin mode disables measure mode and journey mode, and vice versa
- **Cursor:** `crosshair` when pin mode is active (`.map-container.pin-mode`)
- **Auto-exit:** After dropping a pin, pin mode turns off automatically

### 4.2 Persistence layer
- **New file:** `web/src/utils/annotations.ts` (~180 lines)
  - `loadAnnotations()` / `saveAnnotations()` — `localStorage` under `veydria-annotations-v1`
  - `createAnnotation(x, y, label?, body?, color?)` — factory with UUID
  - `updateAnnotation()` / `deleteAnnotation()` / `addAnnotation()` — CRUD + auto-save
  - `annotationsNearRoute()` — point-to-segment distance, finds pins within 40px of any route segment
  - `exportAnnotationsMarkdown()` — standalone campaign notes
  - `exportRouteGmNotes()` — GM Notes section for route markdown
  - Color palette: Parchment, Rust, Sea, Forest, Charcoal

### 4.3 Edit panel (Leaflet popup)
- **Popup form** on clicking any pin:
  - Label input (single line)
  - Body textarea (3 rows)
  - Color picker (5-color palette with active indicator)
  - Save + Delete buttons
  - Created timestamp
- **Drag to reposition:** Pins are `draggable: true`, coordinates update on `dragend`
- **Event cleanup:** Listeners attached on `popupopen`, removed on `popupclose`

### 4.4 Annotations sidebar list
- **Collapsible section** at bottom of JourneyPlanner sidebar
- Lists all pins with colored dot + label + body snippet
- Clicking a list item calls `mapRef.current?.flyToAnnotation(ann)`
- "Export Notes" button copies all annotations as markdown

### 4.5 Export integration
- **Route markdown** now includes `### GM Notes` section (before footer) with nearby annotations
- **Standalone export** via "Export Notes" button in sidebar

### 4.6 MapViewer integration
- Pins render in dedicated `L.LayerGroup` (`annotationLayerRef`)
- `zIndexOffset: 500` — above terrain, below route lines and measure labels
- `flyToAnnotation()` added to imperative handle

---

## Files modified / created

| File | Action |
|---|---|
| `web/src/utils/annotations.ts` | **Created.** Persistence, CRUD, factory, export, route proximity. |
| `web/src/components/MapViewer.tsx` | **Modified.** Pin mode click handler, annotation rendering, popup edit form, drag handling, `flyToAnnotation`. |
| `web/src/components/JourneyPlanner.tsx` | **Modified.** Annotations list section, export button, GM Notes in markdown export. |
| `web/src/components/KeyboardHelp.tsx` | **Modified.** Added `P` shortcut. |
| `web/src/App.tsx` | **Modified.** Pin mode state, annotation state, callbacks, header button, keyboard shortcuts. |
| `web/src/App.css` | **Modified.** Pin styles, popup form styles, annotations list styles. |

---

## How to test

1. Press `P` or click the **Pin** button in the header
2. Click anywhere on the map → a pin drops with default label "New Pin"
3. Click the pin → popup opens with edit form
4. Change label, body, color → **Save**
5. Drag the pin to reposition
6. Open JourneyPlanner sidebar → **Campaign Notes** section shows all pins
7. Click a pin in the list → map flies to it
8. Compute a route → **Copy Markdown** includes `### GM Notes` with nearby pins
9. Click **Export Notes** → copies all pins as standalone markdown
10. Press `Esc` or click **Pin** again to cancel pin mode

---

## Architecture notes

- **Coordinate space:** Pins store SVG coordinates (`x`, `y`). Converted to Leaflet latlng for rendering.
- **Pin mode vs. measure mode:** Mutually exclusive at the App level. MapViewer click handler checks measure mode first, then pin mode.
- **Popup form:** Raw Leaflet popup with HTML content + DOM event listeners. Callbacks accessed via refs to avoid stale closures.
- **Z-index:** Pins at 500, journey route labels at 998, measure labels at 999+.

---

## Deferred / out of scope

- Fog of war / exploration mode (Phase 7)
- Real-time collaboration (Phase 7+)
- Annotation categories or tags
- Annotation search/filter
- Print/export PNG
