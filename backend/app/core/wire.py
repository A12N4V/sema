"""One serialization shape for every time-series payload the frontend plots.

``to_wire`` turns an ``(n_channels, n_samples)`` array + a time vector into a
compact JSON-ready dict. The frontend has exactly one parser for waveform
windows, minimap overviews, IC time courses and TFR marginals.

Also holds the montage geometry + instantaneous-field helpers that feed the
3D scalp field panel.
"""
from __future__ import annotations

from typing import Any

import mne
import numpy as np

from app.utils.decimate import minmax_decimate


def to_wire(
    data: np.ndarray,
    times: np.ndarray,
    channels: list[str],
    *,
    max_points: int = 2000,
    unit_scale: float = 1e6,
) -> dict[str, Any]:
    """data: (n_channels, n_samples) in volts. Returns µV, decimated.

    Shape: ``{channels, sfreq, t0, dt, time, data:{ch:[...]}}``, ``time`` is
    shared across channels (identical bucketing).
    """
    data = np.asarray(data, dtype=float) * unit_scale
    times = np.asarray(times, dtype=float)

    time_out = times
    out: dict[str, list[float]] = {}
    for i, ch in enumerate(channels):
        t_dec, y_dec = minmax_decimate(data[i], times, max_points=max_points)
        out[ch] = [float(v) for v in y_dec]
        time_out = t_dec

    dt = float(time_out[1] - time_out[0]) if len(time_out) > 1 else 0.0
    return {
        "channels": list(channels),
        "sfreq": (1.0 / (times[1] - times[0])) if len(times) > 1 else 0.0,
        "t0": float(time_out[0]) if len(time_out) else 0.0,
        "dt": dt,
        "time": [float(t) for t in time_out],
        "data": out,
    }


def window(
    raw: mne.io.BaseRaw,
    start: float,
    duration: float,
    channels: list[str] | None = None,
    max_points: int = 2000,
) -> dict[str, Any]:
    sfreq = raw.info["sfreq"]
    s0 = max(0, int(start * sfreq))
    s1 = min(raw.n_times, int((start + duration) * sfreq))
    if s1 <= s0:
        s1 = min(raw.n_times, s0 + 1)
    picks = channels or raw.ch_names
    data, times = raw.get_data(picks=picks, start=s0, stop=s1, return_times=True)
    return to_wire(data, times, picks, max_points=max_points)


def overview(raw: mne.io.BaseRaw, n_bins: int = 1200) -> dict[str, Any]:
    """A whole-recording envelope for the minimap: RMS across EEG channels per bin."""
    picks = mne.pick_types(raw.info, eeg=True, meg=False, exclude="bads")
    if len(picks) == 0:
        picks = np.arange(min(len(raw.ch_names), 32))
    data = raw.get_data(picks=picks)  # (n_ch, n_times) volts
    n_times = data.shape[1]
    n_bins = min(n_bins, n_times)
    edges = np.linspace(0, n_times, n_bins + 1, dtype=int)
    rms = np.empty(n_bins)
    for i in range(n_bins):
        chunk = data[:, edges[i]:edges[i + 1]]
        rms[i] = np.sqrt(np.mean(chunk ** 2)) * 1e6 if chunk.size else 0.0
    dur = n_times / raw.info["sfreq"]
    t = (np.arange(n_bins) + 0.5) * (dur / n_bins)
    return {
        "t": [float(v) for v in t],
        "rms": [float(v) for v in rms],
        "duration": float(dur),
    }


def _pos2d(info: mne.Info, ch_names: list[str]) -> np.ndarray:
    """Normalized 2D topomap coords in [-1, 1] for the given channels."""
    from mne.channels.layout import _find_topomap_coords

    picks = mne.pick_channels(info["ch_names"], ch_names, ordered=True)
    coords = _find_topomap_coords(info, picks=picks, ignore_overlap=True)
    coords = np.asarray(coords, dtype=float)
    # scale to unit disc
    rad = np.max(np.linalg.norm(coords, axis=1)) or 1.0
    return coords / rad


def montage_layout(raw: mne.io.BaseRaw) -> dict[str, Any]:
    """Electrode geometry for the scalp field: 2D disc coords + 3D head coords."""
    montage = raw.get_montage()
    eeg_picks = mne.pick_types(raw.info, eeg=True, exclude=())
    ch_names = [raw.ch_names[i] for i in eeg_picks]
    if montage is None or not ch_names:
        return {"channels": ch_names, "pos2d": [], "pos3d": [], "has_montage": False}

    pos = montage.get_positions()["ch_pos"]
    pos3d = []
    keep = []
    for ch in ch_names:
        p = pos.get(ch)
        if p is None or np.any(np.isnan(p)):
            continue
        keep.append(ch)
        pos3d.append([float(p[0]), float(p[1]), float(p[2])])
    if not keep:
        return {"channels": [], "pos2d": [], "pos3d": [], "has_montage": False}

    arr3d = np.asarray(pos3d)
    center = arr3d.mean(axis=0)
    scale = np.max(np.linalg.norm(arr3d - center, axis=1)) or 1.0
    arr3d = (arr3d - center) / scale

    coords2d = _pos2d(raw.info, keep)
    return {
        "channels": keep,
        "pos2d": [[float(x), float(y)] for x, y in coords2d],
        "pos3d": [[float(x), float(y), float(z)] for x, y, z in arr3d],
        "has_montage": True,
    }


def field_at(raw: mne.io.BaseRaw, t: float, channels: list[str]) -> dict[str, Any]:
    """Instantaneous µV value per channel at the sample nearest ``t``."""
    sfreq = raw.info["sfreq"]
    s = int(np.clip(round(t * sfreq), 0, raw.n_times - 1))
    data = raw.get_data(picks=channels, start=s, stop=s + 1)[:, 0] * 1e6
    return {
        "t": float(s / sfreq),
        "channels": list(channels),
        "values": [float(v) for v in data],
    }
