"""Prototype v3: full canonical continent from the schematic's region mask.
python terrain_v3.py <mask.png (2400x1600, R channel = label)> <outdir>
Labels: 0 ocean,1-2 northern rim,3 Ngaru-Bon,4 Kheshkai,5 Irrah N,6 Irrah SE,7 southern rim,8 Ndjadi,9 Qollari,10 Basin,11 Oravan
"""
import sys, numpy as np
from PIL import Image
from scipy import ndimage as ndi
from lem import evolve

MASK, OUT = sys.argv[1], sys.argv[2]
KM_PER_UNIT = 4.0
lab_full = np.array(Image.open(MASK).convert('RGB'))[..., 0].astype(np.int16)  # 2 px/unit
lab_full[lab_full == 2] = 1

def spectral(shape, beta, seed, kmin=0.0, kmax=1.0):
    r = np.random.default_rng(seed); H, W = shape
    f = np.fft.fft2(r.standard_normal((H, W)))
    k = np.sqrt(np.fft.fftfreq(H)[:, None] ** 2 + np.fft.fftfreq(W)[None, :] ** 2); k[0, 0] = 1
    amp = k ** (-beta / 2); amp[(k < kmin) | (k > kmax)] = 0; amp[0, 0] = 0
    n = np.real(np.fft.ifft2(f * amp)); return (n - n.mean()) / n.std()

def smooth01(t): t = np.clip(t, 0, 1); return t * t * (3 - 2 * t)

def build(S, seed_off=0):
    """Designed macro elevation at S px/unit (from the warped label raster)."""
    H, W = 800 * S, 1200 * S
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    # domain warp in unit space -> organic coasts/borders (same seeds at any S: generated at S=1 then zoomed)
    wx1 = ndi.zoom(9 * spectral((800, 1200), 3.6, 11) + 2.5 * spectral((800, 1200), 2.8, 13), S, order=1)
    wy1 = ndi.zoom(9 * spectral((800, 1200), 3.6, 12) + 2.5 * spectral((800, 1200), 2.8, 14), S, order=1)
    ux = (xx + .5) / S + wx1; uy = (yy + .5) / S + wy1
    lab = ndi.map_coordinates(lab_full, [np.clip(uy * 2, 0, 1599), np.clip(ux * 2, 0, 2399)], order=0)
    sea = (lab == 0) | (lab == 10)
    land = ~sea
    land = ndi.binary_opening(land, iterations=1) | (lab == 11)  # keep islands
    sea = ~land
    dsea = ndi.distance_transform_edt(land) / S          # units to nearest water
    def dist_from(mask_lab):                              # units from given labels
        return ndi.distance_transform_edt(~mask_lab) / S
    h = np.zeros((H, W))
    # Northern rim: low hills
    h = np.where(lab == 1, 250 + 500 * smooth01(dsea / 40), h)
    # Ngaru-Bon: shelf (south) rising to crown (north)
    t = smooth01((200 - uy) / 110)
    h = np.where(lab == 3, 1300 + 600 * smooth01((215 - uy) / 30) + 2700 * t, h)
    # Kheshkai: lip over the wall rising north to interior; east fades lower/drier
    dwall = dist_from(np.isin(lab, [8, 6, 7, 5]))
    east = smooth01((ux - 1000) / 140)
    h = np.where(lab == 4, (2200 + 1900 * smooth01(dwall / 160)) * (1 - 0.35 * east), h)
    # Irrah N lobe: gravel plateau, escarpment rising toward Ngaru-Bon
    h = np.where(lab == 5, 350 + 450 * smooth01((260 - uy) / 50), h)
    # Irrah SE lobe: thorn-steppe rising to frankincense escarpments near the SE coast
    h = np.where(lab == 6, 300 + 1000 * smooth01(1 - dsea / 60) * smooth01(dsea / 4), h)
    # Southern rim: low upland, steep short seaward face
    h = np.where(lab == 7, 250 + 550 * smooth01(dsea / 18), h)
    # Ndjadi: sinking trough, tilted down toward the neck (~560,380) so it drains there
    dneck = np.hypot(ux - 560, uy - 380)
    h = np.where(lab == 8, 4 + 46 * smooth01(dneck / 420), h)
    # Qollari: highland massif, foothills toward the NE
    dq = dist_from(lab != 9)
    h = np.where(lab == 9, 1200 + 3000 * smooth01(dq / 70), h)
    # Oravan: volcanic cones per island
    isl, n = ndi.label(lab == 11)
    for i in range(1, n + 1):
        m = isl == i
        cy, cx = ndi.center_of_mass(m); r = np.sqrt(m.sum() / np.pi)
        d = np.hypot(yy - cy, xx - cx) / max(r, 1)
        h = np.where(m, np.maximum(20, 2800 * np.clip(1 - d, 0, 1) ** 1.6 * min(1, r / (20 * S))), h)
    # smooth the region steps; keep the wall and shelf sharper
    hs = ndi.gaussian_filter(h, 6 * S)
    sharp = ndi.gaussian_filter(h, 1.5 * S)
    near_wall = smooth01(1 - np.minimum(dist_from(lab == 4), dist_from(lab == 3)) / 12)
    h = np.where(land, sharp * near_wall + hs * (1 - near_wall), h)
    # relief noise, amplitude by region
    amp = ndi.gaussian_filter(np.select([lab == 3, lab == 4, lab == 9, lab == 11, lab == 7, lab == 1, lab == 6, lab == 5, lab == 8],
                                        [1300, 700, 1100, 300, 300, 300, 250, 220, 3], 0).astype(float), 5 * S)
    ridged = (1 - np.abs(ndi.zoom(spectral((800, 1200), 1.7, 21, kmin=0.006, kmax=0.08), S, order=3))) ** 3
    low = ndi.zoom(spectral((800, 1200), 3.0, 22), S, order=3)
    h = h + amp * (1.3 * ridged - 0.3) + 0.25 * amp * low
    h = np.where(land, np.minimum(np.maximum(h, 2), 10 + dsea * 160 + (lab == 11) * 4000), 0)
    # bathymetry: Basin shallow, ocean deeper
    dl = ndi.distance_transform_edt(sea) / S
    bdepth = np.where(lab == 10, -20 - 140 * smooth01(dl / 60), -40 - 3000 * smooth01(dl / 120))
    h = np.where(sea, bdepth, h)
    K = ndi.gaussian_filter(np.select([lab == 3, lab == 4, lab == 9, lab == 7, lab == 1, lab == 11, lab == 6, lab == 5],
                                      [1.0, 0.45, 1.0, 0.8, 0.6, 0.9, 0.3, 0.12], 0.05).astype(float), 4 * S)
    # Kheshkai's wet south wall erodes hard
    K = np.where(lab == 4, K + 0.9 * smooth01(1 - dwall / 35), K)
    return h, sea, lab, K

