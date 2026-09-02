"""Power spectral density and canonical band-power summaries."""
from __future__ import annotations

import numpy as np
import mne

BANDS = {
    "delta": (1, 4),
    "theta": (4, 8),
    "alpha": (8, 13),
    "beta": (13, 30),
    "gamma": (30, 45),
}


def compute_psd(raw: mne.io.BaseRaw, fmin: float = 1.0, fmax: float = 45.0,
                 picks: list[str] | None = None) -> dict:
    """Welch PSD averaged over the whole recording (or current epochs' picks).

    Returns freqs (Hz) and psd per channel in dB (10*log10 µV²/Hz), which is
    the conventional display unit for EEG PSD plots.
    """
    spectrum = raw.compute_psd(method="welch", fmin=fmin, fmax=fmax, picks=picks, verbose="ERROR")
    psd, freqs = spectrum.get_data(return_freqs=True)  # psd: (n_channels, n_freqs), V^2/Hz
    psd_db = 10 * np.log10(psd * (1e6 ** 2) + np.finfo(float).eps)  # V^2 -> µV^2, then dB

    ch_names = spectrum.ch_names
    return {
        "freqs": freqs.tolist(),
        "channels": ch_names,
        "psd_db": psd_db.tolist(),
    }


def compute_band_power(raw: mne.io.BaseRaw, picks: list[str] | None = None) -> dict:
    """Mean power per canonical band per channel, from a Welch PSD."""
    fmin = min(b[0] for b in BANDS.values())
    fmax = max(b[1] for b in BANDS.values())
    spectrum = raw.compute_psd(method="welch", fmin=fmin, fmax=fmax, picks=picks, verbose="ERROR")
    psd, freqs = spectrum.get_data(return_freqs=True)
    ch_names = spectrum.ch_names

    band_power: dict[str, list[float]] = {}
    for band, (lo, hi) in BANDS.items():
        mask = (freqs >= lo) & (freqs < hi)
        band_power[band] = np.mean(psd[:, mask], axis=1).tolist() if mask.any() else [0.0] * len(ch_names)

    return {"channels": ch_names, "bands": band_power}
