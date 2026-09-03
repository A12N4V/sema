"""Session bundles survive eviction / restart (docs/BUILD_PLAN_V2.md P0.11)."""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import persistence
from app.services.session_manager import sessions as mgr


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _wait_saved(sid: str, n_entries: int = 1, timeout: float = 8.0) -> None:
    import json
    from app.services.persistence import WORKDIR

    deadline = time.time() + timeout
    b = WORKDIR / sid / "bundle.json"
    while time.time() < deadline:
        if b.exists():
            try:
                if len(json.loads(b.read_text()).get("entries", [])) >= n_entries:
                    return
            except Exception:
                pass
        time.sleep(0.1)
    raise AssertionError(f"autosave did not reach {n_entries} entries")


def test_op_autosaves_and_session_rehydrates_after_eviction(client: TestClient):
    sid = client.post("/api/sessions/demo").json()["session_id"]
    client.post(f"/api/sessions/{sid}/ops", json={"op_id": "filter", "params": {"l_freq": 1.0, "h_freq": 40.0}})
    client.post(f"/api/sessions/{sid}/ops", json={"op_id": "notch", "params": {"freqs": [60.0]}})
    _wait_saved(sid, n_entries=2)

    # simulate a server restart: drop the in-memory session
    mgr.delete(sid)
    assert sid not in mgr._sessions

    # a plain GET rehydrates it from disk
    info = client.get(f"/api/sessions/{sid}")
    assert info.status_code == 200, info.text
    assert info.json()["highpass"] == 1.0

    hist = client.get(f"/api/sessions/{sid}/history").json()
    assert [e["op"] for e in hist["entries"]] == ["filter", "notch"]

    # and it still works — revert on the rehydrated session
    r = client.post(f"/api/sessions/{sid}/revert", json={"to_seq": 1})
    assert r.status_code == 200
    assert r.json()["lowpass"] == 40.0


def test_recent_lists_the_bundle(client: TestClient):
    sid = client.post("/api/sessions/demo").json()["session_id"]
    client.post(f"/api/sessions/{sid}/ops", json={"op_id": "filter", "params": {"l_freq": 1.0}})
    _wait_saved(sid)
    recent = client.get("/api/sessions/recent").json()["recent"]
    assert any(r["session_id"] == sid for r in recent)
