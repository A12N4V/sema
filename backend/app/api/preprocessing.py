from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core.loader import raw_summary
from app.models.schemas import (
    BandpassRequest, NotchRequest, ResampleRequest, BadChannelsRequest,
    ReferenceRequest, MontageRequest, SessionInfo,
)
from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions/{session_id}/preprocessing", tags=["preprocessing"])


def _get_session(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


def _info(session) -> SessionInfo:
    with session.lock:
        return SessionInfo(session_id=session.id, filename=session.filename, **raw_summary(session.raw))


# Sync def: filtering / resampling are CPU-bound. The Session methods below
# already serialize on the per-session lock; running the handler in the
# threadpool keeps a long filter off the event loop.
@router.post("/bandpass", response_model=SessionInfo)
def bandpass(session_id: str, req: BandpassRequest) -> SessionInfo:
    session = _get_session(session_id)
    try:
        session.filter(req.l_freq, req.h_freq)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _info(session)


@router.post("/notch", response_model=SessionInfo)
def notch(session_id: str, req: NotchRequest) -> SessionInfo:
    session = _get_session(session_id)
    try:
        session.notch(req.freqs)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _info(session)


@router.post("/resample", response_model=SessionInfo)
def resample(session_id: str, req: ResampleRequest) -> SessionInfo:
    session = _get_session(session_id)
    try:
        session.resample(req.sfreq)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _info(session)


@router.post("/bad-channels", response_model=SessionInfo)
def bad_channels(session_id: str, req: BadChannelsRequest) -> SessionInfo:
    session = _get_session(session_id)
    try:
        session.set_bads(req.bads)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _info(session)


@router.post("/reference", response_model=SessionInfo)
def reference(session_id: str, req: ReferenceRequest) -> SessionInfo:
    session = _get_session(session_id)
    try:
        session.set_reference(req.ref_channels)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _info(session)


@router.post("/montage", response_model=SessionInfo)
def montage(session_id: str, req: MontageRequest) -> SessionInfo:
    session = _get_session(session_id)
    try:
        session.set_montage(req.montage_name)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _info(session)
