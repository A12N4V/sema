"""Build mne.Epochs from either existing annotations or a fixed-length grid."""
from __future__ import annotations

import mne


def epochs_from_annotations(raw: mne.io.BaseRaw, tmin: float, tmax: float,
                             event_id: dict[str, int] | None = None) -> mne.Epochs:
    events, found_event_id = mne.events_from_annotations(raw, verbose="ERROR")
    if len(events) == 0:
        raise ValueError("No annotations/events found in this recording")
    epochs = mne.Epochs(
        raw, events, event_id=event_id or found_event_id,
        tmin=tmin, tmax=tmax, baseline=None, preload=True, verbose="ERROR",
    )
    return epochs


def fixed_length_epochs(raw: mne.io.BaseRaw, duration: float, overlap: float = 0.0) -> mne.Epochs:
    events = mne.make_fixed_length_events(raw, duration=duration, overlap=overlap)
    epochs = mne.Epochs(
        raw, events, tmin=0, tmax=duration, baseline=None, preload=True, verbose="ERROR",
    )
    return epochs


def epochs_summary(epochs: mne.Epochs) -> dict:
    return {
        "n_epochs": len(epochs),
        "tmin": float(epochs.tmin),
        "tmax": float(epochs.tmax),
        "event_id": {k: int(v) for k, v in epochs.event_id.items()},
        "channel_names": epochs.ch_names,
        "sfreq": float(epochs.info["sfreq"]),
    }
