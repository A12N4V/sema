"""Fast checks. The full notebook run is exercised by `HODOS_SLOW=1 pytest`."""
import os
import stat
import time
import zipfile
import io

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("HODOS_RUNS", str(tmp_path / "runs"))
    monkeypatch.setenv("HODOS_INPUTS", str(tmp_path / "inputs"))
    import importlib
    from app.omics import runner, main
    importlib.reload(runner)
    importlib.reload(main)
    return TestClient(main.app)


def wait(c, rid, limit=600):
    t0 = time.time()
    while c.get(f"/api/runs/{rid}").json()["active"]:
        assert time.time() - t0 < limit
        time.sleep(0.3)
    return c.get(f"/api/runs/{rid}").json()


def test_new_kinds_on_demo_runs():
    """V1: every figure family is live. Each new kind builds its spec from the
    demo run, the histogram offers one variant per DE column, and no catalogue
    noun still lists pipeline PNGs in its figure strip (they are downloads)."""
    from app.omics import main
    c = TestClient(main.app)
    done = lambda wf: [r["id"] for r in c.get("/api/runs").json() if r["workflow"] == wf and r["status"] == "done"]  # noqa: E731
    bulk, sn = (done("bulk") or [None])[0], (done("snrna") or [None])[0]
    if not bulk or not sn:
        pytest.skip("demo runs not present")
    checks = [
        (bulk, "genes", "hist", {"column", "edges", "counts", "na", "total"}),
        (bulk, "signatures", "overlap", {"sets", "z", "genes"}),
        (bulk, "report", "publication", {"panels"}),
        (sn, "clusters", "markers", {"clusters", "rows"}),
    ]
    kinds = {}
    for rid, noun, fig, keys in checks:
        cat = {n["id"]: n for n in c.get(f"/api/runs/{rid}/figures").json()}
        assert fig in {f["id"] for f in cat[noun]["figures"]}, (noun, fig)
        s = c.get(f"/api/runs/{rid}/figures/{noun}/{fig}").json()
        assert keys <= s.keys(), (noun, fig, list(s))
        kinds[s["kind"]] = s
    assert set(kinds) >= {"histogram", "overlap-matrix", "multi-panel", "dotplot"}
    assert len(kinds["multi-panel"]["panels"]) == 4
    assert kinds["dotplot"]["rows"] and kinds["overlap-matrix"]["z"]
    for v in kinds["histogram"]["columns"]:
        r = c.get(f"/api/runs/{bulk}/figures/genes/hist", params={"variant": v})
        assert r.status_code == 200 and r.json()["column"] == v
    expect = {bulk: ("genes", "report"), sn: ("nuclei",)}
    for rid in (bulk, sn):
        for n in c.get(f"/api/runs/{rid}/figures").json():
            assert not [p for p in n["static"] if p.endswith((".png", ".svg"))]
            pngs = [d["path"] for d in n["downloads"] if d["path"].endswith(".png")]
            # engine PNGs stay reachable as originals – when the engine wrote any:
            # the Python port draws nothing, every figure is live
            wrote_pngs = any((main.runner.RUNS / rid).rglob("*.png"))
            if n["id"] in expect[rid] and wrote_pngs:
                assert pngs, (rid, n["id"])


def test_workflows_read_from_source(client):
    wfs = {w["id"]: w for w in client.get("/api/workflows").json()}
    assert wfs["bulk"]["name"] == "Plethos" and wfs["snrna"]["name"] == "Karyon"
    assert wfs["bulk"]["engines"] == ["python", "R"]
    assert [s["id"][:2] for s in wfs["bulk"]["stages"]] == [f"{i:02d}" for i in range(1, 14)]
    bulk = {p["name"]: p for p in wfs["bulk"]["params"]}
    assert bulk["FDR"]["default"] == 0.05 and bulk["LFC_MIN"]["default"] == 0.3
    assert bulk["EXCLUDE"]["default"] == ["T4"]
    sn = {p["name"]: p for p in wfs["snrna"]["params"]}
    assert sn["BROAD_RESOLUTION"]["default"] == 0.35 and sn["RUN_DE_LOO"]["default"] is False
    assert len(wfs["snrna"]["stages"]) == 11


