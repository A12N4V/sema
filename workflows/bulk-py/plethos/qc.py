"""qc – raw-count QC metrics and the expression filter.

Replaces `workflows/bulk-r/02_QC_filtering.R` (the data.frame of per-sample
metrics and the `keep <- rowSums(counts >= x) >= n*p` filter). Differs from R:
the density/boxplot rendering is gone; the per-sample quantile table the live
boxplot needs is written instead.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def qc_per_sample(counts: pd.DataFrame, group: pd.Series) -> pd.DataFrame:
    """Per-sample QC metrics: library size, genes detected, % zeros, median
    non-zero count, and log10-count quantiles (0/10/25/50/75/90/100%) so the
    raw-count boxplot can be drawn without the count matrix.

    Replaces the `qc` data.frame in 02_QC_filtering.R; the quantile columns are
    new (they back the live QC boxplot that replaced QC_raw_count_boxplot.png).
    """
    ord_ = list(counts.columns)
    g = group.reindex(ord_).astype(str)
    lg = np.log10(counts + 1)
    q = lg.quantile([0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0], axis=0)
    d = pd.DataFrame({
        "sample": ord_,
        "group": g.values,
        "library_size": counts.sum().values,
        "genes_detected": (counts > 0).sum().values,
        "pct_zero": 100 * (counts == 0).mean().values,
        "median_nonzero": [float(np.median(counts[s][counts[s] > 0])) for s in ord_],
        "log10_count_q0": q.loc[0.0].values,
        "log10_count_q10": q.loc[0.1].values,
        "log10_count_q25": q.loc[0.25].values,
        "log10_count_q50": q.loc[0.5].values,
        "log10_count_q75": q.loc[0.75].values,
        "log10_count_q90": q.loc[0.9].values,
        "log10_count_q100": q.loc[1.0].values,
    })
    return d


def filter_genes(counts: pd.DataFrame, min_count: int = 10, min_frac: float = 0.5,
                 protein_coding_only: bool = False, biotype: pd.Series | None = None) -> pd.DataFrame:
    """Keep genes with >= min_count counts in >= min_frac of samples.

    Replaces the expression filter in 02_QC_filtering.R
    (`rowSums(counts >= FILTER_MIN) >= FILTER_FRAC * ncol`, plus the optional
    protein_coding restriction). Returns the rounded integer matrix.
    """
    keep = (counts >= min_count).sum(axis=1) >= min_frac * counts.shape[1]
    out = counts.loc[keep].round().astype(int)
    if protein_coding_only and biotype is not None and biotype.notna().any():
        biotype = biotype.reindex(out.index)
        out = out.loc[biotype == "protein_coding"]
    return out
