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
        raw = session.original_raw if req.source == "original" and session.original_raw is not None else session.raw
        channels = [c for c in (req.channels or raw.ch_names) if c in raw.ch_names] or raw.ch_names
        if req.start >= raw.n_times / raw.info["sfreq"]:
            raise HTTPException(status_code=400, detail="Requested window is out of range")

        return wire.window(raw, req.start, req.duration, channels, max_points=req.max_points)
