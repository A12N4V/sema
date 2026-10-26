"""normalize – DESeq2 size factors, the fit, and the VST transform.

Replaces the normalisation part of `workflows/bulk-r/03_DESeq2_normalization.R`
(`DESeqDataSet`, `DESeq`, `sizeFactors`, `vst(dds, blind = TRUE)`). The
computation itself is PyDESeq2 (the maintained DESeq2 port); this module wraps
it into pure functions that take frames and return frames.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from pydeseq2.dds import DeseqDataSet


def make_design(meta: pd.DataFrame, group_col: str = "group", covars: list[str] | None = None) -> tuple[str, list[str]]:
    """The design formula string and the covariates actually used.

    Replaces the design assembly in 03_DESeq2_normalization.R. A covariate is
    used only if it is complete (no NaN) and has more than one level – the
    same rule the R port applies before building `~ covars + group`.
    """
    covars = [c for c in (covars or [])
              if c in meta and not meta[c].isna().any() and meta[c].nunique() > 1]
    design = "~" + " + ".join([*covars, group_col])
    return design, covars


def fit(counts_filt: pd.DataFrame, meta: pd.DataFrame, design: str, group_col: str = "group",
        group_ref: str = "V", n_cpus: int = 4, refit_cooks: bool = True) -> DeseqDataSet:
    """Fit DESeq2 (size factors, dispersions, Wald model matrices).

    Replaces `DESeqDataSet(...) %>% DESeq()` in 03_DESeq2_normalization.R.
    PyDESeq2 expects samples × genes (the transpose of the pipeline's frames).
    """
    dds = DeseqDataSet(counts=counts_filt.T, metadata=meta, design=design,
                       ref_level=[group_col, group_ref], refit_cooks=refit_cooks,
                       n_cpus=n_cpus, quiet=True)
    dds.deseq2()
    return dds


def normalized_counts(dds: DeseqDataSet) -> pd.DataFrame:
    """Size-factor-normalised counts, genes × samples. R: `counts(dds, normalized = TRUE)`."""
    return pd.DataFrame(dds.layers["normed_counts"], index=dds.obs_names, columns=dds.var_names).T


def size_factors(dds: DeseqDataSet) -> pd.DataFrame:
    """Median-of-ratios size factors per sample (R: `sizeFactors(dds)`)."""
    return pd.DataFrame({"sample": dds.obs_names, "size_factor": dds.obs["size_factors"].values})


def vst(dds: DeseqDataSet) -> pd.DataFrame:
    """Variance-stabilising transform, blind (design ignored), genes × samples.

    Replaces `vst(dds, blind = TRUE)` in 03_DESeq2_normalization.R. PyDESeq2's
    `vst(use_design=False)` is the same blind transform; the values match the R
    output to the transform's own numerical tolerance.
    """
    dds.vst(use_design=False)
    return pd.DataFrame(dds.layers["vst_counts"], index=dds.obs_names, columns=dds.var_names).T


def dispersion_table(dds: DeseqDataSet) -> pd.DataFrame:
    """Per-gene dispersion estimates for the live dispersion plot (replaces
    the dispersion_estimates.png data): mean of normalised counts, gene-wise,
    fitted and final dispersions. R: `plotDispEsts` internals."""
    mean = dds.var.get("_normed_means")
    if mean is None:
        mean = pd.DataFrame(dds.layers["normed_counts"], index=dds.obs_names,
                            columns=dds.var_names).mean(axis=0)
    return pd.DataFrame({
        "gene_id": dds.var_names,
        "mean_normed": np.asarray(mean),
        "genewise": np.asarray(dds.var["genewise_dispersions"]),
        "fitted": np.asarray(dds.var["fitted_dispersions"]),
        "final": np.asarray(dds.var["dispersions"]),
    })
