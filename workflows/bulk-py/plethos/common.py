"""Shared numeric helpers for the plethos package. Port of the corresponding
helpers in `workflows/bulk-r/utils.R` (row_z ≈ the scale(row) calls, bh ≈
p.adjust(method = "BH"), pretty_pw ≈ the pathway-label cleanup in the R
enrichment scripts)."""
from __future__ import annotations

import re

import numpy as np
import pandas as pd
from scipy.stats import false_discovery_control


def row_z(m: pd.DataFrame) -> pd.DataFrame:
    """Row-wise z-scores (R: `t(scale(t(m)))` in the heatmap scripts). NaN-safe:
    zero-variance rows stay NaN instead of raising, unlike scale()."""
    sd = m.std(axis=1, ddof=1)
    z = m.sub(m.mean(axis=1), axis=0).div(sd.replace(0, np.nan), axis=0)
    return z.replace([np.inf, -np.inf], np.nan)


def clean_rows(m: pd.DataFrame) -> pd.DataFrame:
    """Drop rows with fewer than 2 finite values or zero variance (R: the
    `keep <- apply(m, 1, ...)` guards before pheatmap)."""
    ok = m.apply(lambda r: r[np.isfinite(r)].size >= 2 and np.nanstd(r, ddof=1) > 1e-9, axis=1)
    return m.loc[ok]


def bh(p) -> np.ndarray:
    """Benjamini–Hochberg FDR over finite values. R: `p.adjust(p, "BH")`.
    Differs: NaN inputs stay NaN instead of failing; the correction runs on
    the finite subset, so a NaN does not shift the other p-values' ranks."""
    p = np.asarray(p, float)
    out = np.full_like(p, np.nan)
    ok = np.isfinite(p)
    if ok.any():
        out[ok] = false_discovery_control(p[ok], method="bh")
    return out


def pretty_pw(x: str) -> str:
    """Humanise a pathway name from the MSigDB/Enrichr prefixes (the R scripts'
    `pretty_pw` used before ggplot labels)."""
    x = re.sub(r"^(GOBP|GOCC|GOMF|HALLMARK|REACTOME|WP|KEGG)_", "", str(x))
    x = x.replace("_", " ").lower()
    for a, b in [(r"\bgaba\b", "GABA"), (r"\bnmda\b", "NMDA"), (r"\bampa\b", "AMPA"),
                 (r"\bltp\b", "LTP"), (r"\btnf\b", "TNF")]:
        x = re.sub(a, b, x)
    x = re.sub(r"\bil(\d+)\b", r"IL-\1", x)
    return x[:1].upper() + x[1:]
