"""Latency of every registered operation, end to end through POST /ops.

    backend/.venv/bin/python bench/ops_bench.py

Reuses the fixture params and capability providers from the op contract test,
so a new op is benchmarked the moment it has contract params. Each op runs on a
fresh demo session with its prerequisites applied first; only the op itself is
timed (including waiting out a queued job). Prints one JSON object:
  op_<id>_ms     per-op wall time
  ops_total_ms   sum over all ops (the number to drive down)
  ops_failed     ops that errored (must stay 0)
"""
from __future__ import annotations

import json, os, sys, tempfile, time
from pathlib import Path

os.environ.setdefault("SEMA_DATA_DIR", tempfile.mkdtemp(prefix="sema-bench-"))
BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "tests"))

from fastapi.testclient import TestClient  # noqa: E402
from app.core import operations  # noqa: E402
from app.main import app  # noqa: E402
import test_op_contract as contract  # noqa: E402


def main() -> None:
    c = TestClient(app)
    out: dict[str, float] = {}
    failed = 0
    for op_id in sorted(set(operations.REGISTRY) - contract._SLOW):
        sid = c.post("/api/sessions/demo").json()["session_id"]
        done: set[str] = set()
        try:
            for token in operations.REGISTRY[op_id].requires:
                for pre_id, pre in contract._PROVIDERS.get(token, []):
                    if pre_id not in done:
                        done.add(pre_id)
                        contract._run(c, sid, pre_id, pre)
            t = time.perf_counter()
            contract._run(c, sid, op_id, contract._PARAMS[op_id])
            out[f"op_{op_id}_ms"] = (time.perf_counter() - t) * 1000
        except AssertionError as e:
            failed += 1
            print(f"{op_id} failed: {e}", file=sys.stderr)
    out["ops_total_ms"] = sum(out.values())
    out["ops_failed"] = failed
    print(json.dumps({k: round(v, 2) for k, v in out.items()}))


if __name__ == "__main__":
    main()
