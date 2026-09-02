from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions/{session_id}/export", tags=["export"])


def _get_session(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/raw.fif")
async def export_raw_fif(session_id: str):
    session = _get_session(session_id)
    out_path = sessions.session_dir(session_id) / "cleaned_raw.fif"
    session.raw.save(str(out_path), overwrite=True, verbose="ERROR")
    return FileResponse(str(out_path), filename="eegvis_cleaned_raw.fif", media_type="application/octet-stream")


@router.get("/epochs.fif")
async def export_epochs_fif(session_id: str):
    session = _get_session(session_id)
    if session.epochs is None:
        raise HTTPException(status_code=400, detail="No epochs created yet")
    out_path = sessions.session_dir(session_id) / "epochs-epo.fif"
    session.epochs.save(str(out_path), overwrite=True, verbose="ERROR")
    return FileResponse(str(out_path), filename="eegvis_epochs-epo.fif", media_type="application/octet-stream")
