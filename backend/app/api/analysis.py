"""Reads for the epoched containers: Epochs, Evoked, time-frequency.

Same division as everywhere else: the registry owns the verbs, these routes
only answer "what is in the container now". The wire shapes reuse the ones the
time-series panes already parse, so the frontend gets no new plotting code.
"""
from __future__ import annotations

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions/{session_id}", tags=["analysis"])

MAX_POINTS = 1200


def _get(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


def _decimate(x: np.ndarray, y: np.ndarray, max_points: int = MAX_POINTS):
    step = max(1, len(x) // max_points)
    return x[::step], y[..., ::step]


@router.get("/epochs/summary")
def epochs_summary(session_id: str) -> dict:
    """Counts, conditions and the drop log: the three things you check before
    trusting an average."""
    session = _get(session_id)
    with session.lock:
        ep = session.epochs
        if ep is None:
            raise HTTPException(status_code=400, detail="No epochs yet")
        drop_log = ep.drop_log
        dropped = [{"index": i, "reason": ", ".join(r)}
                   for i, r in enumerate(drop_log) if r and "IGNORED" not in r]
        counts = {}
        for name in ep.event_id:
            try:
                counts[name] = int(len(ep[name]))
            except KeyError:
                counts[name] = 0
        # Where each surviving trial sits in the *recording*, which is the only
        # thing that ties the epoch clock back to the transport cursor. Without
        # it the epoched panes have no way to answer "which trial am I looking
        # at right now", and they float free of the timeline.
        # Event samples are in the raw file's own indexing, so `first_samp` has
        # to come back off to land on `raw.times`. Epochs does not carry it;
        # the session's raw does.
        sf = float(ep.info["sfreq"])
        first = float(getattr(session.raw, "first_samp", 0))
        onsets = [(float(s_) - first) / sf + float(ep.tmin) for s_ in ep.events[:, 0]]
        return {
            "onsets": onsets,
            "n_epochs": int(len(ep)),
            "n_dropped": len(dropped),
            "drop_percent": float(ep.drop_log_stats()),
            "tmin": float(ep.tmin),
            "tmax": float(ep.tmax),
            "sfreq": float(ep.info["sfreq"]),
            "conditions": counts,
            "channels": list(ep.ch_names),
            "dropped": dropped[:200],
        }


@router.get("/epochs/image")
def epochs_image(session_id: str, channel: str = Query(...)) -> dict:
    """The ERP image: every trial as a row, sorted by trial order. One channel,
    because that is how it is read."""
    session = _get(session_id)
    with session.lock:
        ep = session.epochs
        if ep is None:
            raise HTTPException(status_code=400, detail="No epochs yet")
        if channel not in ep.ch_names:
            raise HTTPException(status_code=404, detail=f"No channel {channel!r}")
        data = ep.get_data(picks=[channel], copy=False)[:, 0, :] * 1e6
        times, data = _decimate(ep.times, data, 400)
        lim = float(np.percentile(np.abs(data), 98)) or 1.0
        return {"times": times.tolist(), "matrix": data.tolist(),
                "channel": channel, "vlim": lim, "n_epochs": int(data.shape[0])}


@router.get("/evoked")
def evoked(session_id: str) -> dict:
    """The butterfly plot, in the same wire shape as every other trace pane."""
    session = _get(session_id)
    with session.lock:
        ev = session.evoked
        if ev is None:
            raise HTTPException(status_code=400, detail="No evoked yet")
        times, data = _decimate(ev.times, ev.data * 1e6)
        gfp = data.std(axis=0)
        peak_ch, peak_t = ev.get_peak(ch_type="eeg", return_amplitude=False)
        return {
            "times": times.tolist(),
            "channels": list(ev.ch_names),
            "data": {name: data[i].tolist() for i, name in enumerate(ev.ch_names)},
            "gfp": gfp.tolist(),
            "nave": int(ev.nave),
            "peak_channel": str(peak_ch),
            "peak_time": float(peak_t),
            "comment": str(ev.comment or ""),
        }


@router.get("/tfr")
def tfr(session_id: str, channel: str | None = Query(None)) -> dict:
    """Power over time and frequency, averaged across channels unless one is
    named. Baseline-corrected in dB, which is the convention people read."""
    session = _get(session_id)
    with session.lock:
        power = session.tfr
        if power is None:
            raise HTTPException(status_code=400, detail="No time-frequency result yet")
        if channel and channel not in power.ch_names:
            raise HTTPException(status_code=404, detail=f"No channel {channel!r}")

        data = (power.data[power.ch_names.index(channel)] if channel
                else power.data.mean(axis=0))          # (freqs, times)
        base = power.times < 0
        if base.sum() >= 2:
            ref = data[:, base].mean(axis=1, keepdims=True)
            with np.errstate(divide="ignore", invalid="ignore"):
                data = 10 * np.log10(np.where(ref > 0, data / ref, np.nan))
            unit = "dB vs baseline"
        else:
            with np.errstate(divide="ignore"):
                data = 10 * np.log10(np.where(data > 0, data, np.nan))
            unit = "dB"
        data = np.nan_to_num(data, nan=0.0, posinf=0.0, neginf=0.0)
        times, data = _decimate(power.times, data, 300)
        lim = float(np.percentile(np.abs(data), 98)) or 1.0
        return {
            "times": times.tolist(),
            "freqs": [float(f) for f in power.freqs],
            "matrix": data.tolist(),
            "channels": list(power.ch_names),
            "channel": channel,
            "unit": unit,
            "vlim": lim,
        }
