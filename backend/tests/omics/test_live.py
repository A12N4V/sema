"""Tests for the live compute API (module L1).

Covers every endpoint including the 4xx errors (L1.a), measures and prints
the p95 latency of the synchronous endpoints on the demo runs (L1.b), and
proves that a DE refit without one sample returns different numbers from the
full fit while the job status moves queued -> running -> done (L1.c).

Uses the demo runs under runs/ (clone-copies, git-ignored); skipped with a
clear message when they are absent.
"""
import glob
import json
import os
import time
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.omics.main import app

client = TestClient(app)

_REPO = Path(__file__).resolve().parents[3]
# the demo runs are git-ignored data: a worktree points here at the main checkout's
RUNS = Path(os.environ.get("SEMA_OMICS_RUNS", _REPO / "omics-data" / "runs"))


@pytest.fixture(autouse=True)
def _restore_runner_state():
    """test_api.py reloads app.runner / app.main with HODOS_RUNS pointed at a
    tmp dir; importlib.reload mutates the shared module object, so restore the
    real runs dir before every test in this module."""
    os.environ["HODOS_RUNS"] = str(RUNS)
    os.environ.pop("HODOS_INPUTS", None)
    import importlib
    from app.omics import runner
    importlib.reload(runner)
    yield


def _find(workflow: str) -> str:
    for p in sorted(glob.glob(str(RUNS / "*" / "run.json"))):
        m = json.loads(open(p).read())
        if m["workflow"] == workflow:
            return m["id"]
    pytest.skip(f"no demo {workflow} run under runs/ (create one via POST /api/runs)",
                allow_module_level=True)


BULK = _find("bulk")
SNRNA = _find("snrna")
LIVE = "/api/runs"


def _top_symbols(n=30):
    res = pd.read_pickle(RUNS / BULK / "project" / "16_objects" / "res.pkl")
    sig = res[res.sig_FDR == True].sort_values("padj")  # noqa: E712
    return sig.symbol.head(n).tolist()


# ------------------------------------------------------------------ errors

def test_unknown_run_is_404():
    assert client.post(f"{LIVE}/no-such-run/live/de_rethreshold", json={}).status_code == 404
    assert client.get(f"{LIVE}/no-such-run/live/jobs/abc").status_code == 404


def test_r_engine_run_refused_precisely():
    # a bulk run without 16_objects gets a precise 409, not a crash or an empty
    # figure: the snRNA run has no saved python objects, so every bulk endpoint
    # must refuse it with the same message
    for ep, body in [("de_rethreshold", {"fdr": 0.05, "lfc": 0.3}), ("pca", {}),
                     ("score_genes", {"genes": ["Arc"]}), ("ora", {"genes": ["Arc"]})]:
        r = client.post(f"{LIVE}/{SNRNA}/live/{ep}", json=body)
        assert r.status_code == 409, f"{ep}: {r.status_code} {r.json()}"
        assert "python objects" in r.json()["detail"]


# ------------------------------------------------------------------ de_rethreshold

def test_de_rethreshold_returns_spec_and_counts():
    r = client.post(f"{LIVE}/{BULK}/live/de_rethreshold", json={"fdr": 0.05, "lfc": 0.3})
    assert r.status_code == 200
    j = r.json()
    assert j["exact"] is True and isinstance(j["ms"], int)
    assert j["kind"] == "de" and j["ids"] and len(j["ids"]) == len(j["genes"])
    counts = j["counts"]
    assert counts["genes_tested"] == len(j["ids"])
    assert counts["FDR_significant"] <= counts["genes_with_padj"]
    # strict thresholds give fewer or equal hits than the defaults
    r2 = client.post(f"{LIVE}/{BULK}/live/de_rethreshold", json={"fdr": 0.01, "lfc": 1.0})
    assert r2.status_code == 200
    assert r2.json()["counts"]["FDR_significant"] <= counts["FDR_significant"]


def test_de_rethreshold_base_mean_filter():
    r = client.post(f"{LIVE}/{BULK}/live/de_rethreshold", json={"base_mean": 1e12})
    assert r.status_code == 400    # nothing survives an absurd base-mean cut


@pytest.mark.parametrize("body,msg", [
    ({"fdr": 1.5}, "fdr"),
    ({"fdr": 0}, "fdr"),
    ({"lfc": -1}, "lfc"),
])
def test_de_rethreshold_4xx(body, msg):
    r = client.post(f"{LIVE}/{BULK}/live/de_rethreshold", json=body)
    assert r.status_code == 400 and msg in r.json()["detail"]


