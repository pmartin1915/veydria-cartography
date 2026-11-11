"""Landscape evolution: priority-flood + Braun-Willett implicit stream-power incision (numba)."""
import math, heapq, numpy as np
from numba import njit

D8 = np.array([(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)], np.int64)
DL = np.array([math.sqrt(2), 1, math.sqrt(2), 1, 1, math.sqrt(2), 1, math.sqrt(2)])

@njit(cache=True)
def priority_flood(h, sea, eps):
    """Fill depressions so every land cell drains to the sea (or edge). Binary heap over flat arrays."""
    H, W = h.shape
    out = h.copy(); done = np.zeros((H, W), np.bool_)
    cap = H * W + 8
    hv = np.empty(cap); hi = np.empty(cap, np.int64); n = 0
    for y in range(H):
        for x in range(W):
            if sea[y, x] or y == 0 or x == 0 or y == H - 1 or x == W - 1:
                done[y, x] = True
                # push
                hv[n] = out[y, x]; hi[n] = y * W + x; c = n; n += 1
                while c > 0:
                    p = (c - 1) // 2
                    if hv[p] <= hv[c]: break
                    hv[p], hv[c] = hv[c], hv[p]; hi[p], hi[c] = hi[c], hi[p]; c = p
    while n > 0:
        v = hv[0]; idx = hi[0]; n -= 1
        hv[0] = hv[n]; hi[0] = hi[n]; c = 0
        while True:
            l = 2 * c + 1; r = l + 1; s = c
            if l < n and hv[l] < hv[s]: s = l
            if r < n and hv[r] < hv[s]: s = r
            if s == c: break
            hv[s], hv[c] = hv[c], hv[s]; hi[s], hi[c] = hi[c], hi[s]; c = s
        y = idx // W; x = idx % W
        for k in range(8):
            ny = y + D8[k, 0]; nx = x + D8[k, 1]
            if ny < 0 or nx < 0 or ny >= H or nx >= W or done[ny, nx]: continue
            done[ny, nx] = True
            if out[ny, nx] <= v + eps: out[ny, nx] = v + eps
            hv[n] = out[ny, nx]; hi[n] = ny * W + nx; c = n; n += 1
            while c > 0:
                p = (c - 1) // 2
                if hv[p] <= hv[c]: break
                hv[p], hv[c] = hv[c], hv[p]; hi[p], hi[c] = hi[c], hi[p]; c = p
    return out

@njit(cache=True)
def receivers(h, sea):
    H, W = h.shape
    rec = np.arange(H * W); dist = np.ones(H * W)
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            if sea[y, x]: continue
            best = 0.0; bk = -1
            for k in range(8):
                ny = y + D8[k, 0]; nx = x + D8[k, 1]
                s = (h[y, x] - h[ny, nx]) / DL[k]
                if s > best: best = s; bk = k
            if bk >= 0:
                rec[y * W + x] = (y + D8[bk, 0]) * W + x + D8[bk, 1]; dist[y * W + x] = DL[bk]
    return rec, dist

@njit(cache=True)
def area_and_incise(hf, order, rec, dist, U, K, m, dt, cell, sea):
    N = hf.size; A = np.full(N, cell * cell)
    for j in range(N - 1, -1, -1):
        i = order[j]; r = rec[i]
        if r != i: A[r] += A[i]
    for j in range(N):
        i = order[j]; r = rec[i]
        if r == i or sea[i]: continue
        F = K[i] * dt * A[i] ** m / (dist[i] * cell)
        hf[i] = (hf[i] + dt * U[i] + F * hf[r]) / (1 + F)
    return A

def evolve(h, sea, U, K, iters, dt, cell, m=0.45, diffuse=0.0):
    from scipy import ndimage as ndi
    h = h.copy()
    for it in range(iters):
        h = priority_flood(h, sea, 1e-3)
        rec, dist = receivers(h, sea)
        flat = h.ravel().copy(); order = np.argsort(flat, kind='stable')
        A = area_and_incise(flat, order, rec, dist, U.ravel(), K.ravel(), m, dt, cell, sea.ravel())
        h = flat.reshape(h.shape)
        if diffuse > 0:
            h = np.where(sea, h, h + diffuse * (ndi.uniform_filter(h, 3) - h))
    return h, A.reshape(h.shape)
