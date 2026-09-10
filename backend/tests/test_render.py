"""The server render service , PNG out, disk-cached."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def sid(client: TestClient) -> str:
    return client.post("/api/sessions/demo").json()["session_id"]


@pytest.mark.parametrize("spec", [
    {"view": "topomap", "source": "cursor", "t": 2.5},
    {"view": "topomap", "source": "band", "band": "alpha"},
    {"view": "sensors"},
])
def test_render_returns_png(client: TestClient, sid: str, spec: dict):
    r = client.post(f"/api/sessions/{sid}/render", json=spec)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_render_field3d(client: TestClient, sid: str):
    from app.core import render3d

    if not render3d.available():
        pytest.skip("pyvista not installed")
    r = client.post(f"/api/sessions/{sid}/render",
                    json={"view": "field3d", "t": 4.2, "width": 480, "height": 420})
    assert r.status_code == 200, r.text
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_render_cache_key_changes_with_signal(client: TestClient, sid: str):
    from app.services.session_manager import sessions as mgr
    from app.core.render import RenderSpec

    session = mgr.get(sid)
    spec = RenderSpec(view="topomap", source="band", band="alpha")
    k1 = spec.cache_key(session.state_hash)
    client.post(f"/api/sessions/{sid}/ops", json={"op_id": "filter", "params": {"l_freq": 2.0, "h_freq": 30.0}})
    k2 = spec.cache_key(session.state_hash)
    assert k1 != k2


def test_render_bad_view_422(client: TestClient, sid: str):
    assert client.post(f"/api/sessions/{sid}/render", json={"view": "nope"}).status_code == 422


def test_render_ica_component_after_fit(client: TestClient, sid: str):
    r = client.post(f"/api/sessions/{sid}/ops", json={"op_id": "fit_ica", "params": {"n_components": 6}})
    jid = r.json()["job_id"]
    import time
    for _ in range(300):
        if client.get(f"/api/jobs/{jid}").json()["state"] in ("done", "error"):
            break
        time.sleep(0.1)
    r = client.post(f"/api/sessions/{sid}/render", json={"view": "ica_component", "component": 0})
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
