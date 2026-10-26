"""io – read the Novogene count matrix and the sample metadata.

Replaces the loading part of `workflows/bulk-r/01_load_data_metadata.R`
(its `read_counts`, symbol mapping and design checks). Differs from R: no
org.Mm.eg.db fallback for symbols (the Novogene file carries them), and the
integer-count guard returns a verdict instead of `stop()`-ing, so callers
choose the error policy.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def read_counts(counts_file: str | pd.DataFrame, sep: str = "\t", gene_id_col: str = "gene_id",
                symbol_col: str = "gene_name", biotype_col: str = "gene_biotype",
                annot_cols: list[str] | None = None) -> tuple[pd.DataFrame, pd.DataFrame, list[str]]:
    """Parse the Novogene matrix into (counts, annotation, sample columns).

    Replaces `read_counts()` in 01_load_data_metadata.R. Ensembl version
    suffixes (ENSMUSG...\\.N) are stripped; duplicate IDs after stripping get a
    `.1`, `.2` suffix so the index stays unique (R uses make.unique).
    """
    if isinstance(counts_file, pd.DataFrame):
        raw = counts_file.copy()
    else:
        raw = pd.read_csv(counts_file, sep=sep)
    annot_cols = annot_cols or []
    if gene_id_col not in raw.columns:
        raw = raw.rename(columns={raw.columns[0]: gene_id_col})
    ids = raw[gene_id_col].astype(str).str.replace(r"\.[0-9]+$", "", regex=True)
    annot_cols = [c for c in [*annot_cols, symbol_col, biotype_col] if c in raw.columns]
    samp = [c for c in raw.columns if c not in [gene_id_col, *annot_cols]]
    samp = [c for c in samp if pd.to_numeric(raw[c], errors="coerce").notna().all()]
    m = raw[samp].apply(pd.to_numeric, errors="coerce").fillna(0)
    ids = pd.Series(ids)
    uniq = ids.where(~ids.duplicated(), ids + "." + ids.groupby(ids).cumcount().astype(str))
    m.index = uniq.values
    annot = pd.DataFrame({
        "gene_id": ids.values,
        "symbol": raw[symbol_col].astype(str).values if symbol_col in raw else np.nan,
        "biotype": raw[biotype_col].astype(str).values if biotype_col in raw else np.nan,
    }, index=m.index)
    return m, annot, samp


def map_symbols(ids: pd.Series, provided: pd.Series) -> pd.Series:
    """Prefer the provided symbol, fall back to the gene ID.

    Replaces the symbol mapping in 01_load_data_metadata.R. Differs from the R
    version: no org.Mm.eg.db lookup – the Novogene symbol column is the only
    source, and blank/`-`/NaN symbols fall back to the ID.
    """
    sym = provided.copy()
    bad = sym.isna() | sym.isin(["", "-", "nan"])
    sym[bad] = ids[bad]
    return sym


def check_raw_counts(counts: pd.DataFrame) -> tuple[bool, float]:
    """Verify the matrix looks like raw integer counts (DESeq2 requires it).

    Replaces the guard in 01_load_data_metadata.R. Returns (ok, fraction
    integer) instead of stopping, so the caller formats the message.
    """
    v = counts.to_numpy(dtype=float)
    frac_int = float(np.mean(np.abs(v - np.round(v)) < 1e-8))
    ok = frac_int >= 0.99 and not (v.max() < 50 and np.any(v % 1 != 0))
    return ok, frac_int


def load_metadata(meta_file: str | pd.DataFrame, samples: list[str], group_col: str = "group",
                  group_ref: str = "V", group_test: str = "T") -> pd.DataFrame:
    """Load and align metadata to the count columns, with the group as a
    categorical ordered ref → test.

    Replaces the metadata checks in 01_load_data_metadata.R: raises on the
    same conditions (missing sample/group columns, samples present in one file
    but not the other, group values outside {ref, test}).
    """
    meta = meta_file if isinstance(meta_file, pd.DataFrame) else pd.read_csv(meta_file)
    if "sample" not in meta.columns:
        raise ValueError("metadata.csv must contain a 'sample' column.")
    if group_col not in meta.columns:
        raise ValueError(f"metadata.csv must contain a '{group_col}' column.")
    meta = meta.copy()
    meta["sample"] = meta["sample"].astype(str)
    meta = meta.set_index("sample")
    miss_meta = sorted(set(samples) - set(meta.index))
    miss_counts = sorted(set(meta.index) - set(samples))
    if miss_meta:
        raise ValueError("Samples in counts but not metadata: " + ", ".join(miss_meta))
    if miss_counts:
        raise ValueError("Samples in metadata but not counts: " + ", ".join(miss_counts))
    meta = meta.loc[samples]
    grp = pd.Categorical(meta[group_col].astype(str), [group_ref, group_test])
    if pd.isna(grp).any():
        raise ValueError(f"Group column has values outside {{{group_ref},{group_test}}}.")
    meta[group_col] = grp
    return meta


def informative_covariates(meta: pd.DataFrame, group_col: str = "group") -> list[str]:
    """Metadata columns with more than one complete, distinct value (the
    covariate scan in 01_load_data_metadata.R)."""
    out = []
    for c in meta.columns:
        if c in ("sample", group_col):
            continue
        s = meta[c].replace({"NA": np.nan, "": np.nan})
        if s.dropna().nunique() > 1:
            out.append(c)
    return out
