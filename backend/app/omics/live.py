"""Live compute API. Recompute results on request from a finished run's saved
objects, instead of only serving what the pipeline pre-baked.

Everything under /api/runs/{rid}/live/… reads the run's own tables and objects
(plethos for bulk, scanpy on the h5ad in backed mode for snRNA) and returns a
spec in exactly the same JSON shape figures.py builds, plus `exact: true` and
`ms`. The heavy, multi-second recomputes (DE refit, GSEA prerank) run as
background jobs with a status endpoint; their results land in the same disk
cache, keyed by parameter hash under run/_live/.

Honesty rules (docs/design/core.md §Live compute plan): these are exact
recomputations on the saved objects – same functions the pipeline used, new
parameters. A run that lacks the inputs is a 4xx with a precise message,
never a silent empty figure.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
import numpy as np
import pandas as pd

from . import core  # noqa: F401 – puts the plethos package on sys.path
from . import figures, runner

router = APIRouter(prefix="/api/runs/{rid}/live")

MAX_POINTS = figures.MAX_POINTS


def _f(a) -> list:
    return figures._f(a)


def _s(a) -> list:
    return figures._s(a)


def _run(rid: str) -> runner.Run:
    try:
        return runner.get_run(rid)
    except KeyError:
        raise HTTPException(404, f"no run {rid}")


def _wrap(spec: dict, t0: float) -> dict:
    # ms covers handler compute: from the start of the route handler (before
    # validation completes) through the cache-miss build, which includes the
    # pickle/CSV loads in _py_objects. FastAPI request parsing and response
    # serialisation are outside it, so ms is a lower bound on wall time.
    spec["exact"] = True
    spec["ms"] = int(round((time.perf_counter() - t0) * 1000))
    return spec


# ------------------------------------------------------------------ disk cache

def _cache_path(run: runner.Run, params: dict) -> Path:
    # The key includes the run's data version (run.json mtime), so re-executing
    # a run invalidates every cached live result: a changed version misses and
    # the stale spec is never served as exact.
    try:
        ver = int(run.path.joinpath("run.json").stat().st_mtime)
    except OSError:
        ver = 0
    raw = json.dumps(params, sort_keys=True, default=str).encode() + f"|v{ver}".encode()
    key = hashlib.sha1(raw).hexdigest()[:16]
    return run.path / "_live" / f"{key}.json"


def _cache_get(p: Path) -> dict | None:
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def _cache_put(p: Path, spec: dict) -> None:
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(spec, separators=(",", ":")))
    except OSError:
        pass    # the cache is an optimisation, never a failure


def _serve(run: runner.Run, params: dict, t0: float, build) -> dict:
    p = _cache_path(run, params)
    hit = _cache_get(p)
    if hit is not None:
        return hit
    spec = _wrap(build(), t0)
    _cache_put(p, spec)
    return spec


# ------------------------------------------------------------------ bulk loaders

def _py_objects(run: runner.Run) -> tuple[Path, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """res / vst / counts / meta from the python engine's saved objects.

    R-engine runs keep none of these, so live recomputation is refused with a
    precise message instead of silently degrading."""
    root = run.outputs
    objs = root / "16_objects"
    if not (objs / "res.pkl").exists():
        raise HTTPException(409, "this run has no saved python objects (16_objects/*.pkl); "
                                  "live recomputation needs a run executed with the python engine")
    res = pd.read_pickle(objs / "res.pkl")
    vst = pd.read_pickle(objs / "vst.pkl") if (objs / "vst.pkl").exists() else figures._vst(root)
    counts = pd.read_pickle(objs / "counts_filt.pkl")
    meta = pd.read_pickle(objs / "meta.pkl")
    if "sample" not in meta.columns:
        # runs written by the plethos package keep the sample names in the index
        meta = meta.rename_axis("sample").reset_index()
    if "symbol" not in res.columns:
        annot = pd.read_pickle(objs / "annot.pkl")
        res = res.copy()
        res["symbol"] = res.gene_id.map(dict(zip(annot.gene_id, annot.symbol)))
    return root, res, vst, counts, meta


def _groups_of(meta: pd.DataFrame) -> pd.Series:
    return meta.set_index(meta["sample"].astype(str))["group"].astype(str)


# ------------------------------------------------------------------ gene-set libraries

_COLLECTIONS = ("GO_BP", "GO_CC", "GO_MF", "Hallmark", "Reactome", "MSIG_GO_BP")
_LIB_CACHE: dict[str, dict] = {}


def _gene_sets(kind: str) -> dict[str, list[str]]:
    """A gene-set library for live ORA / GSEA. Cached JSON first (what the
    pipeline downloaded once), then gseapy's local cache, then a download
    (needs internet). Refused with a precise message if none of that works."""
    if kind not in _COLLECTIONS:
        raise HTTPException(400, f"unknown collection {kind!r}; available: {', '.join(_COLLECTIONS)}")
    if kind in _LIB_CACHE:
        return _LIB_CACHE[kind]
    from config import GENESET_CACHE   # the pipeline's own cache location
    cache = Path(GENESET_CACHE) / f"{kind}.json"
    if cache.exists():
        gs = json.loads(cache.read_text())
        _LIB_CACHE[kind] = gs
        return gs
    import gseapy as gp
    try:
        if kind.startswith("GO_"):
            lib = {"GO_BP": "GO_Biological_Process_2023", "GO_CC": "GO_Cellular_Component_2023",
                   "GO_MF": "GO_Molecular_Function_2023"}[kind]
            gs = gp.get_library(lib, organism="Mouse")
        else:
            import utils   # the pipeline's wrapper: msigdb via gseapy
            gs = utils.gene_sets(kind)
            if gs is None:
                raise RuntimeError("no cached copy and no internet")
        _LIB_CACHE[kind] = gs
        return gs
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(503, f"gene-set library {kind} is not available ({type(e).__name__}: {e}); "
                                 "run the pipeline once with internet to cache it")


# ------------------------------------------------------------------ jobs

_JOBS: dict[str, dict] = {}
_JOB_LOCK = threading.Lock()


class JobError(Exception):
    pass


def _start_job(run: runner.Run, params: dict, fn) -> dict:
    job_id = uuid.uuid4().hex[:12]
    job = {"id": job_id, "run": run.id, "status": "queued", "history": ["queued"],
           "params": params, "created": time.time()}
    with _JOB_LOCK:
        _JOBS[job_id] = job

    def worker():
        job["status"] = "running"
        job["history"].append("running")
        try:
            spec = _wrap(fn(), time.perf_counter())
            _cache_put(_cache_path(run, params), spec)
            job["spec"] = spec
            job["status"] = "done"
        except HTTPException as e:
            job["status"], job["error"] = "error", e.detail
        except Exception as e:
            job["status"], job["error"] = "error", f"{type(e).__name__}: {e}"
        job["history"].append(job["status"])

    threading.Thread(target=worker, daemon=True, name=f"live-job-{job_id}").start()
    return {"job": job_id, "status": "queued", "params": params}


@router.get("/jobs/{job_id}")
def job_status(job_id: str):
    return _job_status(job_id)


def _job_status(job_id: str) -> dict:
    job = _JOBS.get(job_id)
    if not job:
        raise HTTPException(404, f"no live job {job_id} (jobs live in the backend process; "
                                 "a restarted server forgets them, the cached result stays on disk)")
    out = {k: v for k, v in job.items() if k != "params"}
    return out


# ------------------------------------------------------------------ bulk endpoints

class Retreshold(BaseModel):
    fdr: float = 0.05
    lfc: float = 0.3
    p_nominal: float = 0.05
    base_mean: float = Field(0.0, ge=0)


@router.post("/de_rethreshold")
def de_rethreshold(rid: str, body: Retreshold):
    run = _run(rid)
    if not 0 < body.fdr < 1:
        raise HTTPException(400, f"fdr must be in (0, 1), got {body.fdr}")
    if body.lfc < 0:
        raise HTTPException(400, f"lfc must be >= 0, got {body.lfc}")
    params = body.model_dump()
    t0 = time.perf_counter()
    return _serve(run, {"op": "de_rethreshold", **params}, t0, lambda: _de_rethreshold(run, params))


def _de_rethreshold(run: runner.Run, p: dict) -> dict:
    from plethos import de
    _, res, _, _, _ = _py_objects(run)
    r = res[res.baseMean >= p["base_mean"]]
    if r.empty:
        raise HTTPException(400, f"no genes with baseMean >= {p['base_mean']}")
    r = de.threshold(r, fdr=p["fdr"], lfc_min=p["lfc"], p_nominal=p["p_nominal"], merge_symbols=False)
    counts = de.summary_counts(r, p["fdr"], p["lfc"], p["p_nominal"]).set_index("metric")["value"].to_dict()
    return {"kind": "de", "genes": _s(r.symbol), "ids": _s(r.gene_id), "baseMean": _f(r.baseMean),
            "lfc": _f(r.log2FC_MLE), "lfcShrunk": _f(r.log2FC_apeglm) if "log2FC_apeglm" in r else None,
            "p": _f(r.pvalue), "padj": _f(r.padj), "test": "T", "ref": "V",
            "defaults": {"fdr": p["fdr"], "lfc": p["lfc"]}, "counts": counts,
            "note": f"re-thresholded live: FDR < {p['fdr']}, |log2FC| >= {p['lfc']}, baseMean >= {p['base_mean']}"}


class PcaBody(BaseModel):
    exclude: list[str] = []
    color: str = "group"
    n_genes: int = Field(500, ge=10, le=5000)


@router.post("/pca")
def pca_endpoint(rid: str, body: PcaBody):
    run = _run(rid)
    _, _, vst, _, meta = _py_objects(run)
    if body.color not in meta.columns:
        raise HTTPException(400, f"unknown metadata column {body.color!r}; available: {', '.join(meta.columns)}")
    missing = [s for s in body.exclude if s not in set(map(str, vst.columns))]
    if missing:
        raise HTTPException(400, f"unknown sample(s) to exclude: {', '.join(missing)}; "
                                 f"samples are: {', '.join(map(str, vst.columns))}")
    if len(vst.columns) - len(body.exclude) < 3:
        raise HTTPException(400, f"PCA needs at least 3 samples after exclusions; "
                                 f"{len(vst.columns) - len(body.exclude)} would remain")
    params = {"op": "pca", **body.model_dump()}
    t0 = time.perf_counter()
    return _serve(run, params, t0, lambda: _pca(run, params))


def _pca(run: runner.Run, p: dict) -> dict:
    from plethos import pca
    _, _, vst, _, meta = _py_objects(run)
    keep = [c for c in vst.columns if str(c) not in set(p["exclude"])]
    v = vst[keep]
    g = _groups_of(meta).reindex(map(str, v.columns)).fillna("")
    out = pca.pca(v, g, n_genes=p["n_genes"], n_components=3)
    d, ve = out["d"], out["ve"]
    colvals = meta.set_index(meta["sample"].astype(str))[p["color"]].reindex(map(str, v.columns))
    ctype = "num" if pd.api.types.is_numeric_dtype(colvals) else "cat"
    return {"kind": "embedding", "names": _s(d["sample"]), "label": True, "pointSize": 7,
            "axes": {c: {"values": _f(d[c]), "label": f"{c} ({ve[i]:.1f}%)" if i < len(ve) else c}
                     for i, c in enumerate([c for c in ("PC1", "PC2", "PC3") if c in d])},
            "x": "PC1", "y": "PC2",
            "color": {p["color"]: {"type": ctype, "values": _s(colvals) if ctype == "cat" else _f(colvals)},
                      "sample": {"type": "cat", "values": _s(d["sample"])}},
            "colorBy": p["color"],
            "note": f"live PCA on VST, top {out['ngenes']} variable genes"
                    + (f", excluded: {', '.join(p['exclude'])}" if p["exclude"] else "")}


class ScoreBody(BaseModel):
    genes: list[str]
    group_ref: str = "V"
    group_test: str = "T"


@router.post("/score_genes")
def score_genes(rid: str, body: ScoreBody):
    run = _run(rid)
    genes = [g.strip() for g in body.genes if g and g.strip()]
    if not genes:
        raise HTTPException(400, "genes must be a non-empty list of gene symbols")
    _, res, _, _, meta = _py_objects(run)
    if body.group_ref not in set(meta.group.astype(str)) or body.group_test not in set(meta.group.astype(str)):
        raise HTTPException(400, f"unknown group; metadata has groups: {', '.join(sorted(set(meta.group.astype(str))))}")
    params = {"op": "score_genes", "genes": sorted(genes), "group_ref": body.group_ref, "group_test": body.group_test}
    t0 = time.perf_counter()
    return _serve(run, params, t0, lambda: _score_genes(run, genes, body.group_ref, body.group_test))


def _score_genes(run: runner.Run, genes: list[str], ref: str, test: str) -> dict:
    from plethos import signatures
    _, res, vst, _, meta = _py_objects(run)
    sym = res.set_index("gene_id")["symbol"]
    mapped = signatures.map_gene_sets(vst, sym, {"selection": genes}, min_size=1)
    matched = mapped.get("selection", [])
    if not matched:
        raise HTTPException(400, f"none of the {len(genes)} pasted genes match the count matrix – "
                                 "check the symbols against this run's organism")
    # mean_z scores from symbols (it maps case-insensitively itself); singscore
    # takes the mapped matrix indices from map_gene_sets
    mz = signatures.mean_z_scores(vst, sym, {"selection": genes})
    sg = signatures.singscore(vst, mapped)
    g = _groups_of(meta).reindex(map(str, vst.columns))
    metrics = {}
    for name, sc in (("mean_z", mz), ("singscore", sg)):
        col = sc["selection"] if hasattr(sc, "columns") and "selection" in sc else sc
        metrics[name] = {"label": name, "x": _s(g), "group": _s(g), "value": _f(col), "id": _s(vst.columns)}
    cmp_ = signatures.group_comparison(mz[["selection"]], g, ref, test, label="selection").iloc[0]
    return {"kind": "groups", "mode": "box", "groupOrder": list(dict.fromkeys(g)),
            "metrics": metrics, "matched": len(matched),
            "groupTest": {"kind": "effects", "labels": ["selection"],
                          "est": _f([cmp_["delta_T_minus_V"]]), "lo": [None], "hi": [None],
                          "p": _f([cmp_["wilcox_p"]]), "padj": _f([cmp_["wilcox_p"]]),
                          "xLabel": f"score ({test} − {ref}), Mann–Whitney U"},
            "note": f"{len(matched)} of {len(genes)} pasted genes matched the count matrix"}


class OraBody(BaseModel):
    genes: list[str]
    collection: str = "GO_BP"
    qval: float = 0.05


@router.post("/ora")
def ora(rid: str, body: OraBody):
    run = _run(rid)
    genes = [g.strip() for g in body.genes if g and g.strip()]
    if not genes:
        raise HTTPException(400, "genes must be a non-empty list of gene symbols")
    if not 0 < body.qval < 1:
        raise HTTPException(400, f"qval must be in (0, 1), got {body.qval}")
    _gene_sets(body.collection)   # validates the collection name before doing work
    params = {"op": "ora", "genes": sorted(genes), "collection": body.collection, "qval": body.qval}
    t0 = time.perf_counter()
    return _serve(run, params, t0, lambda: _ora(run, genes, body.collection, body.qval))


def _ora(run: runner.Run, genes: list[str], collection: str, qval: float) -> dict:
    from plethos import enrich
    _, res, _, _, _ = _py_objects(run)
    sets = _gene_sets(collection)
    universe = enrich.ora_universe(res)
    uni = {u.lower() for u in universe}
    sel = sorted({g for g in genes if g.lower() in uni})
    if len(sel) < 10:
        raise HTTPException(400, f"ORA needs at least 10 genes in the background universe; "
                                 f"only {len(sel)} of {len(genes)} pasted genes match")
    enr = enrich.ora(sel, sets, universe, qval)
    if enr.empty:
        return {"kind": "enrichment", "terms": [], "score": [], "padj": [], "size": [], "set": [],
                "scoreLabel": "gene ratio", "defaults": {"fdr": qval, "top": 15}, "oneSided": True,
                "note": f"no GO term passed q < {qval} for this {len(sel)}-gene selection"}
    k = enr.Overlap.astype(str).str.split("/").str[0].astype(float)
    n = enr.Overlap.astype(str).str.split("/").str[1].astype(float)
    return {"kind": "enrichment", "terms": _s(enr.Term.map(figures._pretty)), "score": _f(k / n),
            "padj": _f(enr["Adjusted P-value"]), "size": _f(k), "set": [collection] * len(enr),
            "scoreLabel": "gene ratio", "defaults": {"fdr": qval, "top": 15}, "oneSided": True,
            "note": f"live ORA of {len(sel)} genes against {collection}, universe {len(universe)} tested genes"}


# ------------------------------------------------------------------ background jobs (bulk)

class RefitBody(BaseModel):
    exclude: list[str]


@router.post("/de_refit")
def de_refit(rid: str, body: RefitBody):
    run = _run(rid)
    _, res, _, counts, meta = _py_objects(run)
    cols = list(map(str, counts.columns))
    missing = [s for s in body.exclude if s not in cols]
    if missing:
        raise HTTPException(400, f"unknown sample(s) to exclude: {', '.join(missing)}; samples are: {', '.join(cols)}")
    if not body.exclude:
        raise HTTPException(400, "exclude must name at least one sample (use /figures for the full fit)")
    if len(body.exclude) >= len(cols):
        raise HTTPException(400, f"excluding all {len(cols)} samples leaves nothing to fit")
    params = {"op": "de_refit", "exclude": sorted(body.exclude)}
    hit = _cache_get(_cache_path(run, params))
    if hit is not None:
        return {"job": "cached", "status": "done", "cached": True, "spec": hit,
                "cacheKey": _cache_path(run, params).stem}
    def fn():
        from plethos import sensitivity
        res_sens = sensitivity.refit_without(counts, meta, body.exclude, group_col="group")
        merged, lfc_cor, n_full, n_sens = sensitivity.compare_refits(res, res_sens)
        d = merged.dropna(subset=["lfc_full", "lfc_sens"])
        d = d.sample(min(len(d), MAX_POINTS), random_state=0)
        spec = {"kind": "xy", "x": _f(d.lfc_full), "y": _f(d.lfc_sens), "ids": _s(d.gene_id),
                "xLabel": "log2FC (full fit)", "yLabel": "log2FC (refit without " + ", ".join(body.exclude) + ")",
                "diag": True,
                "summary": {"lfcCor": _f([lfc_cor])[0], "nFull": int(n_full), "nSens": int(n_sens),
                            "excluded": body.exclude, "nGenes": int(len(merged))}}
        return spec
    return _start_job(run, params, fn)


class PrerankBody(BaseModel):
    kind: str = "wald"
    permutations: int = Field(1000, ge=100, le=10000)
    min_size: int = Field(10, ge=5, le=100)


@router.post("/gsea_prerank")
def gsea_prerank(rid: str, body: PrerankBody):
    run = _run(rid)
    _, res, _, _, _ = _py_objects(run)
    if body.kind not in ("wald", "log2FC", "signed_p"):
        raise HTTPException(400, f"unknown ranking {body.kind!r} (wald | log2FC | signed_p)")
    params = {"op": "gsea_prerank", "kind": body.kind, "permutations": body.permutations, "min_size": body.min_size}
    def fn():
        from plethos import enrich
        rnk = enrich.gsea_rank(res, body.kind)
        parts, colls = [], []
        for c in _COLLECTIONS:
            try:
                sets = _gene_sets(c)
            except HTTPException:
                continue
            colls.append(c)
            try:
                parts.append(enrich.prerank(rnk, sets, min_size=body.min_size,
                                            permutations=body.permutations))
            except Exception as e:   # e.g. no set passes min_size for this ranking
                if "passed through filtering" not in str(e):
                    raise
        if not colls:
            raise JobError("no gene-set library is available (run the pipeline once with internet to cache them)")
        if not parts:
            return {"kind": "enrichment", "terms": [], "score": [], "padj": [], "size": [], "set": [],
                    "scoreLabel": "NES", "defaults": {"fdr": 0.05, "top": 15},
                    "note": f"no gene set passed min_size {body.min_size} – the ranked genes "
                            "have too little overlap with the cached libraries (empty result, not an error)"}
        for part, coll in zip(parts, colls):
            part["set"] = coll
        d = pd.concat(parts, ignore_index=True).dropna(subset=["NES"])
        if d.empty:
            return {"kind": "enrichment", "terms": [], "score": [], "padj": [], "size": [], "set": [],
                    "scoreLabel": "NES", "defaults": {"fdr": 0.05, "top": 15},
                    "note": f"no gene set passed min_size {body.min_size} – the ranked genes "
                            "have too little overlap with the cached libraries (empty result, not an error)"}
        return {"kind": "enrichment", "terms": _s(d.pathway.map(figures._pretty)), "score": _f(d.NES),
                "padj": _f(d.padj), "size": _f(d["size"]), "set": _s(d["set"]),
                "scoreLabel": "NES", "defaults": {"fdr": 0.05, "top": 15},
                "note": f"live GSEA prerank ({body.kind} ranking, {body.permutations} permutations), "
                        f"collections: {', '.join(colls)}"}
    return _start_job(run, params, fn)


# ------------------------------------------------------------------ snRNA endpoints (backed h5ad)

_SN_CACHE: dict[str, dict] = {}


def _h5ad_or_404(root: Path):
    p = figures._h5ad(root)
    if p is None:
        raise HTTPException(409, "this run has no h5ad checkpoint yet (checkpoints/04_final_annotated.h5ad)")
    return p


def _sn_frame(root: Path) -> dict:
    """The h5ad's static frame (open backed handle, subsampled obs, embedding,
    var names), cached in-process so repeat gene fetches skip the h5ad open."""
    import anndata as ad
    p = _h5ad_or_404(root)
    hit = _SN_CACHE.get(str(p))
    if hit is None:
        a = ad.read_h5ad(p, backed="r")
        n = a.n_obs
        rng = np.random.default_rng(0)
        idx = np.sort(rng.choice(n, MAX_POINTS, replace=False)) if n > MAX_POINTS else np.arange(n)
        basis = "X_umap" if "X_umap" in a.obsm else next(iter(a.obsm))
        hit = {"a": a, "obs": a.obs.iloc[idx].copy(), "xy": np.asarray(a.obsm[basis])[idx],
               "idx": idx, "basis": basis, "var": list(map(str, a.var_names)), "n_vars": a.n_vars}
        _SN_CACHE[str(p)] = hit
    return hit


def _gene_expr(fr: dict, gene: str) -> np.ndarray:
    if gene not in fr["var"]:
        raise HTTPException(400, f"gene {gene!r} is not in this run's matrix ({fr['n_vars']} genes)")
    x = fr["a"][fr["idx"], [fr["var"].index(gene)]].X
    if hasattr(x, "toarray"):     # sparse backed slice
        x = x.toarray()
    return np.asarray(x, dtype=float).ravel()


class UmapGeneBody(BaseModel):
    gene: str
    color: str | None = None


@router.post("/umap_gene")
def umap_gene(rid: str, body: UmapGeneBody):
    run = _run(rid)
    gene = body.gene.strip()
    if not gene:
        raise HTTPException(400, "gene must be a non-empty symbol")
    params = {"op": "umap_gene", "gene": gene, "color": body.color}
    t0 = time.perf_counter()
    return _serve(run, params, t0, lambda: _umap_gene(run.outputs, gene, body.color))


def _umap_gene(root: Path, gene: str, color: str | None) -> dict:
    fr = _sn_frame(root)
    expr = _gene_expr(fr, gene)
    obs, xy, basis = fr["obs"], fr["xy"], fr["basis"]
    colors = {"expression": {"type": "num", "values": _f(expr)}}
    for c in ("cell_type_broad", "cluster_broad", "cluster_fine", "sample", "group"):
        if c in obs:
            colors[c] = {"type": "cat", "values": _s(obs[c].astype(str).to_numpy())}
    for c in ("total_counts", "n_genes_by_counts", "pct_counts_mt", "doublet_score"):
        if c in obs:
            colors[c] = {"type": "num", "values": _f(obs[c].to_numpy())}
    by = color if color in colors else "expression"
    lab = basis.replace("X_", "").upper()
    return {"kind": "embedding", "names": None, "label": False, "pointSize": 2,
            "axes": {f"{lab}1": {"values": _f(xy[:, 0]), "label": f"{lab} 1"},
                     f"{lab}2": {"values": _f(xy[:, 1]), "label": f"{lab} 2"}},
            "x": f"{lab}1", "y": f"{lab}2", "color": colors, "colorBy": by,
            "note": f"UMAP coloured by {gene} expression (live read from the h5ad)"}


class ClusterGeneBody(BaseModel):
    gene: str
    by: str = "cluster_broad"


@router.post("/cluster_gene")
def cluster_gene(rid: str, body: ClusterGeneBody):
    run = _run(rid)
    gene = body.gene.strip()
    if not gene:
        raise HTTPException(400, "gene must be a non-empty symbol")
    params = {"op": "cluster_gene", "gene": gene, "by": body.by}
    t0 = time.perf_counter()
    return _serve(run, params, t0, lambda: _cluster_gene(run.outputs, gene, body.by))


def _cluster_gene(root: Path, gene: str, by: str) -> dict:
    fr = _sn_frame(root)
    obs = fr["obs"]
    if by not in obs.columns:
        raise HTTPException(400, f"unknown obs column {by!r}; available: "
                                 f"{', '.join(map(str, obs.columns[:20]))} …")
    expr = _gene_expr(fr, gene)
    cat = obs[by].astype(str).to_numpy()
    return {"kind": "groups", "mode": "violin", "groupOrder": list(dict.fromkeys(cat)),
            "metrics": {"expression": {"label": f"{gene} · expression", "x": _s(cat), "group": _s(cat),
                                       "value": _f(expr), "id": _s(obs.index)}},
            "logToggle": True,
            "note": f"{len(expr):,} nuclei (subsampled), live read from the h5ad"}
