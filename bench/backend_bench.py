"""Backend latency + payload benchmark against an in-process demo session.

    backend/.venv/bin/python bench/backend_bench.py [--reps N]

Prints one JSON object on stdout. Every metric is "lower is better". Timings are
the median of N reps after one warm-up, so a cold import or first-render cache
miss does not dominate. Render timings use a unique `t` per rep to defeat the
PNG disk cache (we want the render cost, not the cache hit).
"""
from __future__ import annotations

import argparse, atexit, json, os, shutil, statistics, sys, tempfile, time
from pathlib import Path

if "SEMA_DATA_DIR" not in os.environ:
    os.environ["SEMA_DATA_DIR"] = tempfile.mkdtemp(prefix="sema-bench-")
    atexit.register(shutil.rmtree, os.environ["SEMA_DATA_DIR"], ignore_errors=True)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402


def timed(fn, reps: int) -> tuple[float, int]:
    fn(0)  # warm-up
    samples, size = [], 0
    for i in range(1, reps + 1):
        t = time.perf_counter()
        r = fn(i)
        samples.append((time.perf_counter() - t) * 1000)
        assert r.status_code < 400, (r.status_code, r.text[:200])
        size = len(r.content)
    return statistics.median(samples), size


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=5)
    reps = ap.parse_args().reps
    c = TestClient(app)

    t = time.perf_counter()
    sid = c.post("/api/sessions/demo").json()["session_id"]
    out: dict[str, float] = {"demo_session_ms": (time.perf_counter() - t) * 1000}
    S = f"/api/sessions/{sid}"

    cases = {
        "window_5s":   lambda i: c.post(f"{S}/viewer/window", json={"start": i * 0.5, "duration": 5}),
        "window_30s":  lambda i: c.post(f"{S}/viewer/window", json={"start": i * 0.5, "duration": 30}),
        "overview":    lambda i: c.get(f"{S}/viewer/overview?n_bins={400 + i}"),
        "field":       lambda i: c.post(f"{S}/viewer/field", json={"t": 1.0 + i * 0.37}),
        "psd":         lambda i: c.post(f"{S}/spectral/psd", json={}),
        "topomap_png": lambda i: c.post(f"{S}/render", json={"view": "topomap", "source": "cursor", "t": 1.0 + i * 0.113}),
        "sensors_png": lambda i: c.post(f"{S}/render", json={"view": "sensors", "theme": "light" if i % 2 else "dark"}),
        "ops_catalog": lambda i: c.get("/api/ops"),
        "history":     lambda i: c.get(f"{S}/history"),
    }
    for name, fn in cases.items():
        ms, size = timed(fn, reps)
        out[f"{name}_ms"] = ms
        out[f"{name}_kb"] = size / 1024

    # Mutating op: filter then revert so each rep starts from the same state.
    def filt(i):
        r = c.post(f"{S}/ops", json={"op_id": "filter", "params": {"l_freq": 1, "h_freq": 40 - i * 0.1}})
        c.post(f"{S}/revert", json={"to_seq": 0})
        return r
    out["filter_op_ms"], _ = timed(filt, reps)

    print(json.dumps({k: round(v, 3) for k, v in out.items()}))


if __name__ == "__main__":
    main()
