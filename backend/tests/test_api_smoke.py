"""End-to-end smoke test through the HTTP layer against a demo session."""
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


def test_demo_session_has_montage_and_annotations(client: TestClient):
    info = client.post("/api/sessions/demo").json()
    assert info["n_channels"] == 32
    assert info["has_montage"] is True
    assert len(info["annotations"]) > 0


def test_window_wire_shape(client: TestClient, sid: str):
    w = client.post(f"/api/sessions/{sid}/viewer/window", json={"start": 0, "duration": 5}).json()
    assert set(w) == {"channels", "sfreq", "t0", "dt", "time", "data"}
    assert len(w["data"][w["channels"][0]]) == len(w["time"])


def test_overview_and_layout(client: TestClient, sid: str):
    ov = client.get(f"/api/sessions/{sid}/viewer/overview?n_bins=50").json()
    assert len(ov["rms"]) == 50
    lay = client.get(f"/api/sessions/{sid}/montage/layout").json()
    assert lay["has_montage"] and len(lay["pos2d"]) == len(lay["channels"])


def test_preprocess_then_history_then_pipeline(client: TestClient, sid: str):
    client.post(f"/api/sessions/{sid}/ops", json={"op_id": "filter", "params": {"l_freq": 1, "h_freq": 40}})
    client.post(f"/api/sessions/{sid}/ops", json={"op_id": "notch", "params": {"freqs": [60]}})
    hist = client.get(f"/api/sessions/{sid}/history").json()
    assert [e["op"] for e in hist["entries"]] == ["filter", "notch"]

    py = client.get(f"/api/sessions/{sid}/export/pipeline.py").text
    assert "raw.notch_filter(freqs=[60" in py

    info = client.post(f"/api/sessions/{sid}/revert", json={"to_seq": 1}).json()
    assert info["lowpass"] == 40.0


def test_field_at_cursor(client: TestClient, sid: str):
    f = client.post(f"/api/sessions/{sid}/viewer/field", json={"t": 3.0}).json()
    assert len(f["values"]) == len(f["channels"]) == 32


def test_ica_fit_sources_and_psd(client: TestClient, sid: str):
    client.post(f"/api/sessions/{sid}/ops", json={"op_id": "filter", "params": {"l_freq": 1, "h_freq": 40}})
    fit = client.post(f"/api/sessions/{sid}/ica/fit", json={"n_components": 8}).json()
    assert fit["n_components"] == 8

    src = client.post(f"/api/sessions/{sid}/ica/sources", json={"start": 0, "duration": 5}).json()
    assert src["channels"][0] == "IC 0" and len(src["channels"]) == 8
    assert len(src["data"]["IC 0"]) == len(src["time"])

    assert client.get(f"/api/sessions/{sid}/ica/components/0/psd").json()["psd_db"]

    client.post(f"/api/sessions/{sid}/ica/exclude", json={"exclude": [0]})
    # an excluded component's own spectrum must still return
    psd = client.get(f"/api/sessions/{sid}/ica/components/0/psd").json()
    assert len(psd["freqs"]) == len(psd["psd_db"]) > 0
    client.post(f"/api/sessions/{sid}/ica/apply")
    hist = client.get(f"/api/sessions/{sid}/history").json()
    assert hist["entries"][-1]["op"] == "apply_ica"
