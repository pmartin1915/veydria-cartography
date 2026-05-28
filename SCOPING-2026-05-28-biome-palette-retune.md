# SCOPING — Biome palette retune (F2)

**Date:** 2026-05-28
**Trigger:** Audit finding F2 (`SCOPING-2026-05-28-audit-findings.md`) — "Biome Colors layer doesn't differentiate per-cell biomes."
**Status:** Design-only; no code change until Perry approves the axis. Implementation when approved is a one-commit edit to `BIOME_COLORS` in `web/src/utils/hex-grid.ts:489-528`.

---

## What the audit actually saw

The audit said the renderer wasn't per-cell. That's wrong — `hex-overlay.ts:182-188` already keys each cell's fill by `BIOME_COLORS[biome]`, with 24 biome entries + 6 elevation fallbacks. The visual symptom the audit observed — "civ-level zones, not per-biome differentiation" — is real, but it's a **palette** problem, not a renderer problem. Neighbor biomes within a civ share hue families tightly enough that cells of different biomes read as cells of the same biome.

## Readability goal

Catan-style cell-to-cell read at continental zoom (z ≈ 2-3). A GM should be able to glance at a hex and answer "what biome" without zooming in to read a tooltip. Within a civ, cells with different biomes should look visibly different, not "all greens" or "all browns."

## Current palette — the clashes

```
Greens   #5e7a4a  Cloud forest
         #7a8848  Miombo woodland
         #94a468  Floodplain
         #8aaa5c  Oasis
         #a8b06a  Highland savanna
         #5a7e58  Mangrove swamp
         #6a8e5e  Monsoon delta
         (7 entries clustered in the #5-A green band)

Olives   #c4c290  Steppe
         #b4b878  Highland grassland
         (high-value olives — read as the same tinted paper at zoom 2)

Ochres   #d8c898  Sabkha
         #d4a76a  Desert
         #a89a6a  Highland
         #a89878  Escarpment
         #aaa86c  Hill
         (5 entries in warm beige band — desert vs sabkha vs escarpment all read as "tan")

Greys    #a6a89a  Afroalpine heath
         #adaa92  Stone baray
         #b0b8be  Fog bank
         (3 near-identical pale greys)
```

The greens and ochres are the worst offenders. Within Irrah (Desert/Sabkha/Oasis/Escarpment dominant) the four secondary biomes occupy three different hue families but all sit near the same saturation+value, so they blend at zoom-out. Within Ndjadi (Monsoon delta/Mangrove/Floodplain) the three secondary biomes are all in the green band and all near each other.

## Proposed axis

A two-dimensional warm/cool × wet/dry layout, with saturation as a third channel keyed to elevation:

```
                cool ←——————→ warm
        wet    cloud forest    monsoon delta
                mangrove        oasis
                fog bank        floodplain
        dry    afroalpine       desert
                stone baray     sabkha
                highland heath  escarpment
```

Recommended treatments:
- **Sea / strait / coral reef** keep the existing aqua/blue family — they're already distinct from land.
- **Within each quadrant** vary lightness by elevation: low = dark, high = light (matches how real terrain reads at altitude).
- **Within each elevation band** use small hue rotations to break ties (e.g., Mangrove gets a 10° pull toward teal, Floodplain a 10° pull toward yellow-green).
- **Volcanic archipelago** stays as a saturated rust outlier (visually a "warning" biome — already correct at `#7a543c`).
- **Rare biomes** (Coral reef, Stone baray, Mountain terrace, Geothermal vent) get high-saturation pops so they're scannable as the unusual cells they are.

Drop the elevation-fallback buckets (`Sea`, `Plains`, `Hill`, `Highland`, `Mountain`, `Peak`) into the same hue grid — they currently sit in the same olive/ochre cluster as the named biomes.

## Open questions for Perry

1. **Warm vs neutral bias.** The current palette pulls every hue 8-12° toward yellow (per the inline comment at hex-grid.ts:485-487, tuned against parchment). That helped legibility but suppressed cool biomes (Cloud forest, Mangrove). Keep the warm pull, or relax it so cool biomes read as cool?

2. **Civ cohesion as secondary signal.** Today, neighboring biomes within a civ accidentally cohere because they share hue families. Is that a feature (each civ has a "look") or a bug (per-biome read fails)? If it's a feature, the retune needs to preserve it intentionally — e.g., by shifting saturation but not hue within a civ's primary group.

3. **Stylized vs naturalistic.** Today's palette is naturalistic (greens = forest, browns = desert). Catan-tile readability would benefit from more saturated, less naturalistic colors (e.g., bright red for Volcanic, deep teal for Mangrove). Stay naturalistic, or push toward boardgame-tile saturation?

4. **Opacity interaction.** Hex fills render at `BIOME_FILL_OPACITY` (currently 0.3) over the schematic continent shapes. The schematic underneath shows civ colors, so any palette retune is filtered through that. Worth raising the opacity to 0.4-0.5 alongside a retune, or keep 0.3 and let the schematic dominate?

## Implementation when approved

A single edit to `BIOME_COLORS` in `web/src/utils/hex-grid.ts:489-528` replacing the 30 hex codes (24 biomes + 6 elevation buckets). No renderer changes; the existing per-cell path already keys correctly.

A visual diff would be helpful before merging: render the same map state with old vs new palette and compare at z=2, z=3, z=4. The `npm run sim:*` scripts don't cover visual rendering — this would need a manual side-by-side screenshot pass.

## Out of scope

- Renderer changes (already correct).
- Civ-color schematic (the parchment continent layer — separate concern).
- Per-biome icons or patterns (different solution to the same problem; revisit if palette alone doesn't solve it).
