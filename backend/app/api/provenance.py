"""The provenance ledger surface: read the history, roll back to a step."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core.loader import raw_summary
from app.models.schemas import RevertRequest, SessionInfo
from app.services import persistence
from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions/{session_id}", tags=["provenance"])


def _get_session(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Sync def: revert re-runs the whole pipeline from the pristine Raw, which is
# as heavy as the ops it replays.
@router.get("/history")
def history(session_id: str) -> dict:
    session = _get_session(session_id)
    with session.lock:
        return {
            "entries": session.ledger.to_list(),   # every branch; each has `parent` + `on_path`
            "head": session.ledger.head,
            "leaves": session.ledger.leaves(),
            "montage_name": session.montage_name,
            "has_ica": session.ica is not None,
        }


@router.post("/revert", response_model=SessionInfo)
def revert(session_id: str, req: RevertRequest) -> SessionInfo:
    session = _get_session(session_id)
    if req.to_seq > len(session.ledger):
        raise HTTPException(status_code=400, detail=f"Ledger only has {len(session.ledger)} entries")
    try:
        session.revert(req.to_seq)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Revert failed: {e}")
    persistence.save_async(session)
    with session.lock:
        return SessionInfo(session_id=session.id, filename=session.filename, **raw_summary(session.raw))
