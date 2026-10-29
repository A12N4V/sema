"""Plethos / Karyon latency + payload benchmark against the demo runs.

    backend/.venv/bin/python bench/omics_bench.py [--reps N] [--runs DIR]

Prints one JSON object on stdout; every metric is lower-is-better, as in
backend_bench.py. The demo runs (omics-data/runs, or --runs) are clone-copied
to a temp dir first, so the live cache this writes never lands in them, and
each rep varies its parameters (a new FDR, a different excluded sample, the
next gene) so a timing is the compute, not a cache hit. Figure specs are
timed warm: that is what a user waits for after the first view.
"""
from __future__ import annotations

import argparse, atexit, json, os, shutil, statistics, subprocess, sys, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=5)
    ap.add_argument("--runs", default=os.environ.get("SEMA_OMICS_RUNS", str(ROOT / "omics-data" / "runs")))
    a = ap.parse_args()
    src = Path(a.runs)
    if not src.is_dir():
        print(json.dumps({"omics_bench_error": 1, "reason": f"no demo runs at {src}"}))
        return
    tmp = Path(tempfile.mkdtemp(prefix="sema-omics-bench-"))
    atexit.register(shutil.rmtree, tmp, ignore_errors=True)
    # APFS/btrfs clone where available, a plain copy elsewhere
    if subprocess.run(["cp", "-cR", str(src), str(tmp / "runs")], capture_output=True).returncode:
        shutil.copytree(src, tmp / "runs")
    os.environ["HODOS_RUNS"] = str(tmp / "runs")
    sys.path.insert(0, str(ROOT / "backend"))

    from fastapi.testclient import TestClient
    from app.omics.main import app

    c = TestClient(app)
    runs = c.get("/api/runs").json()
    bulk = next((r["id"] for r in runs if r["workflow"] == "bulk" and r["status"] == "done" and r.get("engine") == "python"), None)
    sn = next((r["id"] for r in runs if r["workflow"] == "snrna" and r["status"] == "done"), None)
    m: dict[str, float] = {}

    def timed(name: str, fn, reps: int = a.reps, kb: bool = True) -> None:
        fn(0)  # warm-up
        samples, size = [], 0
        for i in range(1, reps + 1):
            t = time.perf_counter()
            r = fn(i)
            samples.append((time.perf_counter() - t) * 1000)
            assert r.status_code < 400, (name, r.status_code, r.text[:200])
            size = len(r.content)
        m[f"{name}_ms"] = round(statistics.median(samples), 3)
        if kb:
            m[f"{name}_kb"] = round(size / 1024, 3)

    if bulk:
        samples = c.get(f"/api/runs/{bulk}/figures/samples/pca").json().get("names") or []
        timed("omics_bulk_catalogue", lambda i: c.get(f"/api/runs/{bulk}/figures"))
        timed("omics_volcano", lambda i: c.get(f"/api/runs/{bulk}/figures/genes/de"))
        timed("omics_top_heatmap", lambda i: c.get(f"/api/runs/{bulk}/figures/genes/topheat"))
        timed("omics_live_rethreshold", lambda i: c.post(f"/api/runs/{bulk}/live/de_rethreshold",
                                                          json={"fdr": round(0.05 + 0.001 * i, 4), "lfc": 0.3}), kb=False)
        if samples:
            timed("omics_live_pca", lambda i: c.post(f"/api/runs/{bulk}/live/pca",
                                                     json={"exclude": [samples[i % len(samples)]], "color": "group"}))
    else:
        m["omics_bench_error"] = 1
    if sn:
        genes = (c.get(f"/api/runs/{sn}/figures/de/de").json().get("genes") or [])[:50]
        timed("omics_sn_catalogue", lambda i: c.get(f"/api/runs/{sn}/figures"))
        timed("omics_umap", lambda i: c.get(f"/api/runs/{sn}/figures/clusters/umap"))
        if genes:
            timed("omics_live_umap_gene", lambda i: c.post(f"/api/runs/{sn}/live/umap_gene",
                                                           json={"gene": genes[i % len(genes)]}), reps=3)
    else:
        m["omics_bench_error"] = 1
    print(json.dumps(m))


if __name__ == "__main__":
    main()
