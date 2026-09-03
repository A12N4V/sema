"""Source localisation — the real stc.plot() brain (P6).

Skipped unless fsaverage is already downloaded (this suite does not trigger
the ~770 MB fetch). Where it runs it exercises the full pipeline:
forward → ad-hoc cov → inverse → apply_inverse_raw → PyVista brain render.
"""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.core import source
from app.main import app

pytestmark = pytest.mark.skipif(
    not source.fsaverage_ready(), reason="fsaverage not downloaded"
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def sid(client: TestClient) -> str:
    s = client.post("/api/sessions/demo").json()["session_id"]
    client.post(f"/api/sessions/{s}/ops", json={"op_id": "filter", "params": {"l_freq": 1.0, "h_freq": 40.0}})
    return s


def _wait(client: TestClient, jid: str, timeout: float = 120.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        j = client.get(f"/api/jobs/{jid}").json()
        if j["state"] in ("done", "error"):
            return j
        time.sleep(0.3)
    raise AssertionError("compute_source job did not finish")


def test_compute_source_then_render_brain(client: TestClient, sid: str):
    r = client.post(f"/api/sessions/{sid}/ops",
                    json={"op_id": "compute_source", "params": {"method": "dSPM", "center_t": 4.2}})
    assert r.status_code == 202, r.text
    job = _wait(client, r.json()["job_id"])
    assert job["state"] == "done", job

    st = client.get(f"/api/sessions/{sid}/source").json()
    assert st["has_stc"] and st["meta"]["method"] == "dSPM"
    assert st["meta"]["tmin"] < 4.2 < st["meta"]["tmax"]

    # the source container shows up in the graph
    graph = client.get(f"/api/sessions/{sid}/graph").json()
    assert any(n["id"] == "source" for n in graph["graph"])
    assert "source" in graph["capabilities"]

    # the brain renders
    r = client.post(f"/api/sessions/{sid}/render",
                    json={"view": "brain", "t": 4.2, "hemi": "lh", "width": 480, "height": 400})
    assert r.status_code == 200, r.text
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"

    # cursor outside the window is a clear 422, not a crash
    r = client.post(f"/api/sessions/{sid}/render",
                    json={"view": "brain", "t": 120.0})
    assert r.status_code == 422
    assert "window" in r.json()["detail"]

    # the peak time-course comes back
    tc = client.get(f"/api/sessions/{sid}/source/timecourse").json()
    assert len(tc["t"]) == len(tc["y"]) > 100


def test_forward_solution_is_cached(client: TestClient, sid: str):
    """Second compute_source on the same montage reuses the cached forward."""
    r = client.post(f"/api/sessions/{sid}/ops",
                    json={"op_id": "compute_source", "params": {"method": "dSPM", "center_t": 3.0}})
    _wait(client, r.json()["job_id"])

    t0 = time.time()
    r = client.post(f"/api/sessions/{sid}/ops",
                    json={"op_id": "compute_source", "params": {"method": "sLORETA", "center_t": 6.0}})
    _wait(client, r.json()["job_id"])
    assert time.time() - t0 < 20  # cached forward → much faster than the ~15-20 s cold path
    assert client.get(f"/api/sessions/{sid}/source").json()["meta"]["method"] == "sLORETA"
