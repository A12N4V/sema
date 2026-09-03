"""Contract test for the operation registry (docs/BUILD_PLAN_V2.md P0.12):
every registered op must round-trip through POST /ops on a fixture session
and the resulting pipeline.py must parse."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core import operations
from app.main import app

# Params that satisfy each op's schema on the demo session (32-ch, montage,
# no bads). Ops needing capabilities the demo lacks are prepared first.
_PARAMS: dict[str, dict] = {
    "filter": {"l_freq": 1.0, "h_freq": 40.0},
    "notch": {"freqs": [60.0]},
    "resample": {"sfreq": 128.0},
    "set_montage": {"montage_name": "standard_1020"},
    "set_reference": {"ref_channels": "average"},
    "set_bads": {"bads": ["T7"]},
    "interpolate_bads": {"reset_bads": True},
    "fit_ica": {"n_components": 6, "method": "fastica"},
}


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def test_every_registered_op_has_test_params():
    assert set(_PARAMS) == set(operations.REGISTRY), (
        "add fixture params for new ops in test_op_contract._PARAMS"
    )


@pytest.mark.parametrize("op_id", sorted(operations.REGISTRY))
def test_op_round_trips_and_emits_valid_pipeline(client: TestClient, op_id: str):
    sid = client.post("/api/sessions/demo").json()["session_id"]
    op = operations.REGISTRY[op_id]

    # satisfy capability requirements
    if "has_bads" in op.requires:
        client.post(f"/api/sessions/{sid}/ops", json={"op_id": "set_bads", "params": {"bads": ["T7"]}})

    r = client.post(f"/api/sessions/{sid}/ops", json={"op_id": op_id, "params": _PARAMS[op_id]})
    assert r.status_code in (200, 202), f"{op_id}: {r.status_code} {r.text}"

    if r.status_code == 202:  # long op — wait for the job
        import time
        jid = r.json()["job_id"]
        for _ in range(300):
            if client.get(f"/api/jobs/{jid}").json()["state"] in ("done", "error"):
                break
            time.sleep(0.1)
        assert client.get(f"/api/jobs/{jid}").json()["state"] == "done"

    # the op is on the current pipeline path and the script parses
    py = client.get(f"/api/sessions/{sid}/export/pipeline.py").text
    compile(py.replace('"""Generated', '"""'), "<pipeline>", "exec")