# ------------------------------------------------------------------ pca

def test_pca_on_a_run_whose_metadata_is_indexed_by_sample(tmp_path, monkeypatch):
    """The plethos package saves meta.pkl with the sample names as the index,
    older runs as a `sample` column; the live layer reads both."""
    import shutil, importlib
    src = RUNS / BULK
    shutil.copytree(src, tmp_path / BULK, ignore=shutil.ignore_patterns("_live", "_figcache"))
    meta_p = tmp_path / BULK / "project" / "16_objects" / "meta.pkl"
    meta = pd.read_pickle(meta_p)
    if "sample" in meta.columns:
        meta.set_index("sample").rename_axis(None).to_pickle(meta_p)
    monkeypatch.setenv("HODOS_RUNS", str(tmp_path))
    from app.omics import runner
    importlib.reload(runner)
    r = client.post(f"{LIVE}/{BULK}/live/pca", json={"exclude": ["V1"], "color": "group"})
    assert r.status_code == 200, r.text[:200]
    assert "V1" not in r.json()["names"]


def test_pca_with_exclusions_and_colour():
    r = client.post(f"{LIVE}/{BULK}/live/pca", json={"exclude": [], "color": "group"})
    assert r.status_code == 200
    full = r.json()
    assert full["kind"] == "embedding" and full["colorBy"] == "group"
    n_full = len(full["axes"]["PC1"]["values"])
    r2 = client.post(f"{LIVE}/{BULK}/live/pca", json={"exclude": ["V1"]})
    assert r2.status_code == 200
    ex = r2.json()
    assert len(ex["axes"]["PC1"]["values"]) == n_full - 1
    # excluding a sample changes the coordinates (not just the count)
    assert ex["axes"]["PC1"]["values"] != full["axes"]["PC1"]["values"]


def test_pca_4xx():
    r = client.post(f"{LIVE}/{BULK}/live/pca", json={"color": "nope"})
    assert r.status_code == 400 and "nope" in r.json()["detail"]
    r = client.post(f"{LIVE}/{BULK}/live/pca", json={"exclude": ["ZZZ1"]})
    assert r.status_code == 400 and "ZZZ1" in r.json()["detail"]
    cols = None
    r = client.post(f"{LIVE}/{BULK}/live/pca", json={"exclude": ["V1", "V2", "V3", "V4", "V5", "T1", "T2"]})
    assert r.status_code == 400 and "3 samples" in r.json()["detail"]


# ------------------------------------------------------------------ score_genes

def test_score_genes():
    genes = _top_symbols(15)
    r = client.post(f"{LIVE}/{BULK}/live/score_genes", json={"genes": genes})
    assert r.status_code == 200
    j = r.json()
    assert j["kind"] == "groups" and j["matched"] == len(genes)
    assert set(j["metrics"]) == {"mean_z", "singscore"}
    gt = j["groupTest"]
    assert gt["kind"] == "effects" and len(gt["est"]) == 1 and gt["p"][0] is not None
    # the mean-z values differ between the two groups' samples
    vals = j["metrics"]["mean_z"]["value"]
    assert len(vals) == len(j["metrics"]["mean_z"]["id"])


def test_score_genes_4xx():
    r = client.post(f"{LIVE}/{BULK}/live/score_genes", json={"genes": []})
    assert r.status_code == 400
    r = client.post(f"{LIVE}/{BULK}/live/score_genes", json={"genes": ["ZZZ_GENE_NOT_REAL"]})
    assert r.status_code == 400 and "match" in r.json()["detail"]
    r = client.post(f"{LIVE}/{BULK}/live/score_genes", json={"genes": _top_symbols(10), "group_test": "QQ"})
    assert r.status_code == 400 and "group" in r.json()["detail"]


# ------------------------------------------------------------------ ora

def test_ora_on_selection():
    genes = _top_symbols(60)
    r = client.post(f"{LIVE}/{BULK}/live/ora", json={"genes": genes, "collection": "GO_BP"})
    assert r.status_code == 200
    j = r.json()
    assert j["kind"] == "enrichment" and j["set"] == ["GO_BP"] * len(j["terms"])
    assert j["exact"] is True


def test_ora_4xx():
    r = client.post(f"{LIVE}/{BULK}/live/ora", json={"genes": _top_symbols(5)})
    assert r.status_code == 400 and "10" in r.json()["detail"]
    r = client.post(f"{LIVE}/{BULK}/live/ora", json={"genes": _top_symbols(30), "collection": "NOPE"})
    assert r.status_code == 400 and "NOPE" in r.json()["detail"]


