"""A tiny in-process job runner for long operations (ICA fit, forward/inverse
solutions, TFR, permutation stats, dataset downloads).

Why threads, not a process pool: the session's live MNE objects (``Raw``,
``ICA``) sit in the process-wide session dict. A ``ThreadPoolExecutor`` shares
that memory directly — no pickling a 100 MB ``Raw`` to a child and back. The
numeric core (BLAS / numpy) releases the GIL, so a fit still runs off the
request thread and the API stays responsive.

The request that starts a long op returns ``202 {job_id}`` immediately; the
client polls ``GET /api/jobs/{id}``. See docs/BUILD_PLAN_V2.md P0.3.
"""
from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable

MAX_WORKERS = 2
JOB_TTL_SECONDS = 60 * 30  # keep finished jobs this long so the client can read the result


class JobState(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"


@dataclass
class Job:
    id: str
    kind: str                 # "op:fit_ica", "dataset:fetch", ...
    session_id: str
    state: JobState = JobState.QUEUED
    progress: float = 0.0     # 0..1; coarse for now (MNE gives few clean hooks)
    detail: str = ""
    error: str | None = None
    result: dict[str, Any] = field(default_factory=dict)  # e.g. {"session_id": ...} for a dataset fetch
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "session_id": self.session_id,
            "state": self.state.value,
            "progress": round(self.progress, 3),
            "detail": self.detail,
            "error": self.error,
            "result": self.result,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


class JobManager:
    def __init__(self, max_workers: int = MAX_WORKERS) -> None:
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="eegvis-job")
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def submit(self, kind: str, session_id: str, fn: Callable[[Job], None], *, detail: str = "") -> Job:
        job = Job(id=uuid.uuid4().hex[:12], kind=kind, session_id=session_id, detail=detail)
        with self._lock:
            self._jobs[job.id] = job
            self._sweep_locked()

        def _run() -> None:
            job.state = JobState.RUNNING
            job.started_at = time.time()
            try:
                fn(job)
                job.progress = 1.0
                job.state = JobState.DONE
            except Exception as e:  # noqa: BLE001 - surfaced to the client as job.error
                job.error = str(e) or e.__class__.__name__
                job.state = JobState.ERROR
            finally:
                job.finished_at = time.time()

        self._pool.submit(_run)
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def list_for(self, session_id: str) -> list[Job]:
        with self._lock:
            return sorted(
                (j for j in self._jobs.values() if j.session_id == session_id),
                key=lambda j: j.created_at,
                reverse=True,
            )

    def _sweep_locked(self) -> None:
        cutoff = time.time() - JOB_TTL_SECONDS
        for jid in [j.id for j in self._jobs.values()
                    if j.finished_at is not None and j.finished_at < cutoff]:
            del self._jobs[jid]


jobs = JobManager()
