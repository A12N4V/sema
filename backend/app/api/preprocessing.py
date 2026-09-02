from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core import filters as filt
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
    return SessionInfo(session_id=session.id, filename=session.filename, **raw_summary(session.raw))


@router.post("/bandpass", response_model=SessionInfo)
async def bandpass(session_id: str, req: BandpassRequest) -> SessionInfo:
    session = _get_session(session_id)
    try:
        filt.apply_bandpass(session.raw, req.l_freq, req.h_freq)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _info(session)


@router.post("/notch", response_model=SessionInfo)
async def notch(session_id: str, req: NotchRequest) -> SessionInfo:
    session = _get_session(session_id)
    try:
        filt.apply_notch(session.raw, req.freqs)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _info(session)


@router.post("/resample", response_model=SessionInfo)
async def resample(session_id: str, req: ResampleRequest) -> SessionInfo:
    session = _get_session(session_id)
    try:
        filt.apply_resample(session.raw, req.sfreq)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _info(session)


@router.post("/bad-channels", response_model=SessionInfo)
async def bad_channels(session_id: str, req: BadChannelsRequest) -> SessionInfo:
    session = _get_session(session_id)
    try:
        filt.set_bad_channels(session.raw, req.bads)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _info(session)


@router.post("/reference", response_model=SessionInfo)
async def reference(session_id: str, req: ReferenceRequest) -> SessionInfo:
    session = _get_session(session_id)
    try:
        filt.apply_reference(session.raw, req.ref_channels)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _info(session)


@router.post("/montage", response_model=SessionInfo)
async def montage(session_id: str, req: MontageRequest) -> SessionInfo:
    session = _get_session(session_id)
    try:
        filt.set_montage(session.raw, req.montage_name)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))
    return _info(session)
