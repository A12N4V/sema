"""Format-sniffing EEG reader: file path -> mne.io.Raw.

MNE already has a reader per format; this just picks the right one from
the file extension so the API doesn't need the client to declare a format.
"""
from __future__ import annotations

from pathlib import Path

import mne

_READERS = {
    ".edf": mne.io.read_raw_edf,
    ".bdf": mne.io.read_raw_bdf,
    ".fif": mne.io.read_raw_fif,
    ".vhdr": mne.io.read_raw_brainvision,
    ".set": mne.io.read_raw_eeglab,
    ".cnt": mne.io.read_raw_cnt,
    ".gdf": mne.io.read_raw_gdf,
}

SUPPORTED_EXTENSIONS = sorted(_READERS.keys())


class UnsupportedFormatError(ValueError):
    pass


def load_raw(path: str | Path, preload: bool = True) -> mne.io.BaseRaw:
    """Load an EEG recording into an mne.io.Raw, sniffing format from extension.

    Raises UnsupportedFormatError for anything not in SUPPORTED_EXTENSIONS.
    """
    path = Path(path)
    ext = path.suffix.lower()
    reader = _READERS.get(ext)
    if reader is None:
        raise UnsupportedFormatError(
            f"No reader for {ext!r}. Supported: {', '.join(SUPPORTED_EXTENSIONS)}"
        )
    raw = reader(str(path), preload=preload, verbose="ERROR")
    return raw


def raw_summary(raw: mne.io.BaseRaw) -> dict:
    """JSON-serializable summary of a Raw's metadata for the info panel."""
    info = raw.info
    ch_types = raw.get_channel_types()
    type_counts: dict[str, int] = {}
    for t in ch_types:
        type_counts[t] = type_counts.get(t, 0) + 1

    annotations = [
        {"onset": float(a["onset"]), "duration": float(a["duration"]), "description": str(a["description"])}
        for a in raw.annotations
    ]

    return {
        "channel_names": raw.ch_names,
        "channel_types": ch_types,
        "channel_type_counts": type_counts,
        "n_channels": len(raw.ch_names),
        "sfreq": float(info["sfreq"]),
        "n_times": int(raw.n_times),
        "duration_seconds": float(raw.n_times / info["sfreq"]),
        "bads": list(info["bads"]),
        "highpass": float(info["highpass"]) if info["highpass"] is not None else None,
        "lowpass": float(info["lowpass"]) if info["lowpass"] is not None else None,
        "has_montage": raw.get_montage() is not None,
        "annotations": annotations,
        "meas_date": str(info["meas_date"]) if info["meas_date"] is not None else None,
    }
