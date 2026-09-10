from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core import ica_ops
from app.models.schemas import ICAFitRequest, ICAExcludeRequest, ICASourcesRequest
from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions/{session_id}/ica", tags=["ica"])


def _get_session(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


# Sync def throughout: ICA fitting is the single heaviest call in the app
# (seconds). On the event loop it froze every other session; in the threadpool
# under the per-session lock it only blocks reads of its own session.
@router.post("/fit")
def fit(session_id: str, req: ICAFitRequest) -> dict:
    session = _get_session(session_id)
    try:
        session.fit_ica(n_components=req.n_components, method=req.method)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"ICA fit failed: {e}")
    with session.lock:
        return {
            "n_components": session.ica.n_components_,
            "method": req.method,
            "components": ica_ops.attach_labels(
                ica_ops.component_summary(session.ica, session.raw), session.ica_labels),
        }


@router.get("/components")
def components(session_id: str) -> dict:
    session = _get_session(session_id)
    with session.lock:
        if session.ica is None:
            raise HTTPException(status_code=400, detail="No ICA fitted yet, call /ica/fit first")
        return {"components": ica_ops.attach_labels(
            ica_ops.component_summary(session.ica, session.raw), session.ica_labels)}


@router.get("/components/{index}/topomap")
def component_topomap(session_id: str, index: int, theme: str = "dark") -> dict:
    session = _get_session(session_id)
    with session.lock:
        if session.ica is None:
            raise HTTPException(status_code=400, detail="No ICA fitted yet, call /ica/fit first")
        if not (0 <= index < session.ica.n_components_):
            raise HTTPException(status_code=404, detail=f"Component {index} out of range")
        if session.raw.get_montage() is None:
            raise HTTPException(
                status_code=422,
                detail="Raw has no montage set; call /preprocessing/montage first so topomaps have electrode positions to interpolate over",
            )
        try:
            # through the shared renderer, so the panel gets a transparent,
            # theme-inked PNG out of the same disk cache the precompute fills
            from app.core.render import RenderSpec, render_b64

            png_b64 = render_b64(session, RenderSpec(view="ica_component", component=index,
                                                     width=280, height=280, theme=theme))
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Topomap rendering failed: {e}")
    return {"index": index, "png_base64": png_b64}


@router.post("/sources")
def sources(session_id: str, req: ICASourcesRequest) -> dict:
    session = _get_session(session_id)
    with session.lock:
        if session.ica is None:
            raise HTTPException(status_code=400, detail="No ICA fitted yet, call /ica/fit first")
        return ica_ops.sources_window(session.ica, session.raw, req.start, req.duration, req.max_points)


@router.get("/components/{index}/psd")
def component_psd(session_id: str, index: int) -> dict:
    session = _get_session(session_id)
    with session.lock:
        if session.ica is None:
            raise HTTPException(status_code=400, detail="No ICA fitted yet, call /ica/fit first")
        if not (0 <= index < session.ica.n_components_):
            raise HTTPException(status_code=404, detail=f"Component {index} out of range")
        return ica_ops.component_psd(session.ica, session.raw, index)


@router.post("/exclude")
def exclude(session_id: str, req: ICAExcludeRequest) -> dict:
    session = _get_session(session_id)
    if session.ica is None:
        raise HTTPException(status_code=400, detail="No ICA fitted yet, call /ica/fit first")
    session.set_ica_exclude(req.exclude)
    with session.lock:
        return {"components": ica_ops.attach_labels(
            ica_ops.component_summary(session.ica, session.raw), session.ica_labels)}


@router.post("/apply")
def apply(session_id: str) -> dict:
    session = _get_session(session_id)
    if session.ica is None:
        raise HTTPException(status_code=400, detail="No ICA fitted yet, call /ica/fit first")
    session.apply_ica()
    return {"applied": True, "excluded": session.ica.exclude}
