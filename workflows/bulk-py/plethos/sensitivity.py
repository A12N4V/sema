"""sensitivity – does the answer survive removing a sample?

Replaces the sensitivity refit of `workflows/bulk-r/13_export_tables_report.R`
(the reduced DESeq2 fit and its comparison against the full fit) and is the
pure function L1 wraps in a background job for live "refit without these
samples". Frames in, frames out – no pipeline globals, so a job can call it
with any counts/metadata pair.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from pydeseq2.ds import DeseqStats

from .normalize import fit, make_design


def refit_without(counts_filt: pd.DataFrame, meta: pd.DataFrame, exclude: list[str],
                  group_col: str = "group", group_ref: str = "V", group_test: str = "T",
                  n_cpus: int = 4) -> pd.DataFrame:
    """Refit DESeq2 with samples excluded; returns the MLE results frame.

    Replaces the reduced `DESeqDataSet(...) %>% DESeq() %>% results()` of
    13_export_tables_report.R. The same design rule applies (complete
    covariates only). Returns gene_id, baseMean, log2FC_MLE, lfcSE_MLE,
    stat_Wald, pvalue, padj – the caller merges against the full fit.
    """
    keep = [c for c in counts_filt.columns if c not in set(exclude)]
    if not keep:
        raise ValueError("refit_without: excluding every sample leaves nothing to fit.")
    m2 = meta.loc[keep]
    design, _ = make_design(m2, group_col)
    d2 = fit(counts_filt[keep], m2, design, group_col, group_ref, n_cpus)
    st = DeseqStats(d2, contrast=[group_col, group_test, group_ref], quiet=True, n_cpus=n_cpus)
    st.summary()
    r2 = st.results_df
    return pd.DataFrame({"gene_id": r2.index, "baseMean": r2.baseMean.values,
                         "log2FC_MLE": r2.log2FoldChange.values, "lfcSE_MLE": r2.lfcSE.values,
                         "stat_Wald": r2.stat.values, "pvalue": r2.pvalue.values,
                         "padj": r2.padj.values}).reset_index(drop=True)


def compare_refits(res_full: pd.DataFrame, res_sens: pd.DataFrame,
                   fdr: float = 0.05, lfc_min: float = 0.3) -> tuple[pd.DataFrame, float, int, int]:
    """Merge full and reduced fits per gene.

    Returns (merged table with lfc_full/padj_full/lfc_sens/padj_sens, LFC
    Pearson correlation over genes tested in both, n FDR DEGs full, n FDR DEGs
    reduced). Replaces the comparison block of 13_export_tables_report.R
    (`cor(lfc_full, lfc_sens)`, the two DEG counts)."""
    merged = pd.DataFrame({"gene_id": res_full.gene_id, "lfc_full": res_full.log2FC_MLE,
                           "padj_full": res_full.padj}).merge(
        pd.DataFrame({"gene_id": res_sens.gene_id, "lfc_sens": res_sens.log2FC_MLE,
                      "padj_sens": res_sens.padj}), on="gene_id")
    ok = merged[["lfc_full", "lfc_sens"]].dropna()
    lfc_cor = float(np.corrcoef(ok.lfc_full, ok.lfc_sens)[0, 1]) if len(ok) > 2 else np.nan
    n_full = int((res_full.padj < fdr).sum())
    n_sens = int(((res_sens.padj < fdr) & (res_sens.log2FC_MLE.abs() >= lfc_min)).sum())
    return merged, lfc_cor, n_full, n_sens
