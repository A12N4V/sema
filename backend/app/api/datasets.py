"""Sample-dataset catalog + fetch. The fetch is a global job (no session yet)
whose result carries the created session_id."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core import datasets as ds
from app.core.loader import raw_summary
from app.services.jobs import jobs
from app.services.session_manager import sessions

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.get("")
def catalog() -> dict:
    return {"datasets": ds.catalog()}


@router.post("/{name}/open")
def open_dataset(name: str) -> dict:
    if name not in ds.DATASETS:
        raise HTTPException(status_code=404, detail=f"Unknown dataset {name!r}")

    def _work(job) -> None:
        job.detail = ds.DATASETS[name]["label"]
        raw = ds.load_dataset(name)
        session = sessions.create(filename=f"{name} · sample dataset", raw=raw)
        job.result = {
            "session_id": session.id,
            "session": {"session_id": session.id, "filename": session.filename, **raw_summary(session.raw)},
        }

    job = jobs.submit(f"dataset:{name}", "", _work, detail=ds.DATASETS[name]["label"])
    return {"job_id": job.id, "state": job.state.value, "dataset": name}
