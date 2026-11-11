"""Render canonical-continent prototype. python render_v3.py <dir>"""
import sys, numpy as np
from scipy import ndimage as ndi
from PIL import Image
D = sys.argv[1]
elev = np.load(f'{D}/elev.npy').astype(np.float64); lab = np.load(f'{D}/label.npy'); flow = np.load(f'{D}/flow.npy')
cell = 2000.0
land = elev > 0
zl = ndi.gaussian_filter(np.where(land, elev, 0), 0.7)

def hillshade(z, az, alt, exag):
    gy, gx = np.gradient(z * exag, cell)
    slope = np.arctan(np.hypot(gx, gy)); aspect = np.arctan2(-gx, gy)
    a, al = np.radians(360 - az + 90), np.radians(alt)
    return np.clip(np.sin(al) * np.cos(slope) + np.cos(al) * np.sin(slope) * np.cos(a - aspect), 0, 1)

EX = 9
hs = (0.55 * hillshade(zl, 315, 38, EX) + 0.2 * hillshade(zl, 270, 50, EX) +
      0.15 * hillshade(zl, 360, 55, EX) + 0.10 * hillshade(zl, 225, 60, EX))
flat = hillshade(np.zeros_like(zl), 315, 38, EX)          # shade value of flat ground
hs = hs / flat.mean()                                     # flat ground -> 1.0
ao = np.clip(1 - np.clip(ndi.gaussian_filter(zl, 4) - zl, 0, None) / 300, 0.6, 1)
ao *= np.clip(1 - np.clip(ndi.gaussian_filter(zl, 18) - zl, 0, None) / 1500, 0.75, 1)
gy, gx = np.gradient(zl, cell); slope = np.degrees(np.arctan(np.hypot(gx, gy) * EX / 3))
grain = ndi.gaussian_filter(np.random.default_rng(1).standard_normal(elev.shape), 1.0) * 0.02

def hexs(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)
def ramp(z, stops):
    zs = np.array([s[0] for s in stops], float); cs = np.array([hexs(s[1]) for s in stops])
    return np.stack([np.interp(z, zs, cs[:, i]) for i in range(3)], -1)

def render(pal, name):
    rgb = np.zeros(elev.shape + (3,))
    wsum = np.zeros(elev.shape + (1,))
    for labs, stops in pal['regions']:
        w = ndi.gaussian_filter(np.isin(lab, labs).astype(float), 5)[..., None]
        rgb += w * ramp(elev, stops); wsum += w
    rgb /= np.clip(wsum, 1e-3, None)
    rock = hexs(pal['rock']); steep = np.clip((slope - 22) / 20, 0, 1)[..., None] * 0.55
    rgb = rgb * (1 - steep) + rock * steep
    sn = np.clip((elev - pal['snow']) / 350 - np.clip(slope - 35, 0, 30) / 30 + grain * 8, 0, 1)[..., None] * land[..., None]
    rgb = rgb * (1 - sn) + hexs('#eef0f1') * sn
    shade = np.clip(hs, 0, 1.6)[..., None] ** 1.1 * ao[..., None]
    rgb = rgb * (pal['amb'] + (1 - pal['amb']) * shade) * (1 + grain[..., None])
    # rivers from flow accumulation (subtle, width by flow)
    riv = np.clip((flow - pal['riv_thr']) / 2.5, 0, 1) * land
    riv = ndi.gaussian_filter(riv, 0.6)[..., None]
    rgb = rgb * (1 - riv * 0.75) + hexs(pal['river']) * riv * 0.75
    # water: depth ramp + subtle shelf; Basin lighter
    depth = np.clip(-elev, 0, 3500)
    sea = ramp(depth, pal['sea'])
    basinish = ndi.gaussian_filter((lab == 10).astype(float), 8)[..., None]
    sea = sea * (1 - 0.25 * basinish) + hexs(pal['shallow']) * 0.25 * basinish
    rgb = np.where(land[..., None], rgb, sea)
    coast = (ndi.binary_dilation(land, iterations=1) & ~land)[..., None]
    rgb = np.where(coast, rgb * 0.62, rgb)
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).save(f'{D}/{name}.png')

base_sea = [(0, '#6c8a92'), (60, '#5f7f88'), (400, '#4f6f7a'), (3000, '#33505c')]
# A: Skyrim-literal — desaturated, cool, grey-green & stone, region color whispered
A = dict(rock='#7b7872', snow=4300, amb=0.18, riv_thr=23.0, river='#5d7a84', shallow='#8aa5aa', sea=base_sea, regions=[
    ([1], [(0, '#8a8a72'), (800, '#86836f')]),
    ([3], [(0, '#878070'), (2000, '#7f7a70'), (4000, '#76736e'), (5200, '#8c8b88')]),
    ([4], [(0, '#8c8a72'), (2500, '#8a876f'), (4000, '#86826f')]),
    ([5, 6], [(0, '#a49a80'), (1500, '#9a8f78')]),
    ([7], [(0, '#8d8a72'), (900, '#86836f')]),
    ([8], [(0, '#7d8668'), (60, '#7a8466')]),
    ([9], [(0, '#76806a'), (2500, '#737a68'), (4500, '#7d7b74')]),
    ([11], [(0, '#78846a'), (3000, '#7b7a72')]),
])
# B: biome relief — same light/terrain, Veydria's climates legible but desaturated
B = dict(rock='#7d776d', snow=4400, amb=0.2, riv_thr=23.0, river='#4f7686', shallow='#8fb0b2', sea=[(0, '#7798a0'), (60, '#628690'), (400, '#4d6e7b'), (3000, '#2f4a57')], regions=[
    ([1], [(0, '#a7a27a'), (800, '#9a9473')]),                                    # northern rim: dry scrub
    ([3], [(0, '#6f7a5a'), (1600, '#717757'), (2800, '#7c7666'), (4000, '#77736f'), (5200, '#8f8d8a')]),  # shelf forest -> crown rock
    ([4], [(0, '#7f8a5c'), (2400, '#9a9a6c'), (3400, '#a29c7c'), (4400, '#9a927e')]),  # lip green -> high cold steppe
    ([5], [(0, '#c8ad7e'), (800, '#bfa274')]),                                    # Irrah N: desert
    ([6], [(0, '#b9a379'), (1200, '#a8936e')]),                                   # Irrah SE: thorn-steppe
    ([7], [(0, '#9c9a6c'), (900, '#8f8b69')]),                                    # southern rim
    ([8], [(0, '#6d8456'), (60, '#728858')]),                                     # floodplain: monsoon green
    ([9], [(0, '#5f7552'), (2500, '#677253'), (3600, '#7a7563'), (4500, '#85817a')]),  # Qollari cloud forest -> puna
    ([11], [(0, '#62794f'), (1500, '#6f7458'), (3000, '#6e6a64')]),               # Oravan volcanic green
])
render(A, 'canon_A_skyrim'); render(B, 'canon_B_biome')
print('ok')
