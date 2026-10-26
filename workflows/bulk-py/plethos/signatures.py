"""signatures – gene-set scoring: mean-of-z, singscore, GSVA, DG identity.

Replaces the scoring parts of `workflows/bulk-r/07_DG_identity_scores.R` and
`10_targeted_signatures.R`:
- mean-of-z: the mean of per-gene z-scores across samples (R: colMeans(scale(t(vst))) per set);
- singscore: `singscore::simpleScore` (Foroutan et al. 2018), ported by hand;
- GSVA: gseapy's implementation of Hänzelmann et al. (R used GSVA::gsva);
- DG identity: the positive-minus-negative composite of the mean-z scores.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .common import bh, row_z


def mean_z_scores(vst: pd.DataFrame, symbols: pd.Series,
                  gene_sets: dict[str, list[str]]) -> pd.DataFrame:
    """Mean of per-gene z-scores per signature, per sample.

    Replaces the mean-of-z block in 07_DG_identity_scores.R (and the axis
    scoring in 10_targeted_signatures.R). Signatures with fewer than 2 mapped
    genes score NaN (same guard as sig_score_meanz in the port).
    """
    z = row_z(vst)
    sym = symbols.reindex(vst.index).astype(str)
    out = {}
    for k, genes in gene_sets.items():
        g = {s.lower() for s in genes}
        idx = sym.str.lower().isin(g).to_numpy()
        out[k] = z.loc[idx].mean(axis=0, skipna=True) if idx.sum() >= 2 else pd.Series(np.nan, index=vst.columns)
    return pd.DataFrame(out, index=vst.columns)


def map_gene_sets(vst: pd.DataFrame, symbols: pd.Series,
                  gene_sets: dict[str, list[str]], min_size: int = 2) -> dict[str, list[str]]:
    """Map signature symbols to count-matrix indices (case-insensitive), keeping
    sets with at least min_size matched genes. Port of the gset construction in
    07_DG_identity_scores.R / 09_GSEA.R."""
    sym = symbols.reindex(vst.index).astype(str).str.lower()
    lower = {k: {s.lower() for s in v} for k, v in gene_sets.items()}
    return {k: list(vst.index[sym.isin(g)]) for k, g in lower.items()
            if len(set(vst.index[sym.isin(g)])) >= min_size}


def singscore(vst: pd.DataFrame, mapped_sets: dict[str, list[str]]) -> pd.DataFrame:
    """singscore's simpleScore, ported by hand (Foroutan et al. 2018).

    Replaces the singscore block of 07_DG_identity_scores.R. Ranks per sample
    (average method), then scores each signature as the median-centred rank
    mean normalised to (-0.5, 0.5) – identical algebra to the R port's
    `(mean_rank - lo) / (hi - lo) - 0.5`.
    """
    rk = vst.rank(axis=0, method="average")
    n = len(vst)
    out = {}
    for k, ids in mapped_sets.items():
        m = len(ids)
        lo, hi = (m + 1) / 2, (2 * n - m + 1) / 2
        out[k] = (rk.loc[ids].mean(axis=0) - lo) / (hi - lo) - 0.5
    return pd.DataFrame(out, index=vst.columns)


def gsva(vst: pd.DataFrame, mapped_sets: dict[str, list[str]], seed: int = 1234) -> pd.DataFrame:
    """GSVA enrichment scores. Replaces `GSVA::gsva` in 07_DG_identity_scores.R
    via gseapy's implementation (same Hänzelmann algorithm; parameter defaults
    differ slightly from the R GSVA package)."""
    import gseapy as gp
    es = gp.gsva(data=vst, gene_sets=mapped_sets, outdir=None, min_size=2,
                 seed=seed, verbose=False).res2d
    gv = es.pivot(index="Name", columns="Term", values="ES").astype(float)
    return gv.reindex(vst.columns)


def dg_identity(score_z: pd.DataFrame, dg_positive: list[str], contaminants: list[str]) -> pd.DataFrame:
    """DG identity / enrichment score per sample: mean of the DG-positive
    signature scores minus the mean contaminant scores.

    Replaces the dgid block of 07_DG_identity_scores.R (same signature lists,
    same composite). NOT a purity measure – the R script's own caveat, kept.
    """
    ord_ = list(score_z.index)
    pos = score_z[[c for c in dg_positive if c in score_z]].mean(axis=1, skipna=True)
    neg = score_z[[c for c in contaminants if c in score_z]].mean(axis=1, skipna=True)
    return pd.DataFrame({"sample": ord_, "DG_identity_score": (pos - neg).values,
                         "DG_positive": pos.values, "contaminant": neg.values})


def group_comparison(scores: pd.DataFrame, group: pd.Series, group_ref: str = "V",
                     group_test: str = "T", label: str = "signature") -> pd.DataFrame:
    """Per-score group comparison: group means, delta, effect size and test.

    Replaces the wilcox comparison blocks of 07_DG_identity_scores.R (cohens_d
    added when the caller asks for it, as 10 does). Mann–Whitney U two-sided;
    BH-adjusted over the score rows. Differs from R's wilcox.test: exact method
    below n=20 pairs (same as the R port's choice)."""
    from scipy.stats import mannwhitneyu
    g = group.reindex(scores.index).astype(str)
    rows = []
    for c in scores.columns:
        x = scores.loc[g.values == group_ref, c].dropna()
        y = scores.loc[g.values == group_test, c].dropna()
        if len(x) < 2 or len(y) < 2:
            p = np.nan
        else:
            p = float(mannwhitneyu(y, x, alternative="two-sided",
                                   method="exact" if len(x) + len(y) < 20 else "auto").pvalue)
        rows.append({label: c, "mean_V": x.mean(), "mean_T": y.mean(),
                     "delta_T_minus_V": y.mean() - x.mean(), "wilcox_p": p})
    out = pd.DataFrame(rows)
    out["wilcox_padj"] = bh(out.wilcox_p)
    return out


def axis_gene_tables(vst: pd.DataFrame, symbols: pd.Series, axes_table: pd.DataFrame,
                     res: pd.DataFrame) -> pd.DataFrame:
    """Per-axis gene tables with DE statistics merged (one frame, axis column).

    Replaces the per-axis gene table of 10_targeted_signatures.R: for each axis
    with >= 3 detected genes, every member gene's DE row (symbol, baseMean,
    log2FC_MLE, log2FC_apeglm, pvalue, padj, direction_FDR) plus its subaxis
    label. Axes with fewer than 3 detected genes are skipped (same rule).
    """
    sym = symbols.reindex(vst.index).astype(str)
    res_i = res.set_index("gene_id")
    out = []
    for axis, a in axes_table.groupby("axis"):
        g = {s.lower() for s in a.gene}
        ids = list(vst.index[sym.str.lower().isin(g)])
        if len(ids) < 3:
            continue
        cols = [c for c in ["symbol", "baseMean", "log2FC_MLE", "log2FC_apeglm", "pvalue", "padj", "direction_FDR"]
                if c in res_i.columns]
        tab = res_i.reindex(ids)[cols].reset_index()
        tab["axis"] = axis
        sub = dict(zip(a.gene.str.lower(), a.subaxis))
        tab["subaxis"] = [sub.get(s.lower()) for s in sym.loc[ids]]
        out.append(tab)
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()
