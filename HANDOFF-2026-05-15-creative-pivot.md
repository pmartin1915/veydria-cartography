# Handoff — Creative Pivot: Historically Grounded Veydria (2026-05-15)

**Date:** 2026-05-15
**Branch:** master (working tree clean)
**Commits:** 5 ahead of origin/master
**Tests:** 489/489 pass (27 files)
**Build:** green (~470 kB JS, ~113 kB CSS)
**Python validation:** green
**Dev server:** running on `192.168.1.208:5173` (network + localhost)

---

## What happened this session

1. **Wrapped the previous instance's work** — Session HUD, per-hex annotations in prep, static map regeneration, mobile iOS scroll polish. All committed, tests green.
2. **Updated MASTER.md** — synced with shipped state: 489 tests, cleared backlog, added Session HUD / per-hex prep / static regen / mobile polish to feature inventory and Shipped section.
3. **Launched dev server with `--host`** — both PC (`localhost:5173`) and phone (`192.168.1.208:5173`) accessible for real-device testing.

---

## The Pivot

The user is switching to Claude and wants to maintain every technical thing we've built, but **pivot the creative tone of the worldbuilding**:

> **More realistic, adult, and historically accurate fiction.** Use real historical events and figures as models, parallels, and inspirations to give Veydria depth and intrigue.

This is a **creative/data direction change**, not a technical teardown. The interactive map, all 3,052 features, the YAML pipeline, the React frontend, the tests, the session-prep tools — all of it stays. The change is in *what the world says about itself*.

---

## What this means in practice

### The data layer
`data/veydria-topology.yaml` is the source of truth. It contains:
- Feature names, descriptions, categories
- Civilization blurbs and relationships
- Trade route narratives
- Port / chokepoint / landmark / sacred site lore

**These are the strings that need to evolve.** The user wants them to feel like they were written by someone who has read real history — not generic fantasy filler.

**Key sections in the YAML to focus on:**
- `civilizations:` — each civ's `description`, `culture`, `government`, `economy`
- `trade_routes:` — `description`, `economic_role`, `strategic_importance`
- `features:` — `description` fields for ports, chokepoints, sacred sites, contested sites, landmarks
- `relationships:` — the `type`, `description`, and `history` of edges between civilizations

**Important constraint:** `data/veydria-topology.yaml` is **read-only in this repo** per AGENTS.md. The canonical source is the `worldbuilder` repo upstream. Per the sync protocol:
1. Edit in `worldbuilder/geography/continents/veydria-topology.yaml`
2. Run `node scripts/sync-world-data.mjs` (or `npm run sync:data` from `web/`)
3. This copies the updated YAML into `data/veydria-topology.yaml` and regenerates `web/public/veydria-spatial.geojson`

**However** — for this creative pass, you may want to iterate locally first before pushing upstream. The sync script is one-way (worldbuilder → here). If you edit `data/veydria-topology.yaml` directly for rapid iteration, just remember to backport the final version to worldbuilder so the canonical source doesn't drift.

### Historical parallels — suggested anchors

The user wants real historical depth. Some natural anchors for Veydria's existing structure:

| Veydria element | Historical parallel opportunity |
|---|---|
| Aethelian Basin as neutral trade pivot | The Adriatic in the 15th c., the Baltic Hanseatic League, the Strait of Malacca |
| Six port cities with distinct architectural traditions | Venice vs. Genoa vs. Ottoman ports, or the Swahili city-states |
| Highland steppes north | Mongol successor states, the Kazakh Khanates, the Tibetan plateau polities |
| Southern oasis chains | The Trans-Saharan trade network, Silk Road oasis towns (Samarkand, Kashgar) |
| Copper-for-Steel Road | Commodity chokepoint conflicts — Baltic amber, Sudanese gold, Anatolian iron |
| Harbor Oath War / metal interdict | Real mercantile wars: Anglo-Dutch Wars, Opium Wars, but grounded in pre-industrial material scarcity |
| Ngaru-Bon ↔ Irrah rivalry | Byzantine-Sasanian competition, or Ming-Timurid posturing |
| Sacred sites with dual religious claims | Jerusalem, Mount Kailash, the Hajj routes — contested holiness |
| Chokepoints (red pins on map) | Thermopylae, the Khyber Pass, the Danish Straits — real terrain dictating real politics |

