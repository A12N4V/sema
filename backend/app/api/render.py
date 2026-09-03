"""One endpoint for every server-rendered figure (topomaps, sensor maps, ICA
panels). PNG out, disk-cached — see core/render.py."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from app.core.render import RenderSpec, render
from app.services.session_manager import sessions

router = APIRouter(prefix="/api/sessions/{session_id}", tags=["render"])


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
