# Handoff — Map + Compendium Merge + Historically Grounded Tone Pivot

**Date:** 2026-05-15
**Instance:** Kimi Code CLI → Claude Cowork
**Context:** User wants to maintain all technical features but pivot narrative tone to historically accurate fiction.

---

## What Kimi Has Done (Engineering — Phase 1 Complete)

### ✅ Data Bridge
- `scripts/sync-world-data.mjs` now copies `canon.json`, `search-index.json`, and `map-anchors.json` from worldbuilder
- Files land in `web/public/` and are fetched at runtime
- `npm run sync:data` or `node scripts/sync-world-data.mjs` refreshes them

### ✅ Compendium Panel (new component)
**Path:** `web/src/components/CompendiumPanel.tsx`

Features ported/adapted from worldbuilder:
- **Browse tab** — searchable card grid of all 188 entities
- **Civilizations tab** — 7 civ cards → per-civ entity listings
- **Lenses tab** — 8 lens tiles (Calendars, Cross-civ, Crises, Magic, Traditions, Resources, Institutions, Named Figures)
- **Entity detail** — name, meta tags, summary, markdown body (via `marked`), cross-references, map anchor button
- **Ego-network graph** — radial SVG layout showing outgoing (green) and incoming (blue) cross-refs; click to navigate
- **CalendarCompare** — 7×8 grid (civs × sections) for calendar institutions; special render in Calendars lens
- **Clickable cross-references** — related entities are buttons that navigate

### ✅ Bridge Wiring
- "Show on Map" button in entity detail → switches to map mode → `flyTo` feature → opens InfoPanel
- Maps worldbuilder kinds (`magic-register`, `religion-tradition`, etc.) to cartography categories

### ✅ UI Integration
- "Compendium" button in header (next to Prep)
- Full-screen overlay with close button
- `C` keyboard shortcut (toggles compendium)
- `Escape` closes compendium
- Documented in KeyboardHelp (`?` overlay)
- Dark parchment CSS theme matching the app

### ✅ URL State Persistence
- Hash params sync both ways: `?id=`, `?tab=`, `?q=`, `?civPage=`, `?lens=`
- Back/forward navigation works
- Bookmarkable compendium links

### ✅ Tests
- `compendium-data.test.ts` — 12 tests for loading, caching, entity queries
- All existing tests preserved: **501/501 pass** (28 files)
- Build green

### Commits on master since handoff
```
1c6cb0d feat: compendium clickable cross-references
9360aa1 feat: compendium CalendarCompare lens
4044002 feat: compendium URL state persistence
1973f58 feat: compendium ego-network graph
662d486 feat: compendium keyboard shortcut (C) + Escape + help docs
b0222e5 feat: compendium panel — Phase 1 merge into cartography
27d3f1d docs: handoff for Claude — map+compendium merge + tone pivot
ad45291 docs: update MASTER.md
```

---

## What's Still Open for Claude

### Phase 2: Content (The Tone Pivot)

This is the **creative** half. The user wants historically grounded fiction.

**Where to work:**
- `worldbuilder/factions/` — civ descriptions, cross-civ matrices
- `worldbuilder/magic/` — magic system narratives
- `worldbuilder/religion/` — traditions, institutions, calendar institutions
- `worldbuilder/timeline/` — historical events
- `worldbuilder/ecology/` — biome narratives
- `worldbuilder/economy/` — resource governance
- `worldbuilder/law/` — legal architectures (actively being written)
- `worldbuilder/geography/continents/veydria-topology.yaml` — feature descriptions

**Suggested workflow:**
1. **Sample** — rewrite 1-2 descriptions (Aethelian Basin, Copper-for-Steel Road) to lock voice with the user
2. **Voice compass** — propose: Livy, Ibn Khaldun, Braudel, Ghosh, Thucydides
3. **Batch by category** — ports → civs → routes → magic → religion → matrices → calendars → law
4. **Preserve gameability** — every description answers "what do players see/do/feel here?"
5. **Regenerate canon** — `node scripts/extract-canon.mjs` after markdown changes
6. **Validate** — `npm run validate` (worldbuilder) + `cd web && npm test` (cartography)
7. **Sync** — `node scripts/sync-world-data.mjs` to pull updated YAML + canon into cartography

### Phase 3: Engineering Follow-ups (Optional)

If Claude wants to extend the compendium further:
- **MatrixCardGrid** for cross-civ relationships (dyad cards with density badges)
- **Markdown link rewriting** — convert worldbuilder internal links to compendium navigation
- **Body-text search ranking** — currently simple token match; could weight title matches higher
- **Mobile polish** — compendium overlay on small screens could use bottom-sheet treatment
- **Performance** — `canon.json` is 228KB; could stream or paginate if it grows

---

## Quick Reference

### Run both apps
```bash
# Cartography (rich map + compendium)
cd veydria-cartography/web && npm run dev
# → http://localhost:5173

# Worldbuilder (legacy map-viewer + source of truth)
cd worldbuilder && npm run validate
cd worldbuilder/tools/map-viewer && npm run dev
# → http://localhost:5174
```

### Sync protocol
```bash
cd veydria-cartography
node scripts/sync-world-data.mjs
```

### Key files
| File | Purpose |
|---|---|
| `web/src/components/CompendiumPanel.tsx` | Main compendium container |
| `web/src/components/compendium/EgoNetwork.tsx` | Relationship graph |
| `web/src/components/compendium/CalendarCompare.tsx` | 7×8 calendar grid |
| `web/src/utils/compendium-data.ts` | Data loader + queries |
| `web/public/canon.json` | 188 entities (synced from worldbuilder) |
| `design/narrative-schema/canon.json` | Worldbuilder canonical entity corpus |

---

## Verification

```bash
cd veydria-cartography/web && npm test -- --run        # 501/501 pass
cd veydria-cartography/web && npm run build             # green
cd veydria-cartography/generator && python pipeline.py validate  # green
cd worldbuilder && npm run validate                     # 18 pass
cd worldbuilder && node scripts/canon-canary.mjs        # clean
```