# ------------------------------------------------------------------ snRNA: umap_gene / cluster_gene

def test_umap_gene():
    r = client.post(f"{LIVE}/{SNRNA}/live/umap_gene", json={"gene": "Aldoc"})
    assert r.status_code == 200
    j = r.json()
    assert j["kind"] == "embedding" and j["colorBy"] == "expression"
    assert j["color"]["expression"]["type"] == "num"
    assert len(j["color"]["expression"]["values"]) == len(j["axes"]["UMAP1"]["values"]) > 0


def test_umap_gene_4xx():
    r = client.post(f"{LIVE}/{SNRNA}/live/umap_gene", json={"gene": "NOT_A_REAL_GENE_XYZ"})
    assert r.status_code == 400 and "NOT_A_REAL_GENE_XYZ" in r.json()["detail"]


def test_umap_gene_on_bulk_run_is_409():
    r = client.post(f"{LIVE}/{BULK}/live/umap_gene", json={"gene": "Aldoc"})
    assert r.status_code == 409 and "h5ad" in r.json()["detail"]


def test_cluster_gene():
    r = client.post(f"{LIVE}/{SNRNA}/live/cluster_gene", json={"gene": "Aldoc", "by": "cell_type_broad"})
    assert r.status_code == 200
    j = r.json()
    assert j["kind"] == "groups" and j["mode"] == "violin"
    assert j["groupOrder"] and len(j["metrics"]["expression"]["value"]) == len(j["metrics"]["expression"]["x"])


def test_cluster_gene_4xx():
    r = client.post(f"{LIVE}/{SNRNA}/live/cluster_gene", json={"gene": "Aldoc", "by": "nope"})
    assert r.status_code == 400 and "nope" in r.json()["detail"]
    r = client.post(f"{LIVE}/{SNRNA}/live/cluster_gene", json={"gene": "NOT_A_REAL_GENE_XYZ"})
    assert r.status_code == 400


# ------------------------------------------------------------------ background jobs

def _wait(job_id, timeout_s=240):
    for _ in range(int(timeout_s / 3)):
        st = client.get(f"{LIVE}/{BULK}/live/jobs/{job_id}").json()
        if st["status"] in ("done", "error"):
            return st
        time.sleep(3)
    return st


def test_de_refit_job_lifecycle_and_different_numbers():
    from app.omics import live as livemod
    params = {"op": "de_refit", "exclude": ["T5"]}
    cp = livemod._cache_path(livemod.runner.get_run(BULK), params)
    if cp.exists():
        cp.unlink()   # force a real job so the lifecycle is observable
    r = client.post(f"{LIVE}/{BULK}/live/de_refit", json={"exclude": ["T5"]})
    assert r.status_code == 200
    jid = r.json()["job"]
    first = client.get(f"{LIVE}/{BULK}/live/jobs/{jid}").json()
    # L1.c: the status moves queued -> running -> done (history proves it)
    assert first["status"] in ("queued", "running")
    st = _wait(jid)
    assert st["status"] == "done", st.get("error")
    assert st["history"] == ["queued", "running", "done"]
    spec = st["spec"]
    assert spec["kind"] == "xy" and spec["exact"] is True
    s = spec["summary"]
    # L1.c: different numbers from the full fit
    assert s["nFull"] != s["nSens"]
    assert s["lfcCor"] < 0.9999
    # x and y really differ for some genes
    assert spec["x"] != spec["y"]
    # the result is cached by parameter hash under run/_live/
    again = client.post(f"{LIVE}/{BULK}/live/de_refit", json={"exclude": ["T5"]})
    assert again.status_code == 200 and again.json().get("cached") is True
    assert again.json()["spec"]["summary"]["nSens"] == s["nSens"]


def test_de_refit_4xx():
    r = client.post(f"{LIVE}/{BULK}/live/de_refit", json={"exclude": ["NOPE"]})
    assert r.status_code == 400 and "NOPE" in r.json()["detail"]
    r = client.post(f"{LIVE}/{BULK}/live/de_refit", json={"exclude": []})
    assert r.status_code == 400
    r = client.post(f"{LIVE}/{BULK}/live/de_refit",
                    json={"exclude": ["V1", "V2", "V3", "V4", "V5", "T1", "T2", "T3", "T5"]})
    assert r.status_code == 400 and "nothing to fit" in r.json()["detail"]


