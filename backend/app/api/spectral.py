from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core import spectral_ops, topomap as topomap_ops
from app.models.schemas import PSDRequest, BandPowerTopomapRequest
from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions/{session_id}/spectral", tags=["spectral"])


def _get_session(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Sync def: Welch PSD / topomap rendering are CPU-bound and MNE is not
# re-entrant on a Raw, so each runs in the threadpool under the session lock.
@router.post("/psd")
def psd(session_id: str, req: PSDRequest) -> dict:
    session = _get_session(session_id)
    try:
        with session.lock:
            return spectral_ops.compute_psd(session.raw, fmin=req.fmin, fmax=req.fmax, picks=req.channels)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/band-power")
def band_power(session_id: str) -> dict:
    session = _get_session(session_id)
    try:
        with session.lock:
            return spectral_ops.compute_band_power(session.raw)
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.post("/band-topomap")
def band_topomap(session_id: str, req: BandPowerTopomapRequest) -> dict:
    session = _get_session(session_id)
    if req.band not in spectral_ops.BANDS:
        raise HTTPException(status_code=400, detail=f"Unknown band {req.band!r}. Choose from {list(spectral_ops.BANDS)}")
    try:
        with session.lock:
            bp = spectral_ops.compute_band_power(session.raw)
            ch_names = req.channels or bp["channels"]
            idx = [bp["channels"].index(c) for c in ch_names]
            values = [bp["bands"][req.band][i] for i in idx]
            png_b64 = topomap_ops.band_power_topomap_png_b64(session.raw, values, ch_names)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"band": req.band, "channels": ch_names, "png_base64": png_b64}
