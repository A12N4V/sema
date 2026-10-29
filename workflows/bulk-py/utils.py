"""utils.py – the thin script-side layer the numbered scripts keep using.

The science moved to the `plethos` package (same directory). What stays here is
everything a script needs to touch the file system: paths, the object cache,
`save_table`, and the log helpers. The plotting helpers (`save_plot`, `fig`,
`apply_theme`, `heatmap`, `points_by_group`) and the matplotlib/seaborn
imports are gone – the Python pipeline writes zero image files; the live
figures in the workbench draw from the tables instead (see docs/design/core.md,
PNG map).
"""
from __future__ import annotations

import json
import pickle
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

import config as CFG

warnings.filterwarnings("ignore", category=FutureWarning)

DIRS = ["00_input", "01_metadata", "02_quality_control", "03_normalized_expression",
        "04_PCA_clustering", "05_differential_expression", "05_differential_expression/complete_tables",
        "05_differential_expression/significant_FDR", "05_differential_expression/exploratory_pvalue",
        "05_differential_expression/live", "06_volcano_plots", "07_heatmaps", "08_DG_identity_enrichment",
        "09_GO_ORA", "09_GO_ORA/BP", "09_GO_ORA/CC", "09_GO_ORA/MF",
        "10_GSEA", "11_pathway_visualization", "12_candidate_genes", "13_publication_figures",
        "14_supplementary_figures", "15_reports", "16_objects", "signatures", "signatures/tables"]
for d in DIRS:
    (CFG.PROJ_ROOT / d).mkdir(parents=True, exist_ok=True)


def P(*parts) -> Path:
    return CFG.PROJ_ROOT.joinpath(*map(str, parts))


# ---- progress / checks -----------------------------------------------------
def say(fmt: str, *args) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] " + (fmt % args if args else fmt), flush=True)


def need_file(path) -> None:
    if not Path(path).exists():
        raise FileNotFoundError(f"Missing file: {path}")


# ---- object cache (the R scripts' 16_R_objects/*.rds) -------------------------
def save_obj(obj, name: str):
    with open(P("16_objects", f"{name}.pkl"), "wb") as f:
        pickle.dump(obj, f)
    return obj


def load_obj(name: str):
    f = P("16_objects", f"{name}.pkl")
    need_file(f)
    with open(f, "rb") as fh:
        return pickle.load(fh)


def try_obj(name: str):
    try:
        return load_obj(name)
    except FileNotFoundError:
        return None


def save_table(df: pd.DataFrame, name: str, d: str) -> pd.DataFrame:
    df.to_csv(P(d, f"{name}.csv"), index=False)
    try:
        df.to_excel(P(d, f"{name}.xlsx"), index=False)
    except Exception:
        pass
    return df


def write_note(text: str, name: str, d: str) -> None:
    """A small .txt note next to the tables (README, summaries)."""
    P(d, name).write_text(text)


def read_signatures(name: str) -> pd.DataFrame:
    """Signature table from `signatures/<name>`. Kept here (script-side I/O);
    the package's scoring functions take the loaded frame."""
    f = P("signatures", name)
    need_file(f)
    return pd.read_csv(f)


def gene_sets(kind: str) -> dict[str, list[str]] | None:
    """Gene-set library, downloaded once then cached as JSON. Script-side I/O
    wrapper around the gseapy download; the package's enrich functions take
    the dict. kind: GO_BP | GO_CC | GO_MF (Enrichr libraries) or Hallmark |
    Reactome | MSIG_GO_BP (MSigDB mouse)."""
    CFG.GENESET_CACHE.mkdir(parents=True, exist_ok=True)
    cache = CFG.GENESET_CACHE / f"{kind}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    import gseapy as gp
    try:
        if kind.startswith("GO_"):
            lib = {"GO_BP": "GO_Biological_Process_2023", "GO_CC": "GO_Cellular_Component_2023",
                   "GO_MF": "GO_Molecular_Function_2023"}[kind]
            gs = gp.get_library(lib, organism="Mouse")
        else:
            cat = {"Hallmark": "mh.all", "Reactome": "m2.cp.reactome", "MSIG_GO_BP": "m5.go.bp"}[kind]
            msig = gp.Msigdb()
            ver = next((v for v in reversed(msig.list_dbver()["Name"].tolist()) if v.endswith(".Mm")), "2023.2.Mm")
            gs = msig.get_gmt(category=cat, dbver=ver)
    except Exception as exc:
        say("Gene sets %s unavailable (%s). Needs internet once; then cached in %s.", kind, exc, CFG.GENESET_CACHE)
        return None
    cache.write_text(json.dumps(gs))
    return gs


def step(name: str):
    say("======== %s ========", name)


# ---- re-export the package's pure helpers for the scripts --------------------
# The numbered scripts import these from utils for brevity; the implementations
# live in plethos and are tested there.
sys.path.insert(0, str(Path(__file__).resolve().parent))          # for `config`
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))   # for `plethos` (belt and braces)
from plethos.common import bh, clean_rows, pretty_pw, row_z  # noqa: E402,F401
from plethos.io import informative_covariates, map_symbols, read_counts  # noqa: E402,F401
