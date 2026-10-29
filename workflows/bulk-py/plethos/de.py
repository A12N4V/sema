"""de – differential expression: Wald test, apeglm-type shrinkage, thresholds.

Replaces the DE parts of `workflows/bulk-r/05_differential_expression.R`:
`DESeq2::results` (MLE LFC + Wald test), `DESeq2::lfcShrink(apeglm)` (PyDESeq2's
lfc_shrink is its apeglm implementation), and the threshold logic. Differs from
R: both the MLE and shrunken LFC are kept side by side in one table (R writes
separate objects), and the primary/exploratory flags are explicit columns the
live re-thresholding can reuse.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from pydeseq2.ds import DeseqStats


def results(dds: DeseqDataSet, group_col: str = "group", group_test: str = "T",
            group_ref: str = "V", alpha: float = 0.05, shrink: bool = True,
            n_cpus: int = 4) -> pd.DataFrame:
    """Wald test results with both MLE and shrunken log2FC, one row per gene.

    Replaces `DESeq2::results(dds, contrast=...)` plus
    `DESeq2::lfcShrink(dds, coef=..., type="apeglm")` in 05_differential_expression.R.
    Columns: gene_id, baseMean, log2FC_MLE, lfcSE_MLE, stat_Wald, pvalue, padj
    (MLE, as in R's results()), log2FC_apeglm, lfcSE_apeglm (shrunk, ranking
    and visualisation only, as in the R port). padj NA stays NA – independent
    filtering and Cook's outliers are legitimate "not tested", never imputed.
    """
    st = DeseqStats(dds, contrast=[group_col, group_test, group_ref], alpha=alpha,
                    n_cpus=n_cpus, quiet=True)
    st.summary()
    mle = st.results_df.copy()
    shr = None
    if shrink:
        coef = next(c for c in dds.varm["LFC"].columns if group_col in c and group_test in c)
        st.lfc_shrink(coeff=coef)
        shr = st.results_df
    res = pd.DataFrame({
        "gene_id": mle.index,
        "baseMean": mle.baseMean.values,
        "log2FC_MLE": mle.log2FoldChange.values,
        "lfcSE_MLE": mle.lfcSE.values,
        "stat_Wald": mle.stat.values,
        "pvalue": mle.pvalue.values,
        "padj": mle.padj.values,
    })
    if shr is not None:
        res["log2FC_apeglm"] = shr.log2FoldChange.values
        res["lfcSE_apeglm"] = shr.lfcSE.values
    return res.reset_index(drop=True)


def threshold(res: pd.DataFrame, fdr: float = 0.05, lfc_min: float = 0.3,
              p_nominal: float = 0.05, merge_symbols: bool = True,
              annot: pd.DataFrame | None = None) -> pd.DataFrame:
    """Apply the primary and exploratory criteria to a results table.

    Replaces the threshold block of 05_differential_expression.R: primary is
    padj < fdr AND |log2FC_MLE| >= lfc_min; exploratory is pvalue < p_nominal
    AND |log2FC_MLE| >= lfc_min. Adds sig_FDR/sig_exploratory/direction_* and
    sorts by padj then pvalue (na last), exactly as the R port writes the
    complete table. Optionally attaches symbols from the annotation frame.
    """
    res = res.copy()
    if merge_symbols and annot is not None and "symbol" not in res.columns:
        res.insert(1, "symbol", annot.loc[res.gene_id, "symbol"].values)
    sig_fdr = res.padj.notna() & (res.padj < fdr) & (res.log2FC_MLE.abs() >= lfc_min)
    sig_expl = res.pvalue.notna() & (res.pvalue < p_nominal) & (res.log2FC_MLE.abs() >= lfc_min)
    res["sig_FDR"] = sig_fdr
    res["sig_exploratory"] = sig_expl
    res["direction_FDR"] = np.where(sig_fdr & (res.log2FC_MLE > 0), "up_in_T",
                                    np.where(sig_fdr & (res.log2FC_MLE < 0), "down_in_T", "ns"))
    res["direction_expl"] = np.where(sig_expl & (res.log2FC_MLE > 0), "up_in_T",
                                     np.where(sig_expl & (res.log2FC_MLE < 0), "down_in_T", "ns"))
    res = res.sort_values(["padj", "pvalue"], na_position="last").reset_index(drop=True)
    return res


def summary_counts(res: pd.DataFrame, fdr: float = 0.05, lfc_min: float = 0.3,
                   p_nominal: float = 0.05) -> pd.DataFrame:
    """The DE_summary table: tested/passed counts plus the thresholds used.
    Replaces the `summ` data.frame in 05_differential_expression.R."""
    sig_fdr, sig_expl = res.sig_FDR, res.sig_exploratory
    return pd.DataFrame({
        "metric": ["genes_tested", "genes_with_padj", "FDR_significant", "FDR_up_in_T", "FDR_down_in_T",
                   "exploratory_significant", "exploratory_up_in_T", "exploratory_down_in_T",
                   "FDR_threshold", "LFC_threshold", "nominal_p_threshold"],
        "value": [len(res), int(res.padj.notna().sum()), int(sig_fdr.sum()),
                  int((res.direction_FDR == "up_in_T").sum()), int((res.direction_FDR == "down_in_T").sum()),
                  int(sig_expl.sum()), int((res.direction_expl == "up_in_T").sum()),
                  int((res.direction_expl == "down_in_T").sum()), fdr, lfc_min, p_nominal],
    })


def subset_tables(res: pd.DataFrame, fdr: float = 0.05, lfc_min: float = 0.3,
                  p_nominal: float = 0.05) -> dict[str, pd.DataFrame]:
    """The significant-table set written by 05 (FDR up/down, exploratory up/down,
    both). Returns named frames; the script saves each under its own path."""
    fdr_hit = res.padj.notna() & (res.padj < fdr) & (res.log2FC_MLE.abs() >= lfc_min)
    expl_hit = res.pvalue.notna() & (res.pvalue < p_nominal) & (res.log2FC_MLE.abs() >= lfc_min)
    return {
        "DE_significant_FDR": res[fdr_hit],
        "DE_significant_FDR_up_in_T": res[fdr_hit & (res.log2FC_MLE > 0)],
        "DE_significant_FDR_down_in_T": res[fdr_hit & (res.log2FC_MLE < 0)],
        "DE_exploratory_pvalue": res[expl_hit],
        "DE_exploratory_pvalue_up_in_T": res[expl_hit & (res.log2FC_MLE > 0)],
        "DE_exploratory_pvalue_down_in_T": res[expl_hit & (res.log2FC_MLE < 0)],
    }


