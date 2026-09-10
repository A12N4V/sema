"""The extension surface.

EEGLAB's durable advantage is that people who are not its authors have been
able to add to it for twenty years. The registry here was always the right
shape for that; this is the test that the public door actually works, and that
a plugin operation is not second class: it must reach the palette, generate a
form, record a ledger step and appear in the exported script exactly as a
built-in does.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core import operations  # noqa: F401  populates the registry
from app.core.extend import operation
from app.core.operations.base import REGISTRY
from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def sid(client: TestClient) -> str:
    return client.post("/api/sessions/demo").json()["session_id"]


@pytest.fixture
def plugin():
    """Register a throwaway operation and clean it out of the global registry."""
    calls: list[dict] = []

    @operation(id="test_scale", label="Scale signal", stage="Custom")
    def test_scale(raw, factor: float = 2.0, note: str = "hello"):
        """Multiply every channel by a constant."""
        calls.append({"factor": factor, "note": note})
        raw.apply_function(lambda x: x * factor, verbose="ERROR")

    yield calls
    REGISTRY.pop("test_scale", None)


def test_a_plugin_op_joins_the_registry_with_a_generated_form(plugin, client):
    op = REGISTRY["test_scale"]
    assert op.label == "Scale signal"
    assert op.stage == "Custom"
    assert op.doc == "Multiply every channel by a constant."

    props = op.schema()["params_schema"]["properties"]
    # types and defaults come from the function's own signature
    assert props["factor"]["type"] == "number"
    assert props["factor"]["default"] == 2.0
    assert props["note"]["type"] == "string"

    listed = {o["id"] for o in client.get("/api/ops").json()["operations"]}
    assert "test_scale" in listed, "a plugin op must appear in the palette"


def test_a_plugin_op_runs_through_the_normal_dispatcher(plugin, client, sid):
    r = client.post(f"/api/sessions/{sid}/ops",
                    json={"op_id": "test_scale", "params": {"factor": 3.0}})
    assert r.status_code == 200, r.text
    assert plugin == [{"factor": 3.0, "note": "hello"}]

    entry = client.get(f"/api/sessions/{sid}/history").json()["entries"][-1]
    assert entry["op"] == "test_scale"
    assert entry["params"]["factor"] == 3.0
    assert "test_scale" in client.get(f"/api/sessions/{sid}/export/pipeline.py").text


def test_a_plugin_op_gets_the_same_validation_as_a_built_in(plugin, client, sid):
    r = client.post(f"/api/sessions/{sid}/ops",
                    json={"op_id": "test_scale", "params": {"factor": 3.0, "typo": 1}})
    assert r.status_code == 422, "extra='forbid' must apply to plugins too"


def test_a_required_parameter_stays_required():
    @operation(id="test_required", stage="Custom")
    def test_required(raw, gain: float):
        raw.apply_function(lambda x: x * gain, verbose="ERROR")

    try:
        props = REGISTRY["test_required"].schema()["params_schema"]
        assert "gain" in props.get("required", []), "no default means the form must demand a value"
    finally:
        REGISTRY.pop("test_required", None)


def test_a_bad_registration_fails_loudly_at_import_time():
    with pytest.raises(ValueError, match="unknown container kind"):
        @operation(id="test_bad_kind", inputs="nonsense")
        def test_bad_kind(raw):
            pass

    with pytest.raises(TypeError, match="cannot be turned into a form"):
        @operation(id="test_varargs")
        def test_varargs(raw, **kwargs):
            pass

    REGISTRY.pop("test_bad_kind", None)
    REGISTRY.pop("test_varargs", None)


def test_the_public_package_exposes_it():
    import sema

    assert sema.operation is operation
    assert callable(sema.launch)
