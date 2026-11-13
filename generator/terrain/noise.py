"""Seeded spectral noise (PHASE3-SPEC section 4).

Every field is FFT-filtered white noise, generated on the coarse 1200x800
grid (1 px/unit) and upsampled so coarse and fine stages see the same field.

- The seed of a field is the first 8 bytes of
  ``sha256(f"{master_seed}:{field_name}")`` — never Python's ``hash()``.
- A field is a sum of wavelength bands; each band is normalised to unit
  maximum, so the sum is bounded by 1 at every pixel before upsampling
  (linear interpolation never overshoots the bound).
- Optional anisotropy scales the wavenumber 3:1 along a grain angle, giving
  ridges parallel to the grain.

Determinism: no numba here, no parallelism, float64 inside, fixed seeds.
"""

from __future__ import annotations

import hashlib
from typing import Optional, Sequence

import numpy as np
from scipy import ndimage

# The coarse grid is 1 px/unit (spec section 4).
COARSE_SHAPE = (800, 1200)  # (rows, cols) = (height_u, width_u)


def field_seed(master_seed: int, field_name: str) -> int:
    """Seed of a noise field: first 8 bytes of sha256(f"{master_seed}:{field_name}")."""
    digest = hashlib.sha256(f"{master_seed}:{field_name}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "little")


def _band(
    master_seed: int,
    field_name: str,
    wavelength_range: tuple[float, float],
    beta: float,
    anisotropy_deg: Optional[float],
    anisotropy_ratio: float,
) -> np.ndarray:
    """One band-pass spectral octave on the coarse grid, normalised to max 1."""
    rows, cols = COARSE_SHAPE
    rng = np.random.default_rng(field_seed(master_seed, field_name))
    white = rng.standard_normal((rows, cols))
    spectrum = np.fft.fft2(white)
    # fftfreq is cycles per sample; on the coarse grid 1 sample = 1 unit,
    # so k is already in cycles per unit.
    ky = np.fft.fftfreq(rows)[:, None]
    kx = np.fft.fftfreq(cols)[None, :]
    if anisotropy_deg is None:
        k = np.hypot(ky, kx)
    else:
        theta = np.radians(anisotropy_deg)
        along = kx * np.cos(theta) + ky * np.sin(theta)
        across = -kx * np.sin(theta) + ky * np.cos(theta)
        k = np.hypot(anisotropy_ratio * along, across)
    k_max_wl, k_min_wl = 1.0 / float(wavelength_range[0]), 1.0 / float(wavelength_range[1])
    k[0, 0] = 1.0  # avoid 0 ** -beta/2 at DC; DC is zeroed below anyway
    amp = np.power(k, -beta / 2.0)
    amp[(k < k_min_wl) | (k > k_max_wl)] = 0.0
    amp[0, 0] = 0.0
    field = np.real(np.fft.ifft2(spectrum * amp))
    peak = np.max(np.abs(field))
    if peak <= 0.0:  # pragma: no cover - degenerate empty band
        return field
    return field / peak


def spectral_field(
    master_seed: int,
    field_name: str,
    ppu: int,
    bands: Sequence[tuple[float, float, float]],
    beta: float = 3.0,
    anisotropy_deg: Optional[float] = None,
    anisotropy_ratio: float = 3.0,
) -> np.ndarray:
    """Bounded (-1..1) spectral noise field at `ppu` px/unit.

    `bands` is a list of (wavelength_lo_u, wavelength_hi_u, amplitude); the
    combined field is the amplitude-weighted sum of unit-max octaves, divided
    by the total amplitude, so |field| <= 1 everywhere. The field is generated
    on the coarse grid and upsampled (order 1) to the fine grid.
    """
    total: Optional[np.ndarray] = None
    norm = 0.0
    for n, (wl_lo, wl_hi, amplitude) in enumerate(bands):
        octave = _band(
            master_seed, f"{field_name}:{n}", (wl_lo, wl_hi), beta,
            anisotropy_deg, anisotropy_ratio,
        )
        total = octave * amplitude if total is None else total + octave * amplitude
        norm += float(amplitude)
    assert total is not None
    total /= norm
    if int(ppu) == 1:
        return total
    return ndimage.zoom(total, int(ppu), order=1)
