"""The operation registry  and the generic
/ops dispatch endpoint."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core import operations
from app.core.containers import ContainerKind
from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def session_id(client: TestClient) -> str:
    return client.post("/api/sessions/demo").json()["session_id"]


def test_registry_populated_and_schemas_valid():
    ops = operations.all_ops()
    assert {"filter", "notch", "set_montage", "set_reference", "interpolate_bads", "fit_ica"} <= {o.id for o in ops}
    for op in ops:
        s = op.schema()
        assert s["id"] and s["stage"] and s["label"]
        assert s["params_schema"]["type"] == "object"


def test_ops_for_kind_filters_by_input():
    raw_ops = {o.id for o in operations.ops_for(ContainerKind.RAW)}
    assert "filter" in raw_ops
    # nothing is registered against STC yet
    assert operations.ops_for(ContainerKind.STC) == []


def test_list_ops_endpoint(client: TestClient):
    r = client.get("/api/ops?input=raw")
    assert r.status_code == 200
    ids = [o["id"] for o in r.json()["operations"]]
    assert "filter" in ids and "interpolate_bads" in ids


def test_run_op_filter_updates_session_and_history(client: TestClient, session_id: str):
    r = client.post(f"/api/sessions/{session_id}/ops",
                    json={"op_id": "filter", "params": {"l_freq": 1.0, "h_freq": 40.0}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["session"]["highpass"] == 1.0
    assert body["history"][-1]["op"] == "filter"
    assert body["graph"][0]["kind"] == "raw"


def test_run_op_rejects_unknown_param(client: TestClient, session_id: str):
    r = client.post(f"/api/sessions/{session_id}/ops",
                    json={"op_id": "filter", "params": {"l_freq": 1.0, "bogus": 3}})
    assert r.status_code == 422


def test_capability_gate_blocks_interpolate_without_bads(client: TestClient, session_id: str):
    # demo raw has a montage but no bad channels marked
    r = client.post(f"/api/sessions/{session_id}/ops",
                    json={"op_id": "interpolate_bads", "params": {}})
    assert r.status_code == 422
    assert "has_bads" in r.json()["detail"]


def test_interpolate_bads_end_to_end(client: TestClient, session_id: str):
    client.post(f"/api/sessions/{session_id}/ops",
                json={"op_id": "set_bads", "params": {"bads": ["T7"]}})
    r = client.post(f"/api/sessions/{session_id}/ops",
                    json={"op_id": "interpolate_bads", "params": {"reset_bads": True}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["session"]["bads"] == []
    assert body["history"][-1]["op"] == "interpolate_bads"


def test_graph_endpoint(client: TestClient, session_id: str):
    r = client.get(f"/api/sessions/{session_id}/graph")
    assert r.status_code == 200
    assert r.json()["graph"][0]["id"] == "raw"
    assert "montage" in r.json()["capabilities"]
