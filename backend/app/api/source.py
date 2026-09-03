"""Source-localisation read endpoints. The heavy compute is the
`compute_source` operation (jobs); rendering is `/render` with view=brain."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core import source as src
from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions/{session_id}/source", tags=["source"])


def _get(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("")
def status(session_id: str) -> dict:
    session = _get(session_id)
    return {
        "fsaverage_ready": src.fsaverage_ready(),
        "has_stc": getattr(session, "stc", None) is not None,
        "meta": session.stc_meta,
    }


@router.get("/timecourse")
def timecourse(session_id: str, vertex: int | None = None) -> dict:
    session = _get(session_id)
    try:
        with session.lock:
            return src.source_timecourse(session, vertex=vertex)
    except src.SourceError as e:
        raise HTTPException(status_code=422, detail=str(e))
