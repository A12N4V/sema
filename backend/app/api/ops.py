"""Generic operation dispatch.

``GET /api/ops`` lists registered operations (optionally filtered to a
container kind) with their JSON-schema params, so the frontend can build the
command palette and auto-generate the parameter form.

``POST /api/sessions/{id}/ops`` runs one: validate params → capability gate →
``op.run(session, params)`` under the session lock → return the updated
container graph + history + raw summary.

This is the path every new MNE operation goes through (docs/BUILD_PLAN_V2.md
P0.2 / P0.3). The older per-op routes in ``preprocessing.py`` etc. still work
and now sit alongside it.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.core import operations
from app.core.containers import ContainerKind, container_graph, session_capabilities
from app.core.loader import raw_summary
from app.models.schemas import OpRequest
from app.services.session_manager import sessions

router = APIRouter(prefix="/api", tags=["operations"])


@router.get("/ops")
def list_ops(input: str | None = None) -> dict:
    """All registered operations, or those consuming container kind ``input``."""
    if input is not None:
        try:
            kind = ContainerKind(input)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Unknown container kind {input!r}")
        ops = operations.ops_for(kind)
    else:
        ops = operations.all_ops()
    return {"operations": [op.schema() for op in sorted(ops, key=lambda o: (o.stage, o.label))]}


@router.post("/sessions/{session_id}/ops")
def run_op(session_id: str, body: OpRequest) -> dict:
    try:
        session = sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    op = operations.get(body.op_id)
    if op is None:
        raise HTTPException(status_code=404, detail=f"Unknown operation {body.op_id!r}")

    missing = [c for c in op.requires if c not in session_capabilities(session)]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Operation {op.id!r} needs: {', '.join(missing)}",
        )

    try:
        params = op.params_model(**body.params)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors())

    try:
        with session.lock:
            op.run(session, params)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=422, detail=str(e))

    with session.lock:
        return {
            "op_id": op.id,
            "graph": [c.to_dict() for c in container_graph(session)],
            "capabilities": sorted(session_capabilities(session)),
            "history": session.ledger.to_list(),
            "session": {"session_id": session.id, "filename": session.filename, **raw_summary(session.raw)},
        }


@router.get("/sessions/{session_id}/graph")
def graph(session_id: str) -> dict:
    try:
        session = sessions.get(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    with session.lock:
        return {
            "graph": [c.to_dict() for c in container_graph(session)],
            "capabilities": sorted(session_capabilities(session)),
        }
