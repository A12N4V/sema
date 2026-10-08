"""Every route, probed with bad input: the API may refuse, it may never 500.

Walks the live route table, so a new endpoint is covered the moment it is
mounted. Also pins concurrent reads on one session (the frontend fires several
at once on every page switch)."""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.main import app

# The OpenAPI schema, not app.routes: included routers are nested objects there.
ROUTES = [(m.upper(), p) for p, ops in app.openapi()["paths"].items() for m in ops]
SESSION_ROUTES = [(m, p) for m, p in ROUTES if "{session_id}" in p]
# Idempotent by design: deleting a gone session, or listing its (zero) jobs.
IDEMPOTENT = {("DELETE", "/api/sessions/{session_id}"), ("GET", "/api/sessions/{session_id}/jobs")}


def _fill(path: str, sid: str) -> str:
    return re.sub(r"\{[^}]+\}", lambda m: sid if m.group(0) == "{session_id}" else "0", path)


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(scope="module")
def sid(client: TestClient) -> str:
    return client.post("/api/sessions/demo").json()["session_id"]


def test_route_table_is_nontrivial():
    assert len(SESSION_ROUTES) > 25


@pytest.mark.parametrize("method,path", SESSION_ROUTES, ids=[f"{m} {p}" for m, p in SESSION_ROUTES])
def test_unknown_session_is_a_client_error(client: TestClient, method: str, path: str):
    r = client.request(method, _fill(path, "no-such-session"), json={})
    if (method, path) in IDEMPOTENT:
        assert r.status_code == 200
    else:
        assert 400 <= r.status_code < 500, (r.status_code, r.text[:200])


@pytest.mark.parametrize("method,path", [(m, p) for m, p in SESSION_ROUTES if m == "POST"],
                         ids=[p for m, p in SESSION_ROUTES if m == "POST"])
@pytest.mark.parametrize("body", [{"__junk__": 1}, {"start": "x", "duration": -5, "t": "nan"}, []])
def test_malformed_bodies_never_500(client: TestClient, sid: str, method: str, path: str, body):
    r = client.request(method, _fill(path, sid), json=body)
    assert r.status_code < 500, (r.status_code, r.text[:300])


@pytest.mark.parametrize("payload", [
    {"start": -10, "duration": 5}, {"start": 0, "duration": 0}, {"start": 0, "duration": 1e9},
    {"start": 1e9, "duration": 5}, {"start": 0, "duration": 5, "channels": ["nope"]},
    {"start": 0, "duration": 5, "max_points": 0},
])
def test_window_edge_cases_never_500(client: TestClient, sid: str, payload: dict):
    r = client.post(f"/api/sessions/{sid}/viewer/window", json=payload)
    assert r.status_code < 500, (r.status_code, r.text[:300])


def test_unknown_op_is_rejected_cleanly(client: TestClient, sid: str):
    r = client.post(f"/api/sessions/{sid}/ops", json={"op_id": "rm_rf", "params": {}})
    assert 400 <= r.status_code < 500


def test_revert_out_of_range_is_rejected(client: TestClient, sid: str):
    assert 400 <= client.post(f"/api/sessions/{sid}/revert", json={"to_seq": 999}).status_code < 500


def test_concurrent_reads_on_one_session(client: TestClient, sid: str):
    def hit(i: int) -> int:
        calls = [lambda: client.post(f"/api/sessions/{sid}/viewer/window", json={"start": i % 20, "duration": 5}),
                 lambda: client.get(f"/api/sessions/{sid}/viewer/overview?n_bins=200"),
                 lambda: client.post(f"/api/sessions/{sid}/viewer/field", json={"t": 1 + i % 10}),
                 lambda: client.post(f"/api/sessions/{sid}/render", json={"view": "topomap", "source": "cursor", "t": 1 + (i % 7) * 0.3})]
        return calls[i % len(calls)]().status_code
    with ThreadPoolExecutor(8) as ex:
        codes = list(ex.map(hit, range(48)))
    assert all(c == 200 for c in codes), codes