def test_config_py_rewrite_keeps_comments():
    from app.omics.engines.python_scripts import render_config
    out = render_config({"FDR": 0.1, "EXCLUDE": [], "FIG_THEME": "paper"})
    assert 'FDR = 0.1  # padj threshold (primary DEG)  [hodos: edited]' in out
    assert "EXCLUDE = []" in out and "FIG_THEME = 'paper'" in out
    assert "LFC_MIN = 0.30" in out
    compile(out, "config.py", "exec")


def test_config_r_rewrite_keeps_comments():
    from app.omics.engines.rscript import render_config
    out = render_config({"FDR": 0.1, "EXCLUDE": [], "FIG_THEME": "paper"})
    assert 'CFG$FDR         <- 0.1   # padj threshold (primary DEG)  [hodos: edited]' in out
    assert "CFG$EXCLUDE     <- character(0)" in out
    assert 'CFG$LFC_MIN     <- 0.30' in out          # untouched lines are byte-identical


def test_bad_params_rejected(client):
    client.post("/api/inputs/bulk/demo")
    rid = client.post("/api/runs", json={"workflow": "bulk"}).json()["id"]
    r = client.post(f"/api/runs/{rid}/execute", json={"params": {"NOPE": 1}})
    assert r.status_code == 400
    r = client.post(f"/api/runs/{rid}/execute", json={"params": {"FILTER_MIN": 2.5}})
    assert r.status_code == 400


def test_bulk_driver_with_stub_rscript(client, tmp_path, monkeypatch):
    """No R needed: a stub stands in for Rscript and echoes what the driver would run."""
    stub = tmp_path / "Rscript"
    stub.write_text("#!/bin/sh\n"
                    "grep -o '\"[0-9][0-9]_[A-Za-z0-9_]*\"' \"$2\" | tr -d '\"' | while read s; do\n"
                    "  echo \"##HODOS start $s\"; echo working on $s; echo \"##HODOS done $s\"; done\n")
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("HODOS_RSCRIPT", str(stub))
    client.post("/api/inputs/bulk/demo")
    rid = client.post("/api/runs", json={"workflow": "bulk", "engine": "R"}).json()["id"]
    r = client.post(f"/api/runs/{rid}/execute",
                    json={"params": {"FDR": 0.1}, "stage_from": "02_QC_filtering", "stage_to": "05_differential_expression"})
    assert r.status_code == 200, r.text
    m = wait(client, rid)
    assert m["status"] == "done"
    assert [k for k, v in m["stages"].items() if v == "done"] == \
        ["02_QC_filtering", "03_DESeq2_normalization", "04_PCA_clustering", "05_differential_expression"]
    assert m["ledger"][0]["params"] == {"FDR": 0.1}
    log = client.get(f"/api/runs/{rid}/log").json()["text"]
    assert "working on 05_differential_expression" in log
    z = zipfile.ZipFile(io.BytesIO(client.get(f"/api/runs/{rid}/export").content))
    names = z.namelist()
    assert f"hodos-{rid}/scripts/config.R" in names and f"hodos-{rid}/run.sh" in names
    assert b"CFG$FDR         <- 0.1" in z.read(f"hodos-{rid}/scripts/config.R")


def test_missing_rscript_fails_cleanly(client, monkeypatch):
    from app.omics.engines import rscript
    monkeypatch.setattr(rscript, "find_rscript", lambda: None)
    client.post("/api/inputs/bulk/demo")
    rid = client.post("/api/runs", json={"workflow": "bulk", "engine": "R"}).json()["id"]
    client.post(f"/api/runs/{rid}/execute", json={})
    m = wait(client, rid)
    assert m["status"] == "failed"
    assert "Rscript not found" in client.get(f"/api/runs/{rid}/log").json()["text"]


