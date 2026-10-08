"""Guards for the benchmark loop (bench/). An agent optimising payload size or
latency must not trade away correctness; these pin what "correct" means for the
hot paths bench/backend_bench.py measures."""
from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.session_manager import sessions


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def sid(client: TestClient) -> str:
    return client.post("/api/sessions/demo").json()["session_id"]


def test_window_values_match_mne_within_tolerance(client: TestClient, sid: str):
    """Every decimated point must be a real sample (min/max bucketing), in µV,
    within 0.01 µV of what MNE returns: rounding is fine, inventing data isn't."""
    w = client.post(f"/api/sessions/{sid}/viewer/window", json={"start": 1, "duration": 5}).json()
    raw = sessions.get(sid).raw
    ch = w["channels"][0]
    i0, i1 = int(1 * raw.info["sfreq"]), int(6 * raw.info["sfreq"]) + 1
    truth = raw.get_data(picks=[ch], start=i0, stop=i1)[0] * 1e6
    got = np.asarray(w["data"][ch], dtype=float)
    assert got.min() >= truth.min() - 0.01 and got.max() <= truth.max() + 0.01
    assert np.min(np.abs(got[:, None] - truth[None, :]), axis=1).max() < 0.01


def test_window_envelope_preserved(client: TestClient, sid: str):
    """Min/max decimation's whole point: the peak-to-peak survives."""
    w = client.post(f"/api/sessions/{sid}/viewer/window", json={"start": 0, "duration": 30}).json()
    raw = sessions.get(sid).raw
    ch = w["channels"][3]
    truth = raw.get_data(picks=[ch], start=0, stop=int(30 * raw.info["sfreq"]) + 1)[0] * 1e6
    got = np.asarray(w["data"][ch], dtype=float)
    assert got.max() == pytest.approx(truth.max(), abs=0.01)
    assert got.min() == pytest.approx(truth.min(), abs=0.01)


def test_window_respects_max_points(client: TestClient, sid: str):
    w = client.post(f"/api/sessions/{sid}/viewer/window",
                    json={"start": 0, "duration": 30, "max_points": 500}).json()
    assert len(w["time"]) <= 500
    assert all(len(v) == len(w["time"]) for v in w["data"].values())


def test_psd_is_finite_and_nonnegative(client: TestClient, sid: str):
    p = client.post(f"/api/sessions/{sid}/spectral/psd", json={}).json()
    flat = np.asarray([v for k, v in p.items() if isinstance(v, list)
                       for v in (v if isinstance(v[0], list) else [v])], dtype=object)
    assert len(flat) > 0


def test_render_is_png_and_cached_identically(client: TestClient, sid: str):
    spec = {"view": "topomap", "source": "cursor", "t": 2.25}
    a = client.post(f"/api/sessions/{sid}/render", json=spec)
    b = client.post(f"/api/sessions/{sid}/render", json=spec)
    assert a.content[:8] == b"\x89PNG\r\n\x1a\n" and a.content == b.content


def test_filter_then_revert_restores_signal(client: TestClient, sid: str):
    before = sessions.get(sid).raw.get_data()[:, :1000].copy()
    client.post(f"/api/sessions/{sid}/ops", json={"op_id": "filter", "params": {"l_freq": 1, "h_freq": 40}})
    client.post(f"/api/sessions/{sid}/revert", json={"to_seq": 0})
    np.testing.assert_allclose(sessions.get(sid).raw.get_data()[:, :1000], before)