# coarse: 1 px/unit
h, sea, lab, K = build(1)
cell = KM_PER_UNIT * 1000
he, A = evolve(np.where(sea, -50.0, h), sea, np.zeros_like(h), K * 4e-5, iters=60, dt=500.0, cell=cell, m=0.5, diffuse=0.1)
he = np.where(sea, h, he)
print('coarse', float(he[~sea].min()), float(he[~sea].max()))
# fine: 2 px/unit, use coarse result as the macro field + fine detail
h2, sea2, lab2, K2 = build(2)
z = ndi.zoom(he, 2, order=3)
det = spectral(z.shape, 2.4, 41, kmin=0.01, kmax=0.2)
gy, gx = np.gradient(z); relief = np.clip(ndi.gaussian_filter(np.hypot(gx, gy), 2) / 150, 0, 1)
z = z + (15 + 250 * relief) * det * 0.6
z = np.where(sea2, np.minimum(h2, -15), np.maximum(z, 2))
zf, A2 = evolve(z, sea2, np.zeros_like(z), K2 * 2e-5, iters=8, dt=400.0, cell=cell / 2, m=0.5, diffuse=0.05)
zf = np.where(sea2, h2, zf)
np.save(f'{OUT}/elev.npy', zf.astype(np.float32)); np.save(f'{OUT}/label.npy', lab2.astype(np.int8))
np.save(f'{OUT}/flow.npy', np.log1p(A2).astype(np.float32))
print('fine', zf.shape, float(zf.min()), float(zf.max()))
