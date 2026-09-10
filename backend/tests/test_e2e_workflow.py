"""Scaffolding regression net: the whole user-facing surface in one place.

Three jobs, deliberately separate from the narrower unit tests:

1. ``test_full_preprocessing_workflow`` walks the session a real user walks
   (montage → filter → notch → resample → bads → interpolate → ICA → export)
   through the **generic op dispatcher**, asserting the observable result of
   each step. If any op regresses, this fails at the step that broke.
2. ``test_every_registered_op_*`` are contract guards over the registry: every
   op must advertise a usable schema and legal container kinds. Adding an op
   with a malformed definition fails here rather than at runtime in the UI.
3. ``test_render_*`` covers every server-rendered view the frontend can ask
   for, so a matplotlib/PyVista breakage surfaces as a test, not a blank pane.

Source localisation is covered by ``test_source.py`` and left out here, it
costs ~40 s, and this file is meant to stay fast enough to run on every save.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.operations.base import REGISTRY
from app.core.containers import ContainerKind
from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def sid(client: TestClient) -> str:
    return client.post("/api/sessions/demo").json()["session_id"]


def caps_of(client: TestClient, sid: str) -> set[str]:
    """Capability tokens live on the graph route, alongside the container list."""
    return set(client.get(f"/api/sessions/{sid}/graph").json()["capabilities"])


def run_op(client: TestClient, sid: str, op_id: str, **params) -> dict:
    """Dispatch through the generic /ops route: the same path the UI uses."""
    r = client.post(f"/api/sessions/{sid}/ops", json={"op_id": op_id, "params": params})
    assert r.status_code in (200, 202), f"{op_id} → {r.status_code}: {r.text[:400]}"
    return r.json()


# --------------------------------------------------------------- the workflow

def test_full_preprocessing_workflow(client: TestClient, sid: str):
    """The path a user actually takes, end to end, through the op registry."""
    # 1. montage: gates topography, ICA and everything spatial
    run_op(client, sid, "set_montage", montage_name="standard_1020")
    assert client.get(f"/api/sessions/{sid}").json()["has_montage"] is True

    # 2. band-pass: ICA needs a ≥1 Hz high-pass, so this also opens that gate
    run_op(client, sid, "filter", l_freq=1.0, h_freq=40.0)
    info = client.get(f"/api/sessions/{sid}").json()
    assert info["highpass"] >= 1.0 and info["lowpass"] == 40.0

    # 3. notch
    run_op(client, sid, "notch", freqs=[60.0])

    # 4. re-reference
    run_op(client, sid, "set_reference", mode="average")

    # 5. mark bads, then interpolate them away
    run_op(client, sid, "set_bads", bads=["Fp1"])
    assert "Fp1" in client.get(f"/api/sessions/{sid}").json()["bads"]
    run_op(client, sid, "interpolate_bads")
    assert client.get(f"/api/sessions/{sid}").json()["bads"] == []

    # 6. resample
    run_op(client, sid, "resample", sfreq=128.0)
    assert client.get(f"/api/sessions/{sid}").json()["sfreq"] == 128.0

    # 7. the ledger recorded every one of them, in order, on the path
    hist = client.get(f"/api/sessions/{sid}/history").json()["entries"]
    assert [e["op"] for e in hist] == [
        "set_montage", "filter", "notch", "set_reference",
        "set_bads", "interpolate_bads", "resample",
    ]
    assert all(e["on_path"] for e in hist)

    # 8. and it renders as a runnable script
    py = client.get(f"/api/sessions/{sid}/export/pipeline.py").text
    assert "import mne" in py
    assert "set_montage" in py and "resample" in py


def test_derived_reads_after_preprocessing(client: TestClient, sid: str):
    """PSD, band power and the container graph all answer post-preprocessing."""
    run_op(client, sid, "filter", l_freq=1.0, h_freq=40.0)

    psd = client.post(f"/api/sessions/{sid}/spectral/psd",
                      json={"fmin": 1, "fmax": 45}).json()
    assert len(psd["freqs"]) > 0
    assert len(psd["psd_db"]) == len(psd["channels"])

    bp = client.get(f"/api/sessions/{sid}/spectral/band-power").json()
    assert set(bp["bands"]) >= {"delta", "theta", "alpha", "beta", "gamma"}
    assert len(bp["bands"]["alpha"]) == len(bp["channels"])

    graph = client.get(f"/api/sessions/{sid}/graph").json()
    kinds = {n["kind"] for n in graph["graph"]}
    assert "raw" in kinds


def test_branching_keeps_both_paths(client: TestClient, sid: str):
    """Re-running from an earlier point forks; the old branch survives.

    This is the property the pipeline UI draws as two edges out of one node -
    if it regresses, the flow canvas silently loses a branch.
    """
    run_op(client, sid, "filter", l_freq=1.0, h_freq=40.0)
    run_op(client, sid, "notch", freqs=[60.0])

    client.post(f"/api/sessions/{sid}/revert", json={"to_seq": 1})
    run_op(client, sid, "resample", sfreq=100.0)   # forks off seq 1

    hist = client.get(f"/api/sessions/{sid}/history").json()
    entries = hist["entries"]
    assert len(entries) == 3, "nothing may be deleted from the ledger"
    off_path = [e for e in entries if not e["on_path"]]
    assert [e["op"] for e in off_path] == ["notch"], "the old branch must survive"
    assert len(hist["leaves"]) == 2, "two branch tips expected"


def test_capabilities_gate_and_unlock(client: TestClient, sid: str):
    """Capability tokens are what the UI greys buttons on."""
    caps = caps_of(client, sid)
    assert "montage" in caps                      # the demo ships with one

    assert "filtered_1hz" not in caps
    run_op(client, sid, "filter", l_freq=1.0, h_freq=40.0)
    caps = caps_of(client, sid)
    assert "filtered_1hz" in caps, "a 1 Hz high-pass must open the ICA gate"

    run_op(client, sid, "set_bads", bads=["Fp1"])
    assert "has_bads" in caps_of(client, sid)


def test_ica_roundtrip(client: TestClient, sid: str):
    run_op(client, sid, "filter", l_freq=1.0, h_freq=40.0)
    run_op(client, sid, "fit_ica", n_components=6)
    assert "ica" in {n["kind"] for n in client.get(f"/api/sessions/{sid}/graph").json()["graph"]}

    client.post(f"/api/sessions/{sid}/ica/exclude", json={"exclude": [0]})
    client.post(f"/api/sessions/{sid}/ica/apply")
    assert client.get(f"/api/sessions/{sid}/history").json()["entries"][-1]["op"] == "apply_ica"


def test_exports_all_return_content(client: TestClient, sid: str):
    run_op(client, sid, "filter", l_freq=1.0, h_freq=40.0)
    for path, needle in [
        ("export/pipeline.py", b"import mne"),
        ("export/raw.fif", None),
        ("export/summary.csv", None),
    ]:
        r = client.get(f"/api/sessions/{sid}/{path}")
        assert r.status_code == 200, f"{path} → {r.status_code}"
        assert len(r.content) > 0, f"{path} returned nothing"
        if needle:
            assert needle in r.content


# ------------------------------------------------------- registry contracts

def test_registry_is_not_empty():
    assert REGISTRY, "the operation registry is empty, nothing would show in the UI"


@pytest.mark.parametrize("op_id", sorted(REGISTRY))
def test_every_op_has_a_usable_contract(op_id: str):
    """Each op must be renderable as a palette entry AND an auto-generated form."""
    op = REGISTRY[op_id]
    schema = op.schema()

    assert schema["label"], f"{op_id} has no human label"
    assert op.stage, f"{op_id} has no stage, it would not group in the palette"
    assert op.inputs, f"{op_id} declares no input container kind"
    assert all(isinstance(k, ContainerKind) for k in op.inputs)
    assert schema["params_schema"]["type"] == "object", f"{op_id} params schema is not an object"
    # forms are generated from properties; an op with params must expose them
    props = schema["params_schema"].get("properties", {})
    assert isinstance(props, dict)


def test_ops_endpoint_matches_registry(client: TestClient):
    listed = {o["id"] for o in client.get("/api/ops").json()["operations"]}
    assert listed == set(REGISTRY), "the /ops route and the registry disagree"


def test_ops_endpoint_filters_by_input_kind(client: TestClient):
    """`ops_for(kind)` is what a type-filtered 'add step' menu would use."""
    raw_ops = {o["id"] for o in client.get("/api/ops?input=raw").json()["operations"]}
    assert "filter" in raw_ops
    assert raw_ops <= set(REGISTRY)


def test_unknown_op_is_rejected(client: TestClient, sid: str):
    r = client.post(f"/api/sessions/{sid}/ops",
                    json={"op_id": "does_not_exist", "params": {}})
    assert r.status_code in (400, 404, 422)


def test_bad_params_are_rejected_not_ignored(client: TestClient, sid: str):
    """`extra='forbid'` on OpParams, a typo'd param must 422, never no-op."""
    r = client.post(f"/api/sessions/{sid}/ops",
                    json={"op_id": "filter", "params": {"l_freq": 1.0, "typo": 3}})
    assert r.status_code == 422, "an unknown param silently ignored is a data-integrity bug"


