"""integrate – cross-analysis: score correlations, signature overlaps,
convergent candidates.

Replaces `workflows/bulk-r/11_integrated_analysis.R` (associative language
only, as the R script itself notes). Differs from R: no UpSet plot – the
pairwise overlap table carries the same counts, one gene per row is kept for
the leading-edge/overlap views.
"""
from __future__ import annotations

from itertools import combinations

import numpy as np
import pandas as pd


def score_correlation(score_tables: list[pd.DataFrame]) -> pd.DataFrame:
    """Pearson correlation among all signature/axis scores, samples aligned.

    Replaces the S/Rc block of 11_integrated_analysis.R: concatenates the
    score columns (sample, group dropped), keeps columns with >= 2 finite
    values and non-zero variance, returns the correlation matrix. Empty when
    fewer than two usable columns (the caller skips the view).
    """
    parts = [d.drop(columns=["sample", "group"], errors="ignore").reset_index(drop=True)
             for d in score_tables]
    S = pd.concat(parts, axis=1)
    S = S.loc[:, S.apply(lambda c: c[np.isfinite(c)].size >= 2 and c.std() > 0)]
    if S.shape[1] < 2:
        return pd.DataFrame()
    return S.corr()


def score_pc_correlation(S: pd.DataFrame, pc: pd.DataFrame) -> pd.DataFrame:
    """Correlation of each score with PC1/PC2. Replaces the `cp` frame of
    11_integrated_analysis.R. Returns an empty frame when no score varies."""
    usable = [c for c in S if S[c].std() > 0]
    if not usable:
        return pd.DataFrame()
    return pd.DataFrame({"score": usable,
                         "PC1": [np.corrcoef(S[c], pc["PC1"])[0, 1] for c in usable],
                         "PC2": [np.corrcoef(S[c], pc["PC2"])[0, 1] for c in usable]})


def signature_overlap(setlist: dict[str, set[str]]) -> pd.DataFrame:
    """Pairwise shared-gene counts between signature sets, one row per pair and
    one gene per row in the `gene` column (not semicolon-collapsed in the
    gene-level table; this summary keeps the collapsed list, matching the R
    port's signature_gene_overlap.csv that figures.py may still read).
    Replaces the UpSetR block of 11_integrated_analysis.R."""
    ov = pd.DataFrame([{"set_a": a, "set_b": b, "shared": len(setlist[a] & setlist[b]),
                        "genes": ";".join(sorted(setlist[a] & setlist[b]))}
                       for a, b in combinations(sorted(setlist), 2)])
    return ov[ov.shared > 0].sort_values("shared", ascending=False).reset_index(drop=True)


def convergent_candidates(res: pd.DataFrame, signature_tables: list[pd.DataFrame]) -> pd.DataFrame:
    """DE genes that are also in a literature signature, with the signature
    names attached. Replaces the `conv` block of 11_integrated_analysis.R.
    Accepts the signature files' frames (gene + signature/axis columns)."""
    lit = pd.concat([t[["gene", *[c for c in t.columns if c in ("signature", "axis")]]]
                     for t in signature_tables], ignore_index=True)
    de_genes = set(res.symbol[res.sig_exploratory | res.sig_FDR])
    conv = res[res.symbol.isin(de_genes & set(lit.gene))].copy()
    names: dict[str, set[str]] = {}
    for _, r in lit.iterrows():
        name = r.get("signature") or r.get("axis")
        if isinstance(name, str) and name:
            names.setdefault(str(r.gene), set()).add(name)
    conv["in_signature"] = [";".join(sorted(names.get(str(g), set()))) for g in conv.symbol]
    return conv.sort_values("pvalue").reset_index(drop=True)


def gene_frequency(genes: pd.Series) -> pd.DataFrame:
    """Gene → frequency table (the leadingEdge_gene_frequency of
    11_integrated_analysis.R)."""
    return genes.value_counts().rename_axis("gene").reset_index(name="freq")
