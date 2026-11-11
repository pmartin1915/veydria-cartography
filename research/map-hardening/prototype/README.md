# Terrain prototype (2026-11-10)

Throwaway proof of the look for `../PLAN.md`. Not the pipeline: region shapes come from the
schematic's crude polygons, which is why biome edges are straight.

1. `python make_mask.py <worldbuilder>/geography/veydria-schematic.svg mask.svg`
2. Rasterize `mask.svg` at 2400x1600 to `mask.png` (Playwright `page.goto('file:///…/mask.svg')`
   then `page.screenshot`, viewport 2400x1600).
3. `python terrain_v3.py mask.png .` (needs numpy, scipy, numba, Pillow; about a minute)
4. `python render_v3.py .` writes `canon_A_skyrim.png` and `canon_B_biome.png`.

`lem.py` holds the landscape-evolution core: priority-flood depression filling, D8 receivers, and
Braun-Willett implicit stream-power incision. River threshold note: `flow` is log(drainage area in
m2), so a threshold must include log(cell area), which at 2 km cells is about 15.2.
