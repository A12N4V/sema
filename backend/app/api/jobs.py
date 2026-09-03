"""Read job state. Jobs are created by the generic op endpoint for
``long_running`` operations (see api/ops.py)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.services.jobs import jobs

router = APIRouter(prefix="/api", tags=["jobs"])


@router.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"No job {job_id!r} (expired or never existed)")
    return job.to_dict()


@router.get("/sessions/{session_id}/jobs")
def session_jobs(session_id: str) -> dict:
    return {"jobs": [j.to_dict() for j in jobs.list_for(session_id)]}
