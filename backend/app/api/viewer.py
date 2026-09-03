from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core import wire
from app.models.schemas import TraceWindowRequest
from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions/{session_id}/viewer", tags=["viewer"])


# Sync def (not async): decimation reads run in FastAPI's threadpool so a slow
# window fetch never blocks the event loop for other sessions.
@router.post("/window")
def trace_window(session_id: str, req: TraceWindowRequest) -> dict:
    try:
        session = sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    with session.lock:
        raw = session.raw
        channels = req.channels or raw.ch_names
        unknown = set(channels) - set(raw.ch_names)
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown channel(s): {sorted(unknown)}")
        if req.start >= raw.n_times / raw.info["sfreq"]:
            raise HTTPException(status_code=400, detail="Requested window is out of range")

        return wire.window(raw, req.start, req.duration, channels, max_points=req.max_points)
