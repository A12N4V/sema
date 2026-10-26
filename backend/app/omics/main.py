"""HTTP surface. POST /api/runs/{id}/execute is the only path that runs anything."""
from __future__ import annotations

import io
import mimetypes
import shutil
import zipfile
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import demo, figures, live, runner
from .workflows import REPO, all_workflows

# Mounted by Sema at /omics: these routes are served as /omics/api/...
app = FastAPI(title="sema-omics", version="0.1.0")

app.include_router(live.router)


def _run(run_id: str) -> runner.Run:
    try:
        return runner.get_run(run_id)
    except KeyError:
        raise HTTPException(404, f"no run {run_id}")


def _inputs(workflow: str, source: str) -> list[dict]:
    d = runner.input_dir(workflow, source)
    if not d.exists():
        return []
    return [{"name": str(p.relative_to(d)), "bytes": p.stat().st_size} for p in sorted(d.rglob("*")) if p.is_file()]


# ------------------------------------------------------------------ meta

@app.get("/api/capabilities")
def capabilities():
    pkgs = {}
    for p in ["scanpy", "anndata", "pydeseq2", "gseapy", "leidenalg", "nbclient"]:
        try:
            pkgs[p] = version(p)
        except PackageNotFoundError:
            pkgs[p] = None
    return {"rscript": runner.find_rscript(), "python": pkgs}


@app.get("/api/workflows")
def workflows():
    return [w.public() for w in all_workflows().values()]


@app.get("/api/workflows/{wf}/stages/{sid}/source", response_class=PlainTextResponse)
def stage_source(wf: str, sid: str, engine: str | None = None):
    w = all_workflows().get(wf)
    s = next((s for s in w.stages if s.id == sid), None) if w else None
    if not s:
        raise HTTPException(404)
    return s.sources.get(engine, s.source) if engine else s.source


# ------------------------------------------------------------------ inputs

@app.get("/api/inputs/{wf}")
def inputs(wf: str):
    if wf not in ("bulk", "snrna"):
        raise HTTPException(404)
    return {"uploaded": _inputs(wf, "uploaded"), "demo": _inputs(wf, "demo")}


@app.post("/api/inputs/{wf}/demo")
def make_demo(wf: str):
    d = runner.input_dir(wf, "demo")
    shutil.rmtree(d, ignore_errors=True)
    if wf == "bulk":
        demo.write_bulk_demo(d)
    elif wf == "snrna":
        demo.write_snrna_demo(d)
    else:
        raise HTTPException(404)
    return {"demo": _inputs(wf, "demo")}


# Bulk wants two files under fixed names plus the signature tables; snRNA wants the eight .h5 files.
_BULK_NAMES = {"counts": "gene_count.xls", "metadata": "metadata.csv"}
_SIGNATURES = {"DG_cell_type_signatures.csv", "targeted_axes_signatures.csv"}


@app.post("/api/inputs/{wf}")
async def upload(wf: str, files: list[UploadFile], role: str | None = None):
    d = runner.input_dir(wf, "uploaded")
    d.mkdir(parents=True, exist_ok=True)
    for f in files:
        name = Path(f.filename or "").name
        if wf == "bulk":
            if role == "signatures":
                if name not in _SIGNATURES:
                    raise HTTPException(400, f"signature tables are named {' or '.join(sorted(_SIGNATURES))}")
                (d / "signatures").mkdir(exist_ok=True)
                name = f"signatures/{name}"
            elif role in _BULK_NAMES:
                name = _BULK_NAMES[role]
            else:
                raise HTTPException(400, "role must be counts, metadata or signatures")
        elif not name.endswith(".h5"):
            raise HTTPException(400, f"{name}: expected a CellBender .h5")
        with open(d / name, "wb") as out:
            shutil.copyfileobj(f.file, out)
    return {"uploaded": _inputs(wf, "uploaded")}


# ------------------------------------------------------------------ runs

class NewRun(BaseModel):
    workflow: str
    source: str = "demo"          # demo | uploaded
    engine: str | None = None     # default: the workflow's first engine
    label: str = ""


class Exec(BaseModel):
    params: dict = {}
    stage_from: str | None = None
    stage_to: str | None = None


