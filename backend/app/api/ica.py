from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core import ica_ops
from app.models.schemas import ICAFitRequest, ICAExcludeRequest
from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions/{session_id}/ica", tags=["ica"])


def _get_session(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/fit")
async def fit(session_id: str, req: ICAFitRequest) -> dict:
    session = _get_session(session_id)
    try:
        session.ica = ica_ops.fit_ica(session.raw, n_components=req.n_components, method=req.method)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"ICA fit failed: {e}")
    return {
        "n_components": session.ica.n_components_,
        "method": req.method,
        "components": ica_ops.component_summary(session.ica, session.raw),
    }


@router.get("/components")
async def components(session_id: str) -> dict:
    session = _get_session(session_id)
    if session.ica is None:
        raise HTTPException(status_code=400, detail="No ICA fitted yet — call /ica/fit first")
    return {"components": ica_ops.component_summary(session.ica, session.raw)}


@router.get("/components/{index}/topomap")
async def component_topomap(session_id: str, index: int) -> dict:
    session = _get_session(session_id)
    if session.ica is None:
        raise HTTPException(status_code=400, detail="No ICA fitted yet — call /ica/fit first")
    if not (0 <= index < session.ica.n_components_):
        raise HTTPException(status_code=404, detail=f"Component {index} out of range")
    if session.raw.get_montage() is None:
        raise HTTPException(
            status_code=422,
            detail="Raw has no montage set; call /preprocessing/montage first so topomaps have electrode positions to interpolate over",
        )
    try:
        png_b64 = ica_ops.topomap_png_b64(session.ica, session.raw, index)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Topomap rendering failed: {e}")
    return {"index": index, "png_base64": png_b64}


@router.post("/exclude")
async def exclude(session_id: str, req: ICAExcludeRequest) -> dict:
    session = _get_session(session_id)
    if session.ica is None:
        raise HTTPException(status_code=400, detail="No ICA fitted yet — call /ica/fit first")
    ica_ops.set_exclusions(session.ica, req.exclude)
    return {"components": ica_ops.component_summary(session.ica, session.raw)}


@router.post("/apply")
async def apply(session_id: str) -> dict:
    session = _get_session(session_id)
    if session.ica is None:
        raise HTTPException(status_code=400, detail="No ICA fitted yet — call /ica/fit first")
    ica_ops.apply_ica(session.ica, session.raw)
    return {"applied": True, "excluded": session.ica.exclude}
