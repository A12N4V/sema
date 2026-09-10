"""Contract test for the operation registry :
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
    "set_reference": {"mode": "average"},
    "set_bads": {"bads": ["T7"]},
    "interpolate_bads": {"reset_bads": True},
    "annotate_amplitude": {"peak_uv": 150.0},
    "fit_ica": {"n_components": 6, "method": "fastica"},
    "compute_source": {"method": "dSPM", "center_t": 4.0},
    "rename_channels": {"mapping": {"T7": "T7x"}},
    "set_channel_types": {"mapping": {"T7": "eog"}},
    "drop_channels": {"channels": ["T7"]},
    "reorder_channels": {"order": ["Cz", "Fp1"]},
    "detect_bad_channels": {"threshold": 1.5, "n_neighbors": 20},
    "set_annotations": {"annotations": [{"onset": 1.0, "duration": 0.5, "description": "stim"}]},
    "annotate_muscle": {"threshold": 5.0, "min_length_good": 0.2},
    "label_ica": {},
    "exclude_ica_by_label": {"labels": ["eye blink"], "min_prob": 0.8},
    "make_epochs": {"tmin": -0.2, "tmax": 0.8, "baseline": True, "reject_uv": None},
    "average_epochs": {"condition": None},
    "compute_tfr": {"fmin": 4.0, "fmax": 30.0, "n_freqs": 8, "decim": 6},
}

# Ops the round-trip test skips (covered by a dedicated suite): heavy and/or
# need a big one-time download.
_SLOW = {"compute_source"}  # see test_source.py

# Capability token -> the ops that produce it. The round-trip test walks this to
# build whatever state an op declares it needs, so adding a gated op needs no
# bespoke setup here.
_PROVIDERS: dict[str, list[tuple[str, dict]]] = {
    "has_bads": [("set_bads", {"bads": ["T7"]})],
    "filtered_1hz": [("filter", {"l_freq": 1.0, "h_freq": 40.0})],
    "ica": [("filter", {"l_freq": 1.0, "h_freq": 40.0}),
            ("fit_ica", {"n_components": 6, "method": "fastica"})],
    "ica_labels": [("filter", {"l_freq": 1.0, "h_freq": 40.0}),
                   ("fit_ica", {"n_components": 6, "method": "fastica"}),
                   ("label_ica", {})],
    "epochs": [("make_epochs", {"tmin": -0.2, "tmax": 0.8,
                                "baseline": True, "reject_uv": None})],
}


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _run(client: TestClient, sid: str, op_id: str, params: dict) -> None:
    """Dispatch one op and, if it queues a job, wait for it."""
    r = client.post(f"/api/sessions/{sid}/ops", json={"op_id": op_id, "params": params})
    assert r.status_code in (200, 202), f"{op_id}: {r.status_code} {r.text[:300]}"
    if r.status_code == 202:
        import time
        jid = r.json()["job_id"]
        for _ in range(600):
            state = client.get(f"/api/jobs/{jid}").json()
            if state["state"] in ("done", "error"):
                break
            time.sleep(0.1)
        state = client.get(f"/api/jobs/{jid}").json()
        assert state["state"] == "done", f"{op_id} job failed: {state['error']}"


def test_every_registered_op_has_test_params():
    assert set(_PARAMS) == set(operations.REGISTRY), (
        "add fixture params for new ops in test_op_contract._PARAMS"
    )


@pytest.mark.parametrize("op_id", sorted(set(operations.REGISTRY) - _SLOW))
def test_op_round_trips_and_emits_valid_pipeline(client: TestClient, op_id: str):
    sid = client.post("/api/sessions/demo").json()["session_id"]
    op = operations.REGISTRY[op_id]

    # satisfy capability requirements, in declaration order
    done: set[str] = set()
    for token in op.requires:
        for pre_id, pre_params in _PROVIDERS.get(token, []):
            if pre_id in done:
                continue
            done.add(pre_id)
            _run(client, sid, pre_id, pre_params)

    _run(client, sid, op_id, _PARAMS[op_id])

    # the op is on the current pipeline path and the script parses
    py = client.get(f"/api/sessions/{sid}/export/pipeline.py").text
    compile(py.replace('"""Generated', '"""'), "<pipeline>", "exec")