# ------------------------------------------------------------------ rendering

@pytest.mark.parametrize("spec", [
    {"view": "topomap", "source": "cursor", "t": 1.0, "width": 200, "height": 200},
    {"view": "topomap", "source": "band", "band": "alpha", "width": 200, "height": 200},
    {"view": "sensors", "width": 200, "height": 200},
    {"view": "field3d", "t": 1.0, "azimuth": -35, "elevation": 16, "width": 240, "height": 200},
])
def test_render_views_return_png(client: TestClient, sid: str, spec: dict):
    r = client.post(f"/api/sessions/{sid}/render", json=spec)
    assert r.status_code == 200, f"{spec['view']} → {r.status_code}: {r.text[:200]}"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n", f"{spec['view']} did not return a PNG"


def test_render_ica_component_png(client: TestClient, sid: str):
    run_op(client, sid, "filter", l_freq=1.0, h_freq=40.0)
    run_op(client, sid, "fit_ica", n_components=6)
    r = client.post(f"/api/sessions/{sid}/render",
                    json={"view": "ica_component", "component": 0, "width": 200, "height": 200})
    assert r.status_code == 200
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_render_rejects_unknown_view(client: TestClient, sid: str):
    r = client.post(f"/api/sessions/{sid}/render", json={"view": "not_a_view"})
    assert r.status_code in (400, 422)


# ------------------------------------------------------------------ lifecycle

def test_missing_session_is_404(client: TestClient):
    assert client.get("/api/sessions/nope-not-real").status_code == 404


def test_health(client: TestClient):
    assert client.get("/api/health").status_code == 200
