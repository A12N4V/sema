"""Derive the acquisition modalities present in a recording from its Info.

Drives what the UI shows: per-type signal scaling, scalp vs helmet vs
source-surface topomaps, and which processing stages appear (MEG gets SSS,
fNIRS gets the optical-density chain, etc.). See docs/ARCHITECTURE.md.
"""
from __future__ import annotations

import mne

_PRIMARY = {
    "eeg": {"eeg"},
    "meg": {"mag", "grad"},
    "seeg": {"seeg", "ecog", "dbs"},
    "fnirs": {"fnirs_cw_amplitude", "fnirs_fd_ac_amplitude", "fnirs_fd_phase", "fnirs_od", "hbo", "hbr"},
    "eyetrack": {"eyegaze", "pupil"},
}
_AUX = {"eog", "ecg", "emg", "bio", "gsr", "temperature", "resp", "stim", "misc"}


def detect_modalities(raw: mne.io.BaseRaw) -> dict:
    types = set(raw.get_channel_types())
    primary = [name for name, group in _PRIMARY.items() if group & types]
    aux = sorted(types & _AUX)
    counts: dict[str, int] = {}
    for t in raw.get_channel_types():
        counts[t] = counts.get(t, 0) + 1
    return {
        "primary": primary or ["eeg"],
        "aux": aux,
        "channel_types": sorted(types),
        "type_counts": counts,
    }