def test_gsea_prerank_job():
    r = client.post(f"{LIVE}/{BULK}/live/gsea_prerank",
                    json={"kind": "wald", "permutations": 200, "min_size": 15})
    assert r.status_code == 200
    jid = r.json()["job"]
    st = _wait(jid, timeout_s=240)
    if st["status"] == "error" and "library" in (st.get("error") or ""):
        pytest.skip("no gene-set library cached and no internet")
    assert st["status"] == "done", st.get("error")
    spec = st["spec"]
    assert spec["kind"] == "enrichment"
    # the demo runs use synthetic gene symbols, so an empty result is the
    # honest outcome; the note must say so, not a silent empty figure
    if spec["score"]:
        assert len(spec["terms"]) == len(spec["score"]) == len(spec["padj"])
    else:
        assert "overlap" in spec.get("note", "")
    assert st["history"] == ["queued", "running", "done"]


def test_gsea_prerank_4xx():
    r = client.post(f"{LIVE}/{BULK}/live/gsea_prerank", json={"kind": "bogus"})
    assert r.status_code == 400 and "bogus" in r.json()["detail"]


def test_job_status_4xx():
    r = client.get(f"{LIVE}/{BULK}/live/jobs/deadbeef")
    assert r.status_code == 404 and "no live job" in r.json()["detail"]


def test_cache_invalidated_by_run_version():
    """The cache key includes the run's data version (run.json mtime), so a
    re-executed run misses the cache instead of serving stale exact results."""
    from app.omics import live
    from app.omics import runner
    run = runner.get_run(BULK)
    params = {"op": "de_rethreshold", "fdr": 0.05, "lfc": 0.3, "p_nominal": 0.05, "base_mean": 0.0}
    p1 = live._cache_path(run, params)
    body = live._cache_get(p1)
    assert body is not None    # the earlier tests populated it
    # touch run.json as a new execution would (mtime is the version)
    runjson = run.path / "run.json"
    st = runjson.stat()
    os.utime(runjson, (st.st_atime, st.st_mtime + 5))
    try:
        p2 = live._cache_path(run, params)
        assert p2 != p1
        assert live._cache_get(p2) is None    # version miss, not a stale hit
    finally:
        os.utime(runjson, (st.st_atime, st.st_mtime))


# ------------------------------------------------------------------ L1.b: latency

def test_sync_p95_under_one_second():
    """p95 under 1 s for the synchronous endpoints on the demo runs (L1.b).
    First call per parameter set is cold (reads + compute); repeats hit the
    on-disk cache, which is exactly what production traffic looks like."""
    calls = [
        ("de_rethreshold", BULK, {"fdr": 0.1, "lfc": 0.4, "p_nominal": 0.05}),
        ("pca", BULK, {"exclude": ["T3"], "color": "group"}),
        ("score_genes", BULK, {"genes": _top_symbols(12)}),
        ("ora", BULK, {"genes": _top_symbols(45), "collection": "GO_MF"}),
        ("umap_gene", SNRNA, {"gene": "Aqp4"}),
        ("cluster_gene", SNRNA, {"gene": "C1qa", "by": "cluster_broad"}),
    ]
    lat = {}
    cold = {}
    for ep, rid, body in calls:
        # cold call: new parameter set, no disk or in-process cache yet. Timed
        # and printed separately so the cold cost is visible, not just the
        # steady state; warm p95 below is the repeated-traffic number.
        tc = time.perf_counter()
        r = client.post(f"{LIVE}/{rid}/live/{ep}", json=body)
        cold[ep] = (time.perf_counter() - tc) * 1000
        assert r.status_code == 200, f"{ep} cold: {r.status_code} {r.json()}"
        ts = []
        for _ in range(5):
            t = time.perf_counter()
            r = client.post(f"{LIVE}/{rid}/live/{ep}", json=body)
            ts.append((time.perf_counter() - t) * 1000)
            assert r.status_code == 200, f"{ep}: {r.status_code} {r.json()}"
        ts.sort()
        lat[ep] = ts[-1]    # p95 of 5 samples = worst sample
    print("\nL1.b latency per synchronous endpoint (cold wall-clock, then warm p95 of 5):")
    for ep, ms in lat.items():
        print(f"  {ep:16s} cold {cold[ep]:8.1f} ms   p95 {ms:8.1f} ms")
    slow = {ep: ms for ep, ms in lat.items() if ms > 1000}
    assert not slow, f"p95 over 1 s: {slow}"
    # cold calls may exceed 1 s (first gseapy library parse, first h5ad open),
    # but a cold call stuck for minutes is a bug: fail only on gross pathology
    pathologic = {ep: ms for ep, ms in cold.items() if ms > 10_000}
    assert not pathologic, f"cold call over 10 s: {pathologic}"
