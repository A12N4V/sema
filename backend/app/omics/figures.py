"""Interactive figures, built from the tables the workflows write.

The noun axis. Sema's bottom strip is generated from MNE's container graph;
here it is generated from what a run has written. Each Noun is a kind of
result (libraries, samples, genes, ...), each Figure inside it is an adapter
that reads one of the workflow's own output tables and returns a spec the
client draws on a canvas, with zoom, pan, and settings. Adapters read files,
never engine state, so the R scripts, the Python port and the notebook all get
the same figures, and a figure whose table does not exist yet is simply absent.

Spec kinds (the client has one renderer per kind):
  de          genes × (baseMean, lfc, p, padj): volcano and MA, thresholds live
  embedding   points in 2D with categorical or numeric colourings (PCA, UMAP)
  groups      values by category and group, one point per animal / nucleus
  enrichment  terms × (score, padj, size, set)
  heatmap     rows × cols matrix
  effects     estimate with interval per label (forest)
  xy          paired values, optional identity line
  gene        one gene across samples (the selected-gene spine)
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np
import pandas as pd

MAX_POINTS = 40_000


def _f(a) -> list:
    """JSON-safe floats (NaN/inf -> None), rounded to keep payloads small."""
    out = []
    for x in np.asarray(a, dtype=float):
        out.append(None if not math.isfinite(x) else float(f"{x:.5g}"))
    return out


def _s(a) -> list[str]:
    return [str(x) for x in a]


@dataclass
class Figure:
    id: str
    title: str
    kind: str
    files: Callable[[Path], list[Path]]          # what it reads; present = available
    build: Callable[..., dict]                   # (root, variant, gene) -> spec
    variants: Callable[[Path], list[str]] | None = None
    note: str = ""


@dataclass
class Noun:
    id: str
    label: str
    icon: str
    hint: str                                    # shown on the ghost chip
    dirs: list[str]                              # folders whose static files belong here
    figures: list[Figure] = field(default_factory=list)


def _one(*rel: str) -> Callable[[Path], list[Path]]:
    return lambda root: [root.joinpath(*rel)] if root.joinpath(*rel).exists() else []


def _glob(pattern: str) -> Callable[[Path], list[Path]]:
    return lambda root: sorted(root.glob(pattern))


# ================================================================== Plethos

def _bulk_groups(root: Path, ref="V", test="T") -> dict:
    meta = root / "01_metadata" / "metadata.csv"
    return {"order": [ref, test]} if meta.exists() else {}


def bulk_qc(root: Path, variant=None, gene=None) -> dict:
    d = pd.read_csv(root / "02_quality_control" / "QC_per_sample_summary.csv")
    metrics = {"library_size": "Library size (total counts)", "genes_detected": "Genes detected (>0)",
               "pct_zero": "% genes with zero counts", "median_nonzero": "Median non-zero count"}
    return {"kind": "groups", "mode": "bars", "groupOrder": list(dict.fromkeys(d.group)),
            "metrics": {k: {"label": v, "x": _s(d["sample"]), "group": _s(d.group), "value": _f(d[k]),
                            "id": _s(d["sample"])} for k, v in metrics.items() if k in d}}


def bulk_pca(root: Path, variant=None, gene=None) -> dict:
    d = pd.read_csv(root / "04_PCA_clustering" / "PCA_coordinates.csv")
    ve = [d[c].iloc[0] for c in d.columns if c.startswith("var_explained_")]
    axes = [c for c in ("PC1", "PC2", "PC3") if c in d]
    return {"kind": "embedding", "names": _s(d["sample"]), "label": True, "pointSize": 7,
            "axes": {a: {"values": _f(d[a]), "label": f"{a} ({ve[i]:.1f}%)" if i < len(ve) else a} for i, a in enumerate(axes)},
            "x": "PC1", "y": "PC2",
            "color": {"group": {"type": "cat", "values": _s(d.group)}, "sample": {"type": "cat", "values": _s(d["sample"])}},
            "colorBy": "group"}


def _matrix(path: Path, key: str) -> pd.DataFrame:
    d = pd.read_csv(path)
    return d.set_index(d.columns[0] if key not in d else key)


def bulk_corr(root: Path, variant=None, gene=None) -> dict:
    m = _matrix(root / "04_PCA_clustering" / "sample_correlation_matrix.csv", "sample")
    return {"kind": "heatmap", "rows": _s(m.index), "cols": _s(m.columns), "z": [_f(r) for r in m.to_numpy()],
            "scale": "sequential", "label": "Pearson r", "annotate": True}


def _de_table(root: Path) -> pd.DataFrame:
    return pd.read_csv(root / "05_differential_expression" / "complete_tables" / "DE_all_genes_complete.csv")


def bulk_de(root: Path, variant=None, gene=None) -> dict:
    d = _de_table(root)
    return {"kind": "de", "genes": _s(d.symbol), "ids": _s(d.gene_id), "baseMean": _f(d.baseMean),
            "lfc": _f(d.log2FC_MLE), "lfcShrunk": _f(d.log2FC_apeglm) if "log2FC_apeglm" in d else None,
            "p": _f(d.pvalue), "padj": _f(d.padj), "test": "T", "ref": "V",
            "defaults": {"fdr": 0.05, "lfc": 0.3}}


def _vst(root: Path) -> pd.DataFrame:
    v = pd.read_csv(root / "03_normalized_expression" / "VST_expression.csv")
    return v.set_index("gene_id")


def _meta(root: Path) -> pd.Series:
    m = pd.read_csv(root / "01_metadata" / "metadata.csv")
    return m.set_index(m["sample"].astype(str))["group"].astype(str)


def bulk_topheat(root: Path, variant=None, gene=None) -> dict:
    n = int(variant or 50)
    d = _de_table(root).dropna(subset=["pvalue"]).sort_values("pvalue").head(n)
    v = _vst(root).reindex(d.gene_id).dropna(how="all")
    z = v.sub(v.mean(axis=1), axis=0).div(v.std(axis=1).replace(0, np.nan), axis=0)
    sym = dict(zip(d.gene_id, d.symbol))
    # cluster rows and columns the way pheatmap does (average linkage on euclidean)
    from scipy.cluster.hierarchy import leaves_list, linkage
    zz = z.fillna(0).to_numpy()
    ro = leaves_list(linkage(zz, "average")) if len(zz) > 2 else np.arange(len(zz))
    co = leaves_list(linkage(zz.T, "average")) if zz.shape[1] > 2 else np.arange(zz.shape[1])
    z = z.iloc[ro, co]
    grp = _meta(root)
    return {"kind": "heatmap", "rows": [sym.get(i, i) for i in z.index], "rowIds": _s(z.index),
            "cols": _s(z.columns), "colGroups": [grp.get(c, "") for c in z.columns],
            "z": [_f(r) for r in z.to_numpy()], "scale": "diverging", "label": "VST z", "selectable": True}


def bulk_gene(root: Path, variant=None, gene=None) -> dict:
    v = _vst(root)
    de = _de_table(root)
    if gene and gene not in v.index:
        hit = de.loc[de.symbol.astype(str) == gene, "gene_id"]
        gene = hit.iloc[0] if len(hit) else None
    gene = gene or de.gene_id.iloc[0]
    row = de.loc[de.gene_id == gene].iloc[0] if (de.gene_id == gene).any() else None
    grp = _meta(root).reindex(v.columns)
    return {"kind": "gene", "gene": str(row.symbol if row is not None else gene), "id": gene,
            "samples": _s(v.columns), "group": _s(grp.fillna("")), "value": _f(v.loc[gene]), "yLabel": "VST expression",
            "stats": None if row is None else {"log2FC": _f([row.log2FC_MLE])[0], "padj": _f([row.padj])[0],
                                               "pvalue": _f([row.pvalue])[0]}}


def _scores(rel: str, label: str):
    def build(root: Path, variant=None, gene=None) -> dict:
        d = pd.read_csv(root / rel)
        cols = [c for c in d.columns if c not in ("sample", "group")]
        return {"kind": "groups", "mode": "box", "groupOrder": list(dict.fromkeys(d.group.astype(str))),
                "metrics": {c: {"label": f"{c} · {label}", "x": _s(d.group), "group": _s(d.group),
                                "value": _f(d[c]), "id": _s(d["sample"])} for c in cols}}
    return build


def bulk_gsea(root: Path, variant=None, gene=None) -> dict:
    d = pd.read_csv(root / "10_GSEA" / "GSEA_all_collections_wald_and_sensitivity.csv")
    d = d[d.ranking == (variant or "wald")].dropna(subset=["NES"])
    return {"kind": "enrichment", "terms": _s(d.pathway.map(_pretty)), "score": _f(d.NES), "padj": _f(d.padj),
            "size": _f(d["size"]), "set": _s(d.collection), "scoreLabel": "NES", "defaults": {"fdr": 0.05, "top": 15}}


def _bulk_go_files(root: Path) -> list[Path]:
    return sorted(root.glob("09_GO_ORA/*/GO_*_complete.csv"))


def bulk_go(root: Path, variant=None, gene=None) -> dict:
    files = _bulk_go_files(root)
    f = next((p for p in files if p.stem == variant), files[0])
    d = pd.read_csv(f)
    term = d.Term if "Term" in d else d.Description
    padj = d["Adjusted P-value"] if "Adjusted P-value" in d else d["p.adjust"]
    ratio = d.Overlap if "Overlap" in d else d.GeneRatio
    k = ratio.astype(str).str.split("/").str[0].astype(float)
    n = ratio.astype(str).str.split("/").str[1].astype(float)
    return {"kind": "enrichment", "terms": _s(term), "score": _f(k / n), "padj": _f(padj), "size": _f(k),
            "set": [f.parent.name] * len(d), "scoreLabel": "gene ratio", "defaults": {"fdr": 0.05, "top": 15},
            "oneSided": True}


def bulk_sens(root: Path, variant=None, gene=None) -> dict:
    d = pd.read_csv(root / "15_reports" / "sensitivity_with_without_T4_LFC.csv").dropna(subset=["lfc_full", "lfc_sens"])
    d = d.sample(min(len(d), MAX_POINTS), random_state=0)
    return {"kind": "xy", "x": _f(d.lfc_full), "y": _f(d.lfc_sens), "ids": _s(d.gene_id),
            "xLabel": "log2FC (main analysis)", "yLabel": "log2FC (sensitivity refit)", "diag": True}


def bulk_hist(root: Path, variant=None, gene=None) -> dict:
    """Histogram of one DE column (p-value, padj, log2FC, ...) with a
    draggable threshold line on the client. Bins are precomputed here so the
    payload stays tiny however many genes the table holds."""
    d = _de_table(root)
    cols = [c for c in ("pvalue", "padj", "log2FC_MLE", "log2FC_apeglm", "stat_Wald", "baseMean") if c in d]
    if not cols:
        cols = [c for c in d.columns if pd.api.types.is_numeric_dtype(d[c])][:1]
    if not cols:
        return {"kind": "histogram", "column": "", "columns": [], "edges": [0.0, 1.0],
                "counts": [0], "na": int(len(d)), "total": int(len(d)), "cutDefault": None}
    col = variant if variant in cols else cols[0]
    v = pd.to_numeric(d[col], errors="coerce").dropna()
    edges = np.histogram_bin_edges(v, bins=60)
    counts, _ = np.histogram(v, bins=edges)
    return {"kind": "histogram", "column": col, "columns": cols,
            "edges": _f(edges), "counts": [int(c) for c in counts],
            "na": int(len(d) - len(v)), "total": int(len(d)),
            "cutDefault": 0.05 if col in ("pvalue", "padj") else None}


def _hist_columns(root: Path) -> list[str]:
    return bulk_hist(root).get("columns", []) if _de_table_ok(root) else []


def _de_table_ok(root: Path) -> bool:
    return (root / "05_differential_expression" / "complete_tables" / "DE_all_genes_complete.csv").exists()


def sn_dotplot(root: Path, variant=None, gene=None) -> dict:
    """Marker × cluster dot plot: size = fraction expressing, colour = mean
    log2FC. Top markers per cluster, ranked by the marker score."""
    d = pd.read_csv(root / "markers" / "all_fine_cluster_markers.csv")
    d = d.dropna(subset=["names"]).sort_values("scores", ascending=False)
    clusters = sorted(d.group.astype(str).unique(), key=lambda x: (len(x), x))
    rows = []
    per = 12
    for c in clusters:
        for _, r in d[d.group.astype(str) == c].head(per).iterrows():
            rows.append({"cluster": c, "gene": str(r.names), "lfc": _f([r.logfoldchanges])[0],
                         "pct": _f([r.pct_nz_group])[0], "score": _f([r.scores])[0]})
    return {"kind": "dotplot", "clusters": clusters, "rows": rows,
            "perCluster": per, "maxPct": _f([d.pct_nz_group.max()])[0] or 1.0}


def bulk_overlap(root: Path, variant=None, gene=None) -> dict:
    """Signature × signature overlap matrix (replaces the UpSet plot):
    z = shared-gene count, hover lists the shared genes."""
    d = pd.read_csv(root / "12_candidate_genes" / "signature_gene_overlap.csv")
    sets = sorted({*d.set_a.astype(str), *d.set_b.astype(str)})
    idx = {s: i for i, s in enumerate(sets)}
    n = len(sets)
    z: list[list[float | None]] = [[None] * n for _ in range(n)]
    genes: list[list[list[str]]] = [[[] for _ in range(n)] for _ in range(n)]
    for _, r in d.iterrows():
        a, b = idx[str(r.set_a)], idx[str(r.set_b)]
        g = [x.strip() for x in str(r.genes).split(";") if x.strip()] if pd.notna(r.genes) else []
        z[a][b] = z[b][a] = float(r.shared)
        genes[a][b] = genes[b][a] = g
    return {"kind": "overlap-matrix", "sets": sets, "z": z, "genes": genes,
            "label": "shared genes"}


def bulk_publication(root: Path, variant=None, gene=None) -> dict:
    """Publication layout composed from live figures (replaces the static
    Figure1/2/4 composites): each panel is a real spec, drawn by its own
    renderer, so the composite is exportable as one PNG."""
    def panel(title: str, build: Callable[..., dict], **kw) -> dict:
        p = build(root, **kw)
        p.pop("id", None); p.pop("noun", None); p.pop("variant", None)
        p["title"] = title
        return p
    d = _de_table(root)
    keep = d.padj.notna() & (d.padj < 0.05)
    top = d.dropna(subset=["pvalue"]).nsmallest(2500, "pvalue")
    keep = d.loc[keep.index.union(top.index)]
    vol = {"kind": "de", "genes": _s(keep.symbol), "ids": _s(keep.gene_id), "baseMean": _f(keep.baseMean),
           "lfc": _f(keep.log2FC_MLE), "lfcShrunk": _f(keep.log2FC_apeglm) if "log2FC_apeglm" in keep else None,
           "p": _f(keep.pvalue), "padj": _f(keep.padj), "test": "T", "ref": "V",
           "defaults": {"fdr": 0.05, "lfc": 0.3}, "title": "Volcano (FDR 0.05)"}
    return {"kind": "multi-panel", "panels": [
        panel("Library QC", bulk_qc),
        vol,
        panel("Top 50 DEGs", bulk_topheat, variant="50"),
        panel("GSEA (Wald)", bulk_gsea),
    ]}


PLETHOS = [
    Noun("libraries", "Libraries", "Database", "run 02 QC", ["02_quality_control"], [
        Figure("qc", "Library QC", "groups", _one("02_quality_control", "QC_per_sample_summary.csv"), bulk_qc)]),
    Noun("samples", "Samples", "ScatterChart", "run 04 PCA",
         ["03_normalized_expression", "04_PCA_clustering"], [
        Figure("pca", "PCA", "embedding", _one("04_PCA_clustering", "PCA_coordinates.csv"), bulk_pca,
               note="top 500 variable genes, VST"),
        Figure("corr", "Sample correlation", "heatmap", _one("04_PCA_clustering", "sample_correlation_matrix.csv"), bulk_corr)]),
    Noun("genes", "Genes", "Dna", "run 05 DE",
         ["05_differential_expression", "06_volcano_plots", "07_heatmaps"], [
        Figure("de", "Differential expression", "de", _one("05_differential_expression", "complete_tables", "DE_all_genes_complete.csv"), bulk_de),
        Figure("topheat", "Top genes", "heatmap",
               lambda r: _one("05_differential_expression", "complete_tables", "DE_all_genes_complete.csv")(r)
               and _one("03_normalized_expression", "VST_expression.csv")(r), bulk_topheat,
               variants=lambda r: ["25", "50", "100", "200"]),
        Figure("gene", "Gene", "gene",
               lambda r: _one("03_normalized_expression", "VST_expression.csv")(r)
               and _one("05_differential_expression", "complete_tables", "DE_all_genes_complete.csv")(r), bulk_gene),
        Figure("hist", "DE distributions", "histogram",
               _one("05_differential_expression", "complete_tables", "DE_all_genes_complete.csv"), bulk_hist,
               variants=_hist_columns, note="drag the threshold line on the canvas")]),
    Noun("signatures", "Signatures", "Fingerprint", "run 07 and 10",
         ["08_DG_identity_enrichment", "12_candidate_genes"], [
        Figure("identity", "DG identity", "groups", _one("08_DG_identity_enrichment", "DG_identity_score_per_sample.csv"),
               _scores("08_DG_identity_enrichment/DG_identity_score_per_sample.csv", "score")),
        Figure("cellsig", "Cell-type signatures", "groups", _one("08_DG_identity_enrichment", "signature_scores_meanZ.csv"),
               _scores("08_DG_identity_enrichment/signature_scores_meanZ.csv", "mean z")),
        Figure("axes", "Targeted axes", "groups", _one("12_candidate_genes", "axis_scores_per_sample.csv"),
               _scores("12_candidate_genes/axis_scores_per_sample.csv", "mean z")),
        Figure("overlap", "Signature overlap", "overlap-matrix",
               _one("12_candidate_genes", "signature_gene_overlap.csv"), bulk_overlap,
               note="hover a cell for the shared genes")]),
    Noun("pathways", "Pathways", "Network", "run 08 and 09",
         ["09_GO_ORA", "10_GSEA", "11_pathway_visualization"], [
        Figure("gsea", "GSEA", "enrichment", _one("10_GSEA", "GSEA_all_collections_wald_and_sensitivity.csv"), bulk_gsea,
               variants=lambda r: ["wald", "log2FC", "signed_p"]),
        Figure("go", "GO over-representation", "enrichment", _bulk_go_files, bulk_go,
               variants=lambda r: [p.stem for p in _bulk_go_files(r)])]),
    Noun("report", "Report", "FileText", "run 11 to 13",
         ["13_publication_figures", "14_supplementary_figures", "15_reports"], [
        Figure("sens", "Sensitivity refit", "xy", _one("15_reports", "sensitivity_with_without_T4_LFC.csv"), bulk_sens),
        Figure("publication", "Publication panels", "multi-panel",
               _one("13_publication_figures", "Figure1_overview.png"), bulk_publication,
               note="four live panels, exportable as one figure")]),
]


# ================================================================== Karyon

def _h5ad(root: Path) -> Path | None:
    for n in ("04_final_annotated", "03_annotated", "02_clustered"):
        p = root / "checkpoints" / f"{n}.h5ad"
        if p.exists():
            return p
    return None


def sn_embedding(root: Path, variant=None, gene=None, color="cluster_broad") -> dict:
    import anndata as ad
    a = ad.read_h5ad(_h5ad(root), backed="r")
    obs = a.obs
    n = a.n_obs
    rng = np.random.default_rng(0)
    idx = np.sort(rng.choice(n, MAX_POINTS, replace=False)) if n > MAX_POINTS else np.arange(n)
    basis = "X_umap" if "X_umap" in a.obsm else next(iter(a.obsm))
    xy = np.asarray(a.obsm[basis])[idx]
    colors = {}
    for c in ("cell_type_broad", "cluster_broad", "cluster_fine", "sample", "group"):
        if c in obs:
            colors[c] = {"type": "cat", "values": _s(obs[c].astype(str).to_numpy()[idx])}
    for c in ("total_counts", "n_genes_by_counts", "pct_counts_mt", "doublet_score"):
        if c in obs:
            colors[c] = {"type": "num", "values": _f(obs[c].to_numpy()[idx])}
    a.file.close()
    lab = basis.replace("X_", "").upper()
    return {"kind": "embedding", "names": None, "label": False, "pointSize": 2,
            "axes": {f"{lab}1": {"values": _f(xy[:, 0]), "label": f"{lab} 1"},
                     f"{lab}2": {"values": _f(xy[:, 1]), "label": f"{lab} 2"}},
            "x": f"{lab}1", "y": f"{lab}2", "color": colors,
            "colorBy": color if color in colors else next(iter(colors), None),
            "subsampled": int(n) if n > MAX_POINTS else None}


def sn_qc(root: Path, variant=None, gene=None) -> dict:
    files = sorted((root / "qc").glob("*_nucleus_qc.csv"))
    parts = []
    for f in files:
        d = pd.read_csv(f)
        parts.append(d.sample(min(len(d), 1500), random_state=0))
    d = pd.concat(parts, ignore_index=True)
    metrics = {"n_genes_by_counts": "genes per nucleus", "total_counts": "UMIs per nucleus",
               "pct_counts_mt": "% mitochondrial", "pct_counts_ambient_myelin": "% myelin (ambient)",
               "doublet_score": "Scrublet doublet score"}
    return {"kind": "groups", "mode": "violin", "groupOrder": ["VEH", "THC"], "logToggle": True,
            "metrics": {k: {"label": v, "x": _s(d["sample"]), "group": _s(d.group), "value": _f(d[k]),
                            "id": _s(d.barcode)} for k, v in metrics.items() if k in d},
            "note": f"{len(d):,} nuclei shown, up to 1,500 per animal"}


def sn_resolution(root: Path, variant=None, gene=None) -> dict:
    d = pd.read_csv(root / "markers" / "resolution_diagnostics.csv")
    return {"kind": "xy", "x": _f(d.resolution), "y": _f(d.n_clusters), "ids": [f"res {r}" for r in d.resolution],
            "xLabel": "Leiden resolution", "yLabel": "clusters", "line": True}


def sn_annotation(root: Path, variant=None, gene=None) -> dict:
    d = pd.read_csv(root / "annotation" / "broad_cluster_annotation_probabilities.csv")
    types = [c for c in d.columns if c not in ("cluster", "candidate_1", "probability_1", "candidate_2",
                                               "probability_2", "margin", "auto_label", "final_label")]
    rows = [f"{c} · {lab}" for c, lab in zip(d.cluster, d.final_label)]
    return {"kind": "heatmap", "rows": rows, "cols": types, "z": [_f(r) for r in d[types].to_numpy()],
            "scale": "sequential", "label": "relative score (not calibrated)", "annotate": True}


def sn_composition(root: Path, variant=None, gene=None) -> dict:
    d = pd.read_csv(root / "composition" / "broad_composition_by_animal.csv")
    return {"kind": "groups", "mode": "bars", "groupOrder": ["VEH", "THC"],
            "metrics": {"fraction": {"label": "fraction of nuclei", "x": _s(d.cell_type_broad), "group": _s(d.group),
                                     "value": _f(d.fraction), "id": _s(d["sample"])},
                        "n_nuclei": {"label": "nuclei", "x": _s(d.cell_type_broad), "group": _s(d.group),
                                     "value": _f(d.n_nuclei), "id": _s(d["sample"])}}}


def sn_comp_stats(root: Path, variant=None, gene=None) -> dict:
    d = pd.read_csv(root / "composition" / "composition_animal_inference.csv")
    return {"kind": "effects", "labels": _s(d.cell_type_broad), "est": _f(d.THC_minus_VEH),
            "lo": _f(d.bootstrap_CI_low), "hi": _f(d.bootstrap_CI_high), "p": _f(d.exact_permutation_p),
            "padj": _f(d.permutation_FDR_BH), "xLabel": "THC − VEH, fraction of nuclei",
            "note": "4 vs 4 animals: 70 possible labellings, so the smallest attainable p is 2/70 ≈ 0.029"}


def _sn_de_files(root: Path) -> list[Path]:
    return sorted((root / "de").glob("DE_*_THC_vs_VEH.csv"))


def sn_de(root: Path, variant=None, gene=None) -> dict:
    files = _sn_de_files(root)
    f = next((p for p in files if _ct(p) == variant), files[0])
    d = pd.read_csv(f)
    return {"kind": "de", "genes": _s(d.gene), "ids": _s(d.gene), "baseMean": _f(d.baseMean),
            "lfc": _f(d.log2FoldChange), "lfcShrunk": None, "p": _f(d.pvalue), "padj": _f(d.padj),
            "test": "THC", "ref": "VEH", "defaults": {"fdr": 0.05, "lfc": 0.5}, "subtitle": _ct(f)}


def _ct(p: Path) -> str:
    return re.sub(r"^DE_|_THC_vs_VEH$", "", p.stem)


def sn_gene(root: Path, variant=None, gene=None) -> dict:
    pb = pd.read_csv(root / "pseudobulk" / "pseudobulk_counts.csv", index_col=0)
    meta = pd.read_csv(root / "pseudobulk" / "pseudobulk_metadata.csv", index_col=0)
    gene = gene if gene in pb.columns else pb.columns[0]
    cpm = pb[gene] / pb.sum(axis=1) * 1e6
    ct = variant or meta.cell_type_broad.iloc[0]
    m = meta[meta.cell_type_broad == ct]
    return {"kind": "gene", "gene": gene, "id": gene, "samples": _s(m["sample"]), "group": _s(m.group),
            "value": _f(np.log2(cpm.reindex(m.index) + 1)), "yLabel": f"log2(CPM+1) · {ct} pseudobulk", "stats": None,
            "variants": sorted(meta.cell_type_broad.astype(str).unique())}


def _sn_enrich_files(root: Path) -> list[Path]:
    return [p for p in (root / "pathways" / "GSEA_all_cell_types.csv", root / "pathways" / "GO_all_cell_types.csv") if p.exists()]


def sn_pathways(root: Path, variant=None, gene=None) -> dict:
    files = _sn_enrich_files(root)
    f = next((p for p in files if p.stem == variant), files[0])
    d = pd.read_csv(f)
    if "NES" in d:
        return {"kind": "enrichment", "terms": _s(d.Term), "score": _f(d.NES), "padj": _f(d["FDR q-val"]),
                "size": _f(d["Tag %"].astype(str).str.split("/").str[1].astype(float)), "set": _s(d.cell_type_broad),
                "scoreLabel": "NES", "defaults": {"fdr": 0.25, "top": 15}}
    k = d.Overlap.astype(str).str.split("/")
    return {"kind": "enrichment", "terms": _s(d.Term), "score": _f(k.str[0].astype(float) / k.str[1].astype(float)),
            "padj": _f(d["Adjusted P-value"]), "size": _f(k.str[0].astype(float)),
            "set": _s(d.cell_type_broad + " · " + d.direction), "scoreLabel": "gene ratio",
            "defaults": {"fdr": 0.05, "top": 15}, "oneSided": True}


KARYON = [
    Noun("nuclei", "Nuclei", "CircleDot", "run S02 QC", ["qc", "logs"], [
        Figure("qc", "Nucleus QC", "groups", _glob("qc/*_nucleus_qc.csv"), sn_qc)]),
    Noun("clusters", "Clusters", "Shapes", "run S03",
         ["embeddings", "markers"], [
        Figure("umap", "UMAP", "embedding", lambda r: [p] if (p := _h5ad(r)) else [],
               lambda root, variant=None, gene=None: sn_embedding(root, color="cluster_broad")),
        Figure("resolution", "Leiden resolution sweep", "xy", _one("markers", "resolution_diagnostics.csv"), sn_resolution),
        Figure("markers", "Cluster markers", "dotplot", _one("markers", "all_fine_cluster_markers.csv"), sn_dotplot,
               note="size = fraction expressing · colour = mean log2FC")]),
    Noun("celltypes", "Cell types", "Tags", "run S04", ["annotation"], [
        Figure("annotation", "Annotation confidence", "heatmap",
               _one("annotation", "broad_cluster_annotation_probabilities.csv"), sn_annotation),
        Figure("umap_types", "UMAP by cell type", "embedding",
               lambda r: [p] if (p := _h5ad(r)) and not p.name.startswith("02_") else [],
               lambda root, variant=None, gene=None: sn_embedding(root, color="cell_type_broad"))]),
    Noun("composition", "Composition", "PieChart", "run S05", ["composition"], [
        Figure("fractions", "Fractions per animal", "groups", _one("composition", "broad_composition_by_animal.csv"), sn_composition),
        Figure("comp_stats", "THC − VEH by cell type", "effects", _one("composition", "composition_animal_inference.csv"), sn_comp_stats)]),
    Noun("de", "Pseudobulk DE", "Dna", "run S06 and S07", ["pseudobulk", "de"], [
        Figure("de", "Differential expression", "de", _sn_de_files, sn_de,
               variants=lambda r: [_ct(p) for p in _sn_de_files(r)]),
        Figure("gene", "Gene", "gene", _one("pseudobulk", "pseudobulk_counts.csv"), sn_gene,
               variants=lambda r: sorted(pd.read_csv(r / "pseudobulk" / "pseudobulk_metadata.csv").cell_type_broad.astype(str).unique())
               if (r / "pseudobulk" / "pseudobulk_metadata.csv").exists() else [])]),
    Noun("pathways", "Pathways", "Network", "run S08 (needs internet)", ["pathways"], [
        Figure("enrich", "GSEA / GO", "enrichment", _sn_enrich_files, sn_pathways,
               variants=lambda r: [p.stem for p in _sn_enrich_files(r)])]),
    Noun("report", "Report", "FileText", "run S10", ["reports"], []),
]

NOUNS = {"bulk": PLETHOS, "snrna": KARYON}


def _pretty(x: str) -> str:
    x = re.sub(r"^(GOBP|GOCC|GOMF|HALLMARK|REACTOME|WP|KEGG)_", "", str(x)).replace("_", " ").lower()
    return x[:1].upper() + x[1:]


# ------------------------------------------------------------------ api helpers

_STATIC = {".png", ".svg"}
_TABLES = {".csv", ".tsv", ".txt", ".md", ".json"}
_DOWNLOADS = {".xlsx", ".h5ad", ".pdf", ".ipynb", ".pkl", ".rds"}


def catalogue(workflow: str, root: Path, run_dir: Path) -> list[dict]:
    """Every noun with what exists for it in this run: interactive figures,
    static figures, tables. A noun with nothing yet is a ghost."""
    files = [p for p in root.rglob("*") if p.is_file() and "scripts" not in p.relative_to(root).parts[:1]] if root.exists() else []
    out = []
    for n in NOUNS[workflow]:
        mine = [p for p in files if p.relative_to(root).parts[0] in n.dirs]
        rel = lambda p: str(p.relative_to(run_dir))  # noqa: E731
        figs = []
        for f in n.figures:
            try:
                if f.files(root):
                    figs.append({"id": f.id, "title": f.title, "kind": f.kind, "note": f.note,
                                 "variants": f.variants(root) if f.variants else []})
            except Exception:
                continue
        # PNG/SVG from the engine or notebook are originals, never figure-strip
        # content: every noun in this catalogue has live specs instead.
        downloads = [{"path": rel(p), "bytes": p.stat().st_size}
                     for p in mine if p.suffix in _DOWNLOADS or p.suffix in _STATIC]
        downloads.sort(key=lambda d: d["path"])
        out.append({"id": n.id, "label": n.label, "icon": n.icon, "hint": n.hint,
                    "figures": figs, "static": [],
                    "tables": [{"path": rel(p), "bytes": p.stat().st_size} for p in mine if p.suffix in _TABLES],
                    "downloads": downloads})
    return out


def spec(workflow: str, root: Path, noun: str, fig: str, variant: str | None, gene: str | None,
         cache_dir: Path) -> dict:
    n = next((x for x in NOUNS[workflow] if x.id == noun), None)
    f = next((x for x in (n.figures if n else []) if x.id == fig), None)
    if not f or not f.files(root):
        raise KeyError(f"{noun}/{fig}")
    src = f.files(root)
    stamp = max(p.stat().st_mtime for p in src)
    key = re.sub(r"[^\w.-]", "_", f"{noun}-{fig}-{variant}-{gene}")
    cp = cache_dir / f"{key}.json"
    if cp.exists() and cp.stat().st_mtime >= stamp:
        return json.loads(cp.read_text())
    s = f.build(root, variant=variant, gene=gene)
    s.update(id=f.id, title=f.title, noun=noun, variant=variant)
    if f.variants and "variants" not in s:
        s["variants"] = f.variants(root)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cp.write_text(json.dumps(s, separators=(",", ":")))
    return s
