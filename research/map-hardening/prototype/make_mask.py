"""Build a flat-colour region mask from worldbuilder's canonical schematic.

python make_mask.py <worldbuilder>/geography/veydria-schematic.svg mask.svg
then rasterize mask.svg at 2400x1600 (e.g. Playwright page.screenshot of the file; see README).
Red channel of the raster = region label:
  0 ocean, 1-2 northern rim, 3 Ngaru-Bon, 4 Kheshkai, 5 Irrah north lobe, 6 Irrah SE lobe,
  7 southern rim, 8 Ndjadi floodplain, 9 Qollari, 10 Aethelian Basin, 11 Oravan islands

Prototype only: the schematic's region shapes are crude polygons, which is why the prototype shows
straight biome edges. The real pipeline derives physical regions from elevation and climate.
"""
import re, sys

SRC, DST = sys.argv[1], sys.argv[2]
s = open(SRC, encoding='utf8').read()
body = s[s.find('</defs>'):]
WANT = {'#c4a862': '#010000', '#9fae5a': '#020000', 'url(#crown)': '#030000', '#a8b86a': '#040000',
        '#d4a854': '#050000', '#dcc584': '#060000', '#8b7355': '#070000', '#3a8a3a': '#080000',
        '#2d6b3f': '#090000', '#3a7ca5': '#0a0000', '#6aba6a': '#0b0000', '#4a9a4a': '#0b0000',
        '#5aaa5a': '#0b0000'}
out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="2400" height="1600" '
       'shape-rendering="crispEdges"><rect width="1200" height="800" fill="#000000"/>']
seen = set()
for m in re.finditer(r'<(path|polygon)\b([^>]*?)/?>', body, re.S):
    a = m.group(2); f = re.search(r'\bfill="([^"]*)"', a)
    if not f or f.group(1) not in WANT or 'translate' in a:
        continue
    g = re.search(r'\b(d|points)="([^"]*)"', a)
    key = (WANT[f.group(1)], g.group(2)[:40])
    if key in seen:
        continue
    seen.add(key)
    out.append(f'<{m.group(1)} {g.group(1)}="{g.group(2)}" fill="{WANT[f.group(1)]}" stroke="none"/>')
out.append('</svg>')
open(DST, 'w').write('\n'.join(out))
print(len(seen), 'shapes')
