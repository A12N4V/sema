"""pca – PCA on VST, sample correlation and distance matrices, outlier
diagnostics.

Replaces `workflows/bulk-r/04_PCA_clustering.R` (prcomp on the top-500
most-variable genes, `cor()`, `dist()`, the Cook's-distance outlier table).
Differs from R: the SVD is centred like `prcomp(center = TRUE, scale. = FALSE)`
but computed with numpy instead of R's LAPACK defaults, so PC signs may flip
(variance explained, distances and correlations do not).
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def pca(vst: pd.DataFrame, group: pd.Series, n_genes: int = 500, n_components: int = 3) -> dict:
    """PCA on the top-n most variable genes of the VST matrix.

    Replaces `prcomp(t(vst[top500]))` in 04_PCA_clustering.R. Returns a dict
    with `d` (sample, group, PC1..PCn), `ve` (variance explained per PC) and
    `ngenes`. PC signs are arbitrary (same caveat as prcomp itself).
    """
    ord_ = list(vst.columns)
    rv = vst.var(axis=1, ddof=1)
    sel = rv.sort_values(ascending=False).index[:min(n_genes, len(rv))]
    X = vst.loc[sel].T.to_numpy()
    X = X - X.mean(axis=0)
    U, S, _ = np.linalg.svd(X, full_matrices=False)
    scores = U * S
    ve = 100 * S**2 / np.sum(S**2)
    k = min(n_components, scores.shape[1])
    d = pd.DataFrame(scores[:, :k], columns=[f"PC{i + 1}" for i in range(k)], index=ord_)
    d.insert(0, "group", group.reindex(ord_).astype(str).values)
    d.insert(0, "sample", ord_)
    return {"d": d, "ve": ve, "ngenes": len(sel)}


def correlation_matrix(vst: pd.DataFrame) -> pd.DataFrame:
    """Pearson correlation between samples. R: `cor(vst)` (04_PCA_clustering.R)."""
    return vst.corr(method="pearson")


def distance_matrix(vst: pd.DataFrame) -> pd.DataFrame:
    """Euclidean distance between samples. R: `dist(t(vst))` mapped to a matrix."""
    from scipy.spatial.distance import pdist, squareform
    D = squareform(pdist(vst.T.to_numpy()))
    return pd.DataFrame(D, index=vst.columns, columns=vst.columns)


def outlier_diagnostics(corr: pd.DataFrame, cooks: np.ndarray | None = None,
                        group: pd.Series | None = None) -> pd.DataFrame:
    """Per-sample outlier metrics: median correlation with the other samples,
    its MAD-z score, the max Cook's distance, and a review flag at MAD-z < -3.5.

    Replaces the outlier block of 04_PCA_clustering.R (the same 0.6745 MAD-z
    formula, and the same -3.5 cut used where R writes the flag). Cook's
    distances come from the DESeq2 fit (dds.layers["cooks"]).
    """
    ord_ = list(corr.columns)
    Cn = corr.to_numpy(float).copy()
    np.fill_diagonal(Cn, np.nan)
    med = np.nanmedian(Cn, axis=1)
    madz = 0.6745 * (med - np.median(med)) / (np.median(np.abs(med - np.median(med))) + 1e-9)
    max_cook = np.nanmax(cooks, axis=1) if cooks is not None else np.full(len(ord_), np.nan)
    d = pd.DataFrame({"sample": ord_, "median_corr": med, "corr_modified_z": madz,
                      "max_cooks": max_cook, "flag_corr": np.where(madz < -3.5, "review", "")})
    if group is not None:
        d.insert(1, "group", group.reindex(ord_).astype(str).values)
    return d


def covariate_pc_association(meta: pd.DataFrame, pc: pd.DataFrame, covars: list[str]) -> pd.DataFrame:
    """Pearson r of each (numeric-coded) covariate against PC1/PC2. Replaces the
    covariate scan at the end of 04_PCA_clustering.R."""
    rows = []
    for cv in covars:
        val = pd.Categorical(meta.loc[pc["sample"], cv]).codes.astype(float)
        rows.append({"covariate": cv, "cor_PC1": np.corrcoef(val, pc["PC1"])[0, 1],
                     "cor_PC2": np.corrcoef(val, pc["PC2"])[0, 1]})
    return pd.DataFrame(rows)
