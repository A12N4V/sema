"""plethos – the Plethos bulk RNA-seq analysis core, as a library.

A Python port of the R functions in `workflows/bulk-r/`, organised by step:

- `io` – read the count matrix and metadata (replaces the loading part of 01).
- `qc` – raw-count QC and the expression filter (02).
- `normalize` – size factors / DESeq2 fit / VST (03, replaces DESeq2::vst).
- `pca` – PCA, sample correlation, distances, outlier diagnostics (04).
- `de` – differential expression, shrinkage, thresholds (05, DESeq2::results).
- `enrich` – GO over-representation and GSEA prerank (08, 09;
  clusterProfiler::enrichGO, fgsea::fgseaMultilevel).
- `signatures` – mean-of-z, singscore, GSVA scoring, DG identity (07, 10).
- `integrate` – cross-analysis correlation and overlap tables (11).

Design rules:

- Pure functions. DataFrames and arrays in, DataFrames out. No file I/O, no
  plotting, no imports of `config.py` – the numbered scripts and the backend
  own the file system and the parameters.
- Every public function docstrings the R function it replaces and what differs.
- Deterministic: any function that could depend on chance takes an explicit
  `seed`, and the pipeline pins its seeds.
"""
from __future__ import annotations

# Order matters only for readability; each module is importable standalone.
from . import io, qc, normalize, pca, de, enrich, signatures, sensitivity, integrate  # noqa: F401
from .common import bh, pretty_pw, row_z, clean_rows  # noqa: F401
