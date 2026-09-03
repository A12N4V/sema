"""The eegvis.launch() attach path (docs/BUILD_PLAN_V2.md P0.11)."""
from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

from app.core.demo import make_demo_raw
from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_attach_a_serialised_raw(client: TestClient, tmp_path):
    fif = tmp_path / "r.fif"
    make_demo_raw().save(fif, overwrite=True, verbose="ERROR")

    with fif.open("rb") as f:
        r = client.post("/api/sessions/attach", files={"file": ("r.fif", f, "application/octet-stream")})
    assert r.status_code == 200, r.text
    info = r.json()
    assert info["n_channels"] == 32
    # it's a normal session — ops work on it
    assert client.post(
        f"/api/sessions/{info['session_id']}/ops", json={"op_id": "filter", "params": {"l_freq": 1, "h_freq": 40}}
    ).status_code == 200


def test_attach_rejects_junk(client: TestClient):
    r = client.post("/api/sessions/attach", files={"file": ("x.fif", io.BytesIO(b"not a fif"), "application/octet-stream")})
    assert r.status_code == 422
