"""Geometry + envelope endpoints that feed the minimap and the 3D scalp field."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core import wire
from app.models.schemas import FieldRequest
from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions/{session_id}", tags=["geometry"])


def _get_session(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Sync def: whole-recording RMS binning and per-sample field reads run in the
# threadpool under the session lock rather than on the event loop.
@router.get("/viewer/overview")
def overview(session_id: str, n_bins: int = 1200) -> dict:
    session = _get_session(session_id)
    with session.lock:
        return wire.overview(session.raw, n_bins=n_bins)


@router.get("/montage/layout")
def montage_layout(session_id: str) -> dict:
    session = _get_session(session_id)
    with session.lock:
        return wire.montage_layout(session.raw)


@router.post("/viewer/field")
def field(session_id: str, req: FieldRequest) -> dict:
    session = _get_session(session_id)
    with session.lock:
        layout = wire.montage_layout(session.raw)
        channels = req.channels or layout["channels"]
        if not channels:
            raise HTTPException(status_code=422, detail="No EEG channels with positions")
        return wire.field_at(session.raw, req.t, channels)
