"""Format-sniffing EEG/MEG/fNIRS reader: file path -> mne.io.Raw.

Tries MNE's own auto-detecting ``mne.io.read_raw`` first, then falls back to
the extension map for formats it doesn't cover.
"""
from __future__ import annotations

from pathlib import Path

import mne

from app.core.modality import detect_modalities

# Fallback map for formats mne.io.read_raw doesn't auto-detect.
_READERS = {
    ".edf": mne.io.read_raw_edf,
    ".bdf": mne.io.read_raw_bdf,
    ".gdf": mne.io.read_raw_gdf,
    ".fif": mne.io.read_raw_fif,
    ".vhdr": mne.io.read_raw_brainvision,
    ".set": mne.io.read_raw_eeglab,
    ".cnt": mne.io.read_raw_cnt,
    ".mff": mne.io.read_raw_egi,
    ".lay": mne.io.read_raw_persyst,
    ".nxe": mne.io.read_raw_eximia,
    ".snirf": mne.io.read_raw_snirf,
    ".sqd": mne.io.read_raw_kit,
    ".con": mne.io.read_raw_kit,
    ".ds": mne.io.read_raw_ctf,
    ".asc": mne.io.read_raw_eyelink,
    ".cdt": mne.io.read_raw_curry,
    ".vmrk": mne.io.read_raw_brainvision,   # sidecar → point at the .vhdr
}

# What the Connect screen advertises (self-contained single-file formats first).
SUPPORTED_EXTENSIONS = sorted({
    ".edf", ".bdf", ".gdf", ".fif", ".vhdr", ".set", ".cnt", ".mff",
    ".lay", ".nxe", ".snirf", ".sqd", ".con", ".ds", ".asc", ".cdt",
})


class UnsupportedFormatError(ValueError):
    pass


def load_raw(path: str | Path, preload: bool = True) -> mne.io.BaseRaw:
    """Load a recording into an mne.io.Raw. Auto-detect first, extension map next."""
    path = Path(path)
    ext = path.suffix.lower()
    if ext == ".vmrk":
        path = path.with_suffix(".vhdr")
        ext = ".vhdr"

    try:
        return mne.io.read_raw(str(path), preload=preload, verbose="ERROR")
    except (ValueError, RuntimeError, NotImplementedError):
        pass  # fall through to the explicit reader

    reader = _READERS.get(ext)
    if reader is None:
        raise UnsupportedFormatError(
            f"No reader for {ext!r}. Supported: {', '.join(SUPPORTED_EXTENSIONS)}"
        )
    return reader(str(path), preload=preload, verbose="ERROR")


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
        "modalities": detect_modalities(raw),
    }
