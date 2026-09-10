"""One endpoint for every server-rendered figure (topomaps, sensor maps, ICA
panels). PNG out, disk-cached: see core/render.py.

Plus the two routes that turn that cache from a side-effect into a feature:
``/precompute`` renders the whole recording's filmstrip in the background, and
``/filmstrip`` reports which frames exist so the frontend can pin the timeline
to them. See core/precompute.py.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.core import precompute as pre
from app.core.render import RenderSpec, render
from app.services.jobs import jobs
from app.services.session_manager import sessions

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions/{session_id}", tags=["render"])


class PrecomputeRequest(BaseModel):
    theme: str = Field("dark", description="dark | light")
    width: int = Field(pre.FRAME_SIZE[0], ge=80, le=800)
    height: int = Field(pre.FRAME_SIZE[1], ge=80, le=800)


@router.post("/render")
def render_png(session_id: str, spec: RenderSpec) -> Response:
    try:
        session = sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    try:
        with session.lock:
            png = render(session, spec)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "private, max-age=60"})


def _session_or_404(session_id: str):
    try:
        return sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/precompute", status_code=202)
def start_precompute(session_id: str, req: PrecomputeRequest) -> JSONResponse:
    """Render every frame and infographic for the current signal state, in the
    background. Returns immediately with a job to poll."""
    session = _session_or_404(session_id)

    def _prepare(j):
        """The empty workspaces first, then the figures. That order matters.

        `state_hash` includes whether an ICA exists, and the render cache keys
        every PNG by it. Precomputing first therefore wrote 186 frames under one
        hash and then the derivation pass fitted an ICA, moving the hash out
        from under all of them: the client asked for the new state, missed on
        every frame, and re-rendered the lot on demand while scrubbing. The
        whole pass was being thrown away by the step that followed it.

        Deriving first settles the hash before a single frame is drawn, and has
        the side benefit that the ICA component topographies are in `specs` at
        all, which they never were when the ICA appeared afterwards.
        """
        try:
            from app.core import autoderive
            j.detail = "deriving the epoched views"
            derived = [d.container for d in autoderive.derive_cached(session, job=j)]
        except Exception as e:  # noqa: BLE001
            log.warning("auto-derive skipped for %s: %s", session_id, e)
            derived = []
        j.progress, j.detail = 0.0, "preparing figures"
        out = pre.precompute(session, theme=req.theme, width=req.width,
                             height=req.height, job=j)
        out["derived"] = derived
        return out

    job = jobs.submit("precompute", session_id, _prepare, detail="preparing figures")
    return JSONResponse(status_code=202, content={"job_id": job.id, "state": job.state.value})


@router.get("/filmstrip")
def filmstrip(session_id: str,
              theme: str = Query("dark"),
              width: int = Query(pre.FRAME_SIZE[0], ge=80, le=800),
              height: int = Query(pre.FRAME_SIZE[1], ge=80, le=800)) -> dict:
    """The frame times the precompute pass covers, and how many are on disk.
    Stats the cache only: never renders."""
    session = _session_or_404(session_id)
    return pre.filmstrip_manifest(session, theme=theme, width=width, height=height)