The existing feature names and civ names (`Ngaru-Bon`, `Irrah`, `Kheshkai`, `Qollari`, `Ndjadi`, `Oravan`) do not need to change. The user wants the *prose around them* to feel historically literate.

### The MAP-PROMPT.md
`data/MAP-PROMPT.md` is the visual specification for the Python parchment renderer. It currently describes aesthetic choices (ink color, line weight, paper texture). If the user wants the *visual* tone to shift too — grittier, more aged, less fantasy-clean — this is the file to adjust. But confirm with them first; the pivot may be purely textual.

### The web app — what stays, what flexes

**Stays exactly as-is:**
- All components, layers, tools, shortcuts
- Session prep, HUD, hex grid, journey planner, AI Lore, calendar, etc.
- All 489 tests
- Build pipeline, CI, sync scripts

**Flexes with the new data:**
- `InfoPanel` descriptions — richer, denser prose will look good in the right-hand panel
- `FactionGraph` relationship labels — if relationship descriptions get longer/historically richer, the SVG layout may need adjustment
- `SessionPrepPanel` / `SessionHud` — the prep list surfaces feature names and snippets; richer names may truncate differently
- `CampaignLog` markdown export — the prose quality of exported logs improves automatically if the source YAML improves
- `AdventureHooks` — the hook generator draws from feature categories and descriptions; richer source = richer hooks. But the pools in `feature-hooks.ts` are hardcoded fantasy tropes. If the user wants hooks to feel historically grounded too, the category pools may need a pass.
- `AILore` prompts — the `buildPrompt()` function constructs prompts from feature context. If the source YAML becomes historically dense, the AI Lore output will naturally improve.

---

## Suggested workflow for the pivot

1. **Audit a representative slice** — pick 3-4 features (one port, one chokepoint, one civ, one trade route) and rewrite their descriptions as a proof-of-concept. Show the user. Iterate on tone.
2. **Define the voice** — is this *Livy* (grand narrative), *Ibn Khaldun* (cyclical rise/fall), *Fernand Braudel* (material determinism), *Amitav Ghosh* (trade-network humanism)? Get a one-sentence compass from the user before bulk-editing.
3. **Batch-rewrite by category** — ports first, then civs, then trade routes, then landmarks. The YAML is large (~3,052 features) but only a minority have rich descriptions. Most are spatial entries with minimal prose.
4. **Preserve gameable detail** — this is still a GM workbench. Every description should answer "what do the players see/do/feel here?" even while sounding like real history.
5. **Validate after sync** — run `python pipeline.py validate` after YAML changes, `npm test` after any frontend adjustments.

---

## Technical reminders

- The dev server is running (`192.168.1.208:5173`). Kill it with `taskkill /F /PID <pid>` when done.
- The QR code image `qr-mobile.png` is in the repo root — untracked, can be deleted.
- `HANDOFF-2026-05-15-mobile-audit.md` exists but was not used — contains the mobile checklist from `HANDOFF-2026-05-09c`.
- The user is going to Claude for this pivot. Coordinate on which files Claude should own vs. which you should handle.

---

## Next plausible moves

- **Tone sample** — user + Claude agree on a 200-word exemplar description (e.g. rewrite `aethelian_basin` or `copper_for_steel_road`).
- **Category pass** — bulk-rewrite all ports, or all civ descriptions, in one session.
- **Relationship edges** — historically ground the `relationships:` block with real-politik texture (trade concessions, tributary obligations, dynastic marriages, excommunication equivalents).
- **Map-prompt visual shift** — if the user wants the parchment render to feel older/grittier too.
- **Worldbuilder upstream sync** — backport final YAML changes to the canonical repo so `scripts/sync-world-data.mjs` doesn't overwrite them.

---

## Verification

```bash
cd web && npm test -- --run        # 489/489 pass
cd web && npm run build             # green
cd generator && python pipeline.py validate  # green
```