@app.get("/api/runs")
def runs():
    return runner.list_runs()


@app.post("/api/runs")
def new_run(body: NewRun):
    if body.workflow not in ("bulk", "snrna") or body.source not in ("demo", "uploaded"):
        raise HTTPException(400, "unknown workflow or source")
    if not _inputs(body.workflow, body.source):
        raise HTTPException(400, f"no {body.source} inputs for {body.workflow} yet")
    try:
        return runner.create_run(body.workflow, body.source, body.engine, body.label).load()
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/runs/{rid}")
def run_meta(rid: str):
    m = _run(rid).load()
    m["active"] = runner.is_active(rid)
    return m


@app.post("/api/runs/{rid}/execute")
def run_execute(rid: str, body: Exec):
    run = _run(rid)
    try:
        return runner.execute(run, body.params, body.stage_from, body.stage_to)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(409 if isinstance(e, RuntimeError) else 400, str(e))


@app.post("/api/runs/{rid}/cancel")
def run_cancel(rid: str):
    return {"cancelled": runner.cancel(_run(rid))}


@app.delete("/api/runs/{rid}")
def run_delete(rid: str):
    run = _run(rid)
    if runner.is_active(rid):
        raise HTTPException(409, "cancel it first")
    shutil.rmtree(run.path)
    return {"deleted": rid}


@app.get("/api/runs/{rid}/log")
def run_log(rid: str, offset: int = 0):
    p = _run(rid).path / "log.txt"
    if not p.exists():
        return {"text": "", "offset": 0}
    with open(p, "rb") as f:
        f.seek(offset)
        data = f.read()
    return {"text": data.decode("utf-8", "replace"), "offset": offset + len(data)}


_SHOW = {".png", ".svg", ".csv", ".tsv", ".txt", ".md", ".json", ".pdf", ".xlsx", ".h5ad", ".rds", ".ipynb", ".html"}


@app.get("/api/runs/{rid}/files")
def run_files(rid: str):
    run = _run(rid)
    out = []
    for base in (run.outputs, run.path / "_cells"):
        if not base.exists():
            continue
        for p in sorted(base.rglob("*")):
            rel = p.relative_to(run.path)
            if p.is_file() and p.suffix.lower() in _SHOW and "scripts" not in rel.parts[:2]:
                out.append({"path": str(rel), "bytes": p.stat().st_size, "ext": p.suffix.lower()[1:],
                            "mtime": p.stat().st_mtime})
    return out


@app.get("/api/runs/{rid}/file/{path:path}")
def run_file(rid: str, path: str):
    run = _run(rid)
    p = (run.path / path).resolve()
    if run.path.resolve() not in p.parents or not p.is_file():
        raise HTTPException(404)
    return FileResponse(p, media_type=mimetypes.guess_type(p.name)[0] or "application/octet-stream")


@app.get("/api/runs/{rid}/figures")
def run_figures(rid: str):
    run = _run(rid)
    return figures.catalogue(run.load()["workflow"], run.outputs, run.path)


@app.get("/api/runs/{rid}/figures/{noun}/{fig}")
def run_figure(rid: str, noun: str, fig: str, variant: str | None = None, gene: str | None = None):
    run = _run(rid)
    try:
        return figures.spec(run.load()["workflow"], run.outputs, noun, fig, variant, gene, run.path / "_figcache")
    except KeyError:
        raise HTTPException(404, f"{noun}/{fig} has not been produced in this run")
    except Exception as e:   # a table the adapter cannot read is a 422, not a crash
        raise HTTPException(422, f"{type(e).__name__}: {e}")


@app.get("/api/runs/{rid}/export")
def run_export(rid: str, entry: int | None = None):
    run = _run(rid)
    try:
        files = runner.export_bundle(run, entry)
    except (ValueError, IndexError) as e:
        raise HTTPException(400, str(e))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            info = zipfile.ZipInfo(f"hodos-{rid}/{name}")
            info.external_attr = (0o755 if name.endswith(".sh") else 0o644) << 16
            z.writestr(info, data)
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="hodos-{rid}.zip"'})