def test_file_route_stays_inside_run(client):
    client.post("/api/inputs/bulk/demo")
    rid = client.post("/api/runs", json={"workflow": "bulk"}).json()["id"]
    assert client.get(f"/api/runs/{rid}/file/../../etc/passwd").status_code == 404
    assert client.get(f"/api/runs/{rid}/file/project/00_input/gene_count.xls").status_code == 200


def test_python_port_and_figures(client, tmp_path, monkeypatch):
    """The Python port runs 01–07 on synthetic data, and every figure that says it
    is available builds a spec. 08–09 need gene-set downloads, so they stay out."""
    monkeypatch.setenv("HODOS_GENESETS", str(tmp_path / "gs"))
    client.post("/api/inputs/bulk/demo")
    rid = client.post("/api/runs", json={"workflow": "bulk"}).json()["id"]
    r = client.post(f"/api/runs/{rid}/execute", json={"params": {"N_CPUS": 1}, "stage_to": "07_DG_identity_scores"})
    assert r.status_code == 200, r.text
    m = wait(client, rid)
    assert m["status"] == "done", client.get(f"/api/runs/{rid}/log").json()["text"][-3000:]
    cat = {n["id"]: n for n in client.get(f"/api/runs/{rid}/figures").json()}
    assert {f["id"] for f in cat["genes"]["figures"]} == {"de", "topheat", "gene", "hist"}
    assert cat["pathways"]["figures"] == []                      # not run yet: a ghost
    for n in cat.values():
        for f in n["figures"]:
            s = client.get(f"/api/runs/{rid}/figures/{n['id']}/{f['id']}").json()
            assert s["kind"] == f["kind"], (n["id"], f["id"], s)
    de = client.get(f"/api/runs/{rid}/figures/genes/de").json()
    gene = de["genes"][0]
    g = client.get(f"/api/runs/{rid}/figures/genes/gene", params={"gene": gene}).json()
    assert g["gene"] == gene and len(g["value"]) == 9          # T4 excluded


@pytest.mark.skipif(not os.environ.get("HODOS_SLOW"), reason="runs the whole notebook (~3 min)")
def test_notebook_end_to_end(client):
    from app.omics.demo import SNRNA_DEMO_OVERRIDES
    client.post("/api/inputs/snrna/demo")
    rid = client.post("/api/runs", json={"workflow": "snrna"}).json()["id"]
    client.post(f"/api/runs/{rid}/execute", json={"params": SNRNA_DEMO_OVERRIDES})
    m = wait(client, rid, limit=1200)
    assert m["status"] == "done", client.get(f"/api/runs/{rid}/log").json()["text"][-2000:]
    files = {f["path"] for f in client.get(f"/api/runs/{rid}/files").json()}
    assert "output/de/DE_all_broad_cell_types.csv" in files
    cat = {n["id"]: n for n in client.get(f"/api/runs/{rid}/figures").json()}
    for n in cat.values():
        for f in n["figures"]:
            r = client.get(f"/api/runs/{rid}/figures/{n['id']}/{f['id']}")
            assert r.status_code == 200, (n["id"], f["id"], r.text)


def test_design_reads_the_sample_sheet(client):
    """The Design card counts animals from metadata.csv; snRNA has no sheet."""
    assert client.get("/api/inputs/bulk/design").json() == {"samples": [], "columns": []}
    client.post("/api/inputs/bulk/demo")
    d = client.get("/api/inputs/bulk/design?source=demo").json()
    assert d["columns"][:2] == ["sample", "group"]
    groups = [r["group"] for r in d["samples"]]
    assert groups.count("V") == 5 and groups.count("T") == 5
    assert client.get("/api/inputs/snrna/design").json()["samples"] == []
    assert client.get("/api/inputs/nope/design").status_code == 404
