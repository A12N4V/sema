"""Preprocessing operations — thin wrappers over Raw's in-place MNE methods.

Each function mutates the given Raw and returns nothing; the API layer is
responsible for re-serializing raw_summary() afterwards so the client sees
the effect (e.g. new sfreq after resampling, new highpass/lowpass after
filtering).
"""
from __future__ import annotations

from typing import Optional

import mne


def apply_bandpass(raw: mne.io.BaseRaw, l_freq: Optional[float], h_freq: Optional[float]) -> None:
    """Band-pass (or high-pass / low-pass if one bound is None)."""
    raw.filter(l_freq=l_freq, h_freq=h_freq, verbose="ERROR")


def apply_notch(raw: mne.io.BaseRaw, freqs: list[float]) -> None:
    """Notch out line noise (and harmonics) at the given frequencies."""
    raw.notch_filter(freqs=freqs, verbose="ERROR")


def apply_resample(raw: mne.io.BaseRaw, sfreq: float) -> None:
    raw.resample(sfreq, verbose="ERROR")


def set_bad_channels(raw: mne.io.BaseRaw, bads: list[str]) -> None:
    unknown = set(bads) - set(raw.ch_names)
    if unknown:
        raise ValueError(f"Unknown channel(s): {sorted(unknown)}")
    raw.info["bads"] = bads


def apply_reference(raw: mne.io.BaseRaw, ref_channels: str | list[str] = "average") -> None:
    """Re-reference. ref_channels='average' for common average reference,
    or a list of channel names (e.g. ['A1', 'A2']) for a specific reference.
    """
    raw.set_eeg_reference(ref_channels=ref_channels, verbose="ERROR")


def set_montage(raw: mne.io.BaseRaw, montage_name: str) -> None:
    """Apply a standard sensor montage (e.g. 'standard_1020') by name —
    needed for topomaps when the file doesn't already carry electrode
    positions.
    """
    montage = mne.channels.make_standard_montage(montage_name)
    raw.set_montage(montage, match_case=False, on_missing="warn", verbose="ERROR")
