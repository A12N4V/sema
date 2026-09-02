from __future__ import annotations

import numpy as np
from fastapi import APIRouter, HTTPException

from app.models.schemas import TraceWindowRequest, TraceWindowResponse
from app.services.session_manager import sessions
from app.utils.decimate import minmax_decimate

router = APIRouter(prefix="/api/sessions/{session_id}/viewer", tags=["viewer"])


@router.post("/window", response_model=TraceWindowResponse)
async def trace_window(session_id: str, req: TraceWindowRequest) -> TraceWindowResponse:
    try:
        session = sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    raw = session.raw
    sfreq = raw.info["sfreq"]
    start_sample = int(req.start * sfreq)
    stop_sample = int((req.start + req.duration) * sfreq)
    stop_sample = min(stop_sample, raw.n_times)
    if start_sample >= stop_sample:
        raise HTTPException(status_code=400, detail="Requested window is out of range")

    channels = req.channels or raw.ch_names
    unknown = set(channels) - set(raw.ch_names)
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown channel(s): {sorted(unknown)}")

    data, times = raw.get_data(
        picks=channels, start=start_sample, stop=stop_sample, return_times=True
    )
    data_uv = data * 1e6  # volts -> microvolts, the conventional EEG display unit

    traces: dict[str, list[float]] = {}
    time_out = times
    for i, ch in enumerate(channels):
        t_dec, y_dec = minmax_decimate(data_uv[i], times, max_points=req.max_points)
        traces[ch] = y_dec.tolist()
        time_out = t_dec  # identical bucketing across channels since same window/decimation

    return TraceWindowResponse(
        channels=channels, sfreq=sfreq, time=time_out.tolist(), traces=traces,
    )
