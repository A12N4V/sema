"""The job runner (docs/BUILD_PLAN_V2.md P0.3) — long_running ops dispatch
to the pool and the request returns 202 immediately."""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def session_id(client: TestClient) -> str:
    return client.post("/api/sessions/demo").json()["session_id"]


def _wait(client: TestClient, job_id: str, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["state"] in ("done", "error"):
            return job
        time.sleep(0.1)
    raise AssertionError(f"job {job_id} did not finish in {timeout}s")


def test_long_op_returns_202_and_a_job(client: TestClient, session_id: str):
    # filter to >=1 Hz first is good practice but not required by the op
    client.post(f"/api/sessions/{session_id}/ops",
                json={"op_id": "filter", "params": {"l_freq": 1.0, "h_freq": 40.0}})

    r = client.post(f"/api/sessions/{session_id}/ops",
                    json={"op_id": "fit_ica", "params": {"n_components": 10, "method": "fastica"}})
    assert r.status_code == 202, r.text
    job_id = r.json()["job_id"]
    assert r.json()["op_id"] == "fit_ica"

    job = _wait(client, job_id)
    assert job["state"] == "done", job
    assert job["kind"] == "op:fit_ica"

    # the ICA now exists on the session
    comps = client.get(f"/api/sessions/{session_id}/ica/components")
    assert comps.status_code == 200
    assert len(comps.json()["components"]) == 10

    # and it shows up in the container graph
    graph = client.get(f"/api/sessions/{session_id}/graph").json()["graph"]
    assert any(n["kind"] == "ica" for n in graph)


def test_job_error_is_surfaced(client: TestClient, session_id: str):
    # fit_ica needs a montage; the demo has one, so force a real failure by
    # asking for more components than channels
    r = client.post(f"/api/sessions/{session_id}/ops",
                    json={"op_id": "fit_ica", "params": {"n_components": 999, "method": "fastica"}})
    assert r.status_code == 202
    job = _wait(client, job_id=r.json()["job_id"])
    assert job["state"] == "error"
    assert job["error"]


def test_session_jobs_listing(client: TestClient, session_id: str):
    r = client.post(f"/api/sessions/{session_id}/ops",
                    json={"op_id": "fit_ica", "params": {"n_components": 6}})
    _wait(client, r.json()["job_id"])
    listing = client.get(f"/api/sessions/{session_id}/jobs").json()["jobs"]
    assert listing and listing[0]["kind"] == "op:fit_ica"


def test_unknown_job_404(client: TestClient):
    assert client.get("/api/jobs/deadbeef").status_code == 404
