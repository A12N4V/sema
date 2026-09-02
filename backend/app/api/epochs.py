from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core import epoching
from app.models.schemas import EpochsFromAnnotationsRequest, FixedLengthEpochsRequest
from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions/{session_id}/epochs", tags=["epochs"])


def _get_session(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/from-annotations")
async def from_annotations(session_id: str, req: EpochsFromAnnotationsRequest) -> dict:
    session = _get_session(session_id)
    try:
        session.epochs = epoching.epochs_from_annotations(
            session.raw, tmin=req.tmin, tmax=req.tmax, event_id=req.event_id
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return epoching.epochs_summary(session.epochs)


@router.post("/fixed-length")
async def fixed_length(session_id: str, req: FixedLengthEpochsRequest) -> dict:
    session = _get_session(session_id)
    try:
        session.epochs = epoching.fixed_length_epochs(session.raw, duration=req.duration, overlap=req.overlap)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return epoching.epochs_summary(session.epochs)


@router.get("")
async def get_epochs(session_id: str) -> dict:
    session = _get_session(session_id)
    if session.epochs is None:
        raise HTTPException(status_code=400, detail="No epochs created yet")
    return epoching.epochs_summary(session.epochs)
