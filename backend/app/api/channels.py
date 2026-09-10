"""The channel table and the annotation list: two reads the UI needs and MNE
does not expose as one shape.

Writes go through the operation registry (``rename_channels``,
``set_channel_types``, ``drop_channels``, ``set_bads``, ``set_annotations``), so
everything a user does here lands in the ledger and in pipeline.py. These
routes are read-only on purpose.
"""
from __future__ import annotations

import numpy as np
from fastapi import APIRouter, HTTPException

from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions/{session_id}", tags=["channels"])


def _get(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/channels")
def channels(session_id: str) -> dict:
    """One row per channel with the numbers you sort a table by.

    The metrics are computed on a decimated slice rather than the whole
    recording: this endpoint is polled whenever the signal changes, and a full
    pass over an hour of 128 channels is not worth the two extra significant
    figures.
    """
    session = _get(session_id)
    with session.lock:
        raw = session.raw
        n = raw.n_times
        step = max(1, n // 30_000)
        data = raw.get_data(start=0, stop=n, reject_by_annotation=None)[:, ::step]
        montage = raw.get_montage()
        pos = {}
        if montage is not None:
            dig = montage.get_positions()["ch_pos"]
            pos = {k: v for k, v in dig.items() if v is not None and not np.isnan(v).any()}

        rows = []
        for i, name in enumerate(raw.ch_names):
            row = data[i]
            finite = row[np.isfinite(row)]
            scale = 1e6 if raw.get_channel_types()[i] in ("eeg", "eog", "ecg", "emg") else 1.0
            rows.append({
                "index": i,
                "name": name,
                "type": raw.get_channel_types()[i],
                "bad": name in raw.info["bads"],
                "has_position": name in pos,
                "unit": "µV" if scale != 1.0 else "",
                "mean": float(finite.mean() * scale) if finite.size else 0.0,
                "std": float(finite.std() * scale) if finite.size else 0.0,
                "peak_to_peak": float((finite.max() - finite.min()) * scale) if finite.size else 0.0,
                "flat": bool(finite.size and float(finite.std()) < 1e-14),
            })
    return {"channels": rows, "sampled_every": step}


@router.get("/annotations")
def annotations(session_id: str) -> dict:
    session = _get(session_id)
    with session.lock:
        annot = session.raw.annotations
        items = [
            {"index": i,
             "onset": float(o),
             "duration": float(d),
             "description": str(desc),
             "bad": str(desc).upper().startswith("BAD")}
            for i, (o, d, desc) in enumerate(zip(annot.onset, annot.duration, annot.description))
        ]
        labels = sorted({a["description"] for a in items})
        # inside the lock with the rest: a resample landing between the
        # annotation read and this one returns a duration that does not belong
        # to the annotations above it, and the client draws spans off the end
        duration = float(session.raw.times[-1]) if session.raw.n_times else 0.0
    return {"annotations": items, "labels": labels, "duration": duration}
