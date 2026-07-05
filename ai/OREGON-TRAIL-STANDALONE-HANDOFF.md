# Veydria Trail — standalone game build handoff

Status: **handoff authored 2026-07-01. Not started.** Greenlight AFTER the in-repo Trail mode
v1 ships and playtests (staged plan: in-repo teaches what's fun; this repo is the full game).

Evidence base: `C:\Users\perry\DevProjects\oregon_trail.agent.final.md` (12-dimension deep
research swarm, cross-verified). This doc translates it into an executable scaffold; cite the
research for any "why". Where this doc and the research disagree, this doc wins (it encodes
later decisions).

## Decisions already made (do not relitigate)

| Decision | Value | Research basis |
|---|---|---|
| Engine | **Phaser 4** (WebGL2, ~500 KB min); fallback Excalibur.js if Phase 0 gates fail | Dim 01 — 6 engines × 11 criteria; Godot/Bevy eliminated (TS ecosystem mismatch) |
| Repo shape | New repo `veydria-trail`, pnpm workspace monorepo, `workspace:*` links | Dim 02/10 |
| Lore bridge | `packages/game-data` imports Zod schemas from worldbuilder, exports pure mappers. Engine NEVER imports worldbuilder directly | Dim 02 — lore-reactive architecture |
| PRNG | **sfc32** seeded via **cyrb128** hash of player choices; 15-iteration warm-up; state (4×uint32) serialized in every save | Dim 07 |
| Replay | Input-based (seed + decision log, ~2 KB / 150-day run); `REPLAY_ASSERT` dev mode | Dim 07 |
| Testing | fast-check property-based tests for the 8 invariants (food ≥ 0, mileage monotonic, health bounds, date validity, inventory ≤ capacity, event validity, dead ⇔ health 0, money conservation) + golden-seed snapshots | Dim 07 |
| Visual target | **VGA 256-color primary** (the 1990 DOS original was Mode 13h VGA — archival: `VGA256.BGI` + `PAL.256` on disk, no `EGAVGA.BGI`) with **EGA-16 legacy toggle** derived by quantization | Dim 09 — invalidated the Gemini baseline's "strict EGA" claim |
| Resolution | 320×200 internal, integer scaling, nearest-neighbor, 5:6 pixel-aspect correction (×1.2 horizontal), CRT effects OFF by default | Dim 04/09 |
| Font | "Perfect DOS VGA 437" (free, exact IBM 9×16 recreation) | Dim 09 |
| Dithering | Bayer 4×4 ordered (animation-stable), pre-processed in Aseprite; runtime shader only for dynamic effects | Dim 04 |
| Audio | Web Audio `PCSpeaker` class (square-wave OscillatorNode + low-pass ~4 kHz, ~20 lines) first; Tone.js for music later. iOS: gesture-unlock + silent `<audio>` mute-switch workaround | Dim 05 |
| iOS | Capacitor 8.x (+ haptics + filesystem plugins to clear "web wrapper" review bar). PWA is NOT a primary channel on iOS in 2026 | Dim 06 |
| Saves | JSON (~10–15 KB) in IndexedDB, 5-s debounced autosave, `schemaVersion` int, 3 manual slots + export | Dim 12 |

## Repo scaffold

```
veydria-trail/
├── pnpm-workspace.yaml            # packages/* + apps/*
├── packages/
│   ├── game-data/                 # Zod bridge: imports worldbuilder schemas,
│   │                              #   GameProfessionSchema, mapFactionToProfession()
│   ├── engine-core/               # PURE sim: sfc32+cyrb128, daily tick loop,
│   │                              #   JourneyState (research §2.3.5), replay, FSM.
│   │                              #   No Phaser imports — engine-agnostic by contract.
│   └── asset-pipeline/            # CLI: palette lint, Aseprite batch clamp, atlas pack
├── apps/
│   ├── game-web/                  # Vite + Phaser 4; scenes = FSM states
│   │                              #   (Traveling/Stopped/Resting/Hunting/Crossing/Event/Town)
│   └── game-ios/                  # Capacitor 8 (generated; Phase 3)
├── assets/
│   ├── source/                    # .aseprite masters
│   ├── ai-raw/                    # Retro Diffusion / PixelLab raw output (pre-clamp)
│   └── palettes/
│       ├── veydria-vga256.json    # master palette — see Asset pipeline
│       └── ega-16.json            # legacy toggle (quantized derivative)
└── .github/workflows/ci.yml       # lint → typecheck → palette-lint → build (≤5,120 KB budget)
```

Worldbuilder integration note: the research assumes worldbuilder exports Zod schemas from a
pnpm package. **Verify what worldbuilder actually exports before scaffolding** — if it's YAML
canon without a published package, `game-data` starts by owning the Zod schemas + a loader for
synced YAML (same pattern as cartography's `sync-world-data.mjs`), and the `workspace:*` link
becomes a later migration. Do not block the scaffold on worldbuilder packaging.

## Phase plan (16 weeks nominal, solo, 15–20 h/wk — research §6.2)

- **Phase 0 (wk 1–2) — substrate gates, go/no-go:** parallax travel screen (4-layer,
  TileSprite) at 60 fps on iOS Safari; deterministic save round-trip (day-5 save reload →
  identical subsequent events); Web Audio unlock on iOS. ANY failure → documented pivot to
  Excalibur.js (same `game-data` types) before content investment.
- **Phase 1 (wk 3–6) — vertical slice:** one biome, 10 events, shop, hunting minigame, river
  crossing (ford/ferry/caulk), scoring. Done = 15-min playthrough, every screen reachable.
- **Phase 2 (wk 7–12) — Veydria integration:** professions via faction mapper; events;
  conlang flavor (interpretive only — names/epitaphs, never a puzzle gate); full asset pipeline.
- **Phase 3 (wk 13–16) — polish:** CRT toggle, accessibility toggles (colorblind patterns,
  200% text, motion-reduction — additive, default = authentic), TestFlight.

## Reuse from veydria-cartography (in-repo Trail mode v1)

- **Sim-calibrated constants**: health-transition thresholds + `HUNT_ODDS` from
  `web/src/utils/trail.ts` once `sim:trail` calibration finalizes them (they are PROVISIONAL
  as of 2026-07-01; harness: `npm run sim:trail-report`). Carry the dead-constant warning:
  Savanna/Forest/Highland/Scrubland biome names are unreachable from current geojson.
- **Design invariants** from `ai/OREGON-TRAIL-SPEC.md`: graduated bidirectional health,
  death-is-a-roll, dead-is-absorbing, set-once epitaphs, party-wiped orthogonal to supply.
- **Content**: ailment/epitaph vocabulary per civ (Step 4 of the in-repo build), hunt odds,
  the OT→Veydria disease mapping table.
- **Playtest learnings**: whatever the in-repo v1 teaches about pacing/fun — capture in
  `ai/IDEAS.md` before starting this repo.
- **All Track C assets** (palette, sprites, animations) — pipeline below is shared.

## Asset pipeline (Track C — can start before this repo exists)

Chain: **generate (AI) → downscale (nearest-neighbor) → quantize to master palette →
Bayer 4×4 dither → validate (palette lint) — Aseprite is the mandatory terminal gate.**
No AI tool can enforce an indexed palette during diffusion (research Dim 03); budget for
post-processing on every asset.

- **Palette first**: curate `veydria-vga256.json` — 256-entry earth-tone/sky/fabric palette in
  the spirit of the original `PAL.256` but Veydria-toned (sabkha whites, dune ochres, basin
  blues). Derive `ega-16.json` by quantization. Every generation prompt and every Aseprite
  clamp references these files.
- **Tool assignment** (research Dim 03, corrected claims):
  - **PixelLab** (MCP server already connected in Claude Code): characters, 4-frame walk
    cycles, skeleton animation, draft-beast teams, hunt fauna. 128×128 cap; expect frame
    drift → fix in Aseprite.
  - **Retro Diffusion website/API** (credits ~$0.01 ea): hero statics — landmark scenes, title
    screen, fort screens. NOTE: the $65 Aseprite extension does NOT include animation and runs
    weaker models than the website — the Gemini baseline overstated it.
  - **Aseprite (manual)**: UI frames/buttons, vehicle bounce (2–3 frames by hand beats prompt
    engineering), all final clamping.
- **Vehicle/animation grammar**: rigid translateY bounce 1–3 px, no squash-stretch; 3-phase
  draft-animal walk; weather = ground-band color change + ≤100 single-color particles.
- **PoC batch** (do this first, validates the whole chain): one draft-beast walk cycle +
  one party-member sprite + one landmark scene, through all five stages, rendered at 320×200
  integer-scaled in a browser, palette-lint clean.

## Deferred decisions (listed, deliberately unresolved)

- **Supabase tombstone server + leaderboard anti-cheat** (research §5.3): design is solid
  (RLS rate-limit, 5-layer validation), but it's a public-multiplayer feature — decide after
  the game has outside players. Layers 1–4 minimum if/when built; replay verification (5) later.
- **Steam/Tauri desktop**: cheap once web build exists; not a v1 target.
- **Magic-as-corruption** (research §5.1.4): explicitly a design HYPOTHESIS (MEDIUM
  confidence) — prototype in the vertical slice, playtest, and be willing to cut it.
- **Profession matrix** (6 classes, −0.89 capital/multiplier correlation): adopt the structure,
  but re-derive the class list from actual worldbuilder canon rather than the research's
  invented faction names (Core League / Ashland Clans / Shatter Covenant are NOT Veydria canon
  — the research generalized; real civs are the six from cartography: Ngaru-Bon, Irrah,
  Kheshkai, Ndjadi, Qollari, Oravan).

## Optional appendix — scoped follow-up research prompt (deep-research-swarm)

Only if wanted later; the build is not blocked on it:

> "Veydria Trail visual identity: within a strict 320×200 / 256-color VGA Oregon Trail (1990)
> presentation, how should six distinct fantasy civilizations (riverine delta, high desert,
> steppe horse-clans, mountain terraces, cloud forest, island seafarers) be made visually
> distinguishable in sprites, portraits, landmark scenes, and UI chrome without breaking the
> MECC-era art grammar? Deliver: per-civ 16-swatch sub-palettes from a shared 256 master,
> costume/silhouette guides, landmark scene compositions, and a hunting-minigame art+design
> spec (top-down vs side-view, input model, fauna set) consistent with 1990 hardware idioms."
