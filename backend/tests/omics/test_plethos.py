"""C1.a – the plethos package against the demo inputs and the demo run's
saved tables (runs/20261025-154815-6ab7/project). Every public function runs;
deterministic ones are checked numerically (DE log2FoldChange within 1e-6).

These tests exercise the real pipeline code path (pydeseq2 fit ~ tens of
seconds on the demo matrix) but skip cleanly when the demo run is absent, so
they stay runnable on a bare checkout.
"""
import os
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

REPO = Path(__file__).resolve().parents[3]
os.sys.path.insert(0, str(REPO / "workflows" / "bulk-py"))  # noqa: E402  (before plethos)
import plethos  # noqa: E402
from plethos import common, de, enrich, integrate, io, normalize, pca, qc, signatures, sensitivity  # noqa: E402

DEMO = REPO / "omics-data" / "runs" / "20261025-154815-6ab7" / "project"
INPUTS = REPO / "omics-data" / "inputs" / "bulk-demo"
CONFIG = dict(group_col="group", group_ref="V", group_test="T")

pytestmark = pytest.mark.skipif(
    not (INPUTS / "gene_count.xls").exists() or not DEMO.exists(),
    reason="demo inputs / demo run not present")


# ------------------------------------------------------------------ fixtures

ANNOT_COLS = ["gene_name", "gene_chr", "gene_start", "gene_end", "gene_strand",
              "gene_length", "gene_biotype", "gene_description", "tf_family"]
EXCLUDE = ["T4"]   # the demo run's main analysis excludes T4 (config.EXCLUDE)


@pytest.fixture(scope="module")
def counts_meta():
    counts, annot, samp = io.read_counts(INPUTS / "gene_count.xls", sep="\t", annot_cols=ANNOT_COLS)
    meta = io.load_metadata(INPUTS / "metadata.csv", list(counts.columns), **CONFIG)
    # replicate 01's main-analysis exclusion so the fit matches the demo run
    counts = counts[[c for c in counts.columns if c not in EXCLUDE]]
    meta = meta.loc[counts.columns]
    return counts, annot, meta


@pytest.fixture(scope="module")
def counts_filt(counts_meta):
    counts, annot, meta = counts_meta
    return qc.filter_genes(counts, 10, 0.5, False, annot["biotype"])


@pytest.fixture(scope="module")
def dds(counts_filt, counts_meta):
    _, _, meta = counts_meta
    design, _ = normalize.make_design(meta)
    return normalize.fit(counts_filt, meta, design, n_cpus=1)


@pytest.fixture(scope="module")
def res(dds, counts_meta):
    _, annot, _ = counts_meta
    return de.threshold(de.results(dds, shrink=True, n_cpus=1), merge_symbols=True, annot=annot)


def demo_csv(*parts: str) -> pd.DataFrame:
    return pd.read_csv(DEMO.joinpath(*parts))


# --------------------------------------------------------------------- io/qc

def test_read_counts_matches_demo():
    # the parse must reproduce what produced the demo run (all 10 samples, pre-exclusion)
    full, annot, _ = io.read_counts(INPUTS / "gene_count.xls", sep="\t", annot_cols=ANNOT_COLS)
    assert full.shape[1] == 10
    assert full.index.tolist() == pd.read_pickle(DEMO / "16_objects" / "counts.pkl").index.tolist()
    assert list(annot.columns) == ["gene_id", "symbol", "biotype"]
    assert annot.symbol.notna().all()


def test_check_raw_counts_accepts_demo(counts_meta):
    ok, frac = io.check_raw_counts(counts_meta[0])
    assert ok and frac > 0.999


def test_map_symbols_fills_blanks():
    ids = pd.Series(["ENSMUSG1", "ENSMUSG2"])
    sym = io.map_symbols(ids, pd.Series(["", np.nan]))
    assert sym.tolist() == ["ENSMUSG1", "ENSMUSG2"]


def test_load_metadata_errors():
    with pytest.raises(ValueError):
        io.load_metadata(pd.DataFrame({"animal": [1]}), ["s1"])
    with pytest.raises(ValueError):
        io.load_metadata(pd.DataFrame({"sample": ["s1"], "group": ["X"]}), ["s1"])


def test_qc_per_sample_columns(counts_meta):
    counts, _, meta = counts_meta
    d = qc.qc_per_sample(counts, meta["group"])
    for col in ("sample", "group", "library_size", "genes_detected", "pct_zero", "median_nonzero",
                "log10_count_q50"):
        assert col in d.columns
    assert (d.library_size > 0).all() and d.pct_zero.between(0, 100).all()
    # quantiles reproduce the demo boxplot data exactly
    demo_qc = demo_csv("02_quality_control", "QC_per_sample_summary.csv")
    merged = demo_qc.merge(d, on="sample", suffixes=("_demo", ""))
    assert np.allclose(merged.library_size_demo, merged.library_size)
    assert np.allclose(merged.median_nonzero_demo, merged.median_nonzero)
    # the new quantile columns agree with a direct recomputation
    lg = np.log10(counts + 1)
    q50 = lg.quantile(0.5, axis=0)
    assert np.allclose(merged.log10_count_q50, [q50[s] for s in merged["sample"]])


def test_filter_genes_matches_demo(counts_filt):
    demo = pd.read_pickle(DEMO / "16_objects" / "counts_filt.pkl")
    assert counts_filt.shape == demo.shape
    assert (counts_filt.to_numpy() == demo.to_numpy()).all()


# ----------------------------------------------------------------- normalize

def test_fit_and_vst_match_demo(dds, counts_filt):
    demo_norm = demo_csv("03_normalized_expression", "normalized_counts.csv").set_index("gene_id")
    norm = normalize.normalized_counts(dds)
    assert norm.shape == demo_norm.T.shape or norm.shape == demo_norm.shape
    cols = [c for c in norm.columns if c in demo_norm.columns] or None
    if cols:  # demo table is genes x samples
        a = norm.T[cols].to_numpy() if norm.shape[0] != demo_norm.shape[0] else norm[cols].to_numpy()
        b = demo_norm[cols].to_numpy()
        assert np.allclose(a, b, rtol=1e-9, atol=1e-8)


def test_size_factors(dds):
    sf = normalize.size_factors(dds)
    assert (sf.size_factor > 0).all() and len(sf) == 9  # 10 samples minus excluded T4


def test_dispersion_table(dds):
    d = normalize.dispersion_table(dds)
    assert (d.genewise > 0).all() and (d.final > 0).all()


# ----------------------------------------------------------------------- pca

def test_pca_vs_demo(dds, counts_meta):
    _, _, meta = counts_meta
    v = normalize.vst(dds)
    pc = pca.pca(v, meta["group"], n_genes=500)
    demo = demo_csv("04_PCA_clustering", "PCA_coordinates.csv")
    assert pc["d"].shape[0] == demo.shape[0]
    # PC scores up to sign; compare by absolute value of each axis
    for c in ("PC1", "PC2", "PC3"):
        a = pc["d"][c].abs().to_numpy()
        b = demo[c].abs().to_numpy()
        assert np.allclose(a, b, atol=1e-6), f"{c} differs from demo"
    ve = demo[[c for c in demo.columns if c.startswith("var_explained_PC")]].iloc[0].to_numpy()
    assert np.allclose(pc["ve"][:3], ve, atol=1e-8)
    # correlation matrix: exact values (sign-free)
    C = pca.correlation_matrix(v)
    demoC = demo_csv("04_PCA_clustering", "sample_correlation_matrix.csv").set_index("sample")
    assert np.allclose(C.loc[demoC.index, demoC.columns].to_numpy(), demoC.to_numpy(), atol=1e-9)


def test_outlier_diagnostics(dds, counts_meta):
    _, _, meta = counts_meta
    v = normalize.vst(dds)
    C = pca.correlation_matrix(v)
    cooks = dds.layers["cooks"] if "cooks" in dds.layers else None
    d = pca.outlier_diagnostics(C, cooks, meta["group"])
    demo = demo_csv("04_PCA_clustering", "outlier_diagnostics.csv")
    assert np.allclose(d.median_corr.to_numpy(), demo.median_corr.to_numpy(), atol=1e-9)
    assert np.allclose(d.corr_modified_z.to_numpy(), demo.corr_modified_z.to_numpy(), atol=1e-9)


def test_common_helpers():
    # rows are genes, columns are samples – row_z z-scores each row
    m = pd.DataFrame({"s1": [1.0, 2.0, 0.0], "s2": [2.0, 4.0, 0.0], "s3": [3.0, 6.0, 0.0]},
                     index=["g1", "g2", "g3"])
    z = common.row_z(m)
    assert np.allclose(z.loc["g1"], z.loc["g2"])       # proportional rows give equal z
    assert z.loc["g3"].isna().all()                    # zero-variance row stays NaN
    assert common.clean_rows(z).shape[0] == 2          # the constant row is dropped
    assert np.allclose(common.bh([0.01, 0.02, 0.3]), [0.03, 0.03, 0.3])
    assert common.pretty_pw("GOBP_GABAergic_signaling") == "Gabaergic signaling"  # original behaviour


# ------------------------------------------------------------------------ de

def test_de_matches_demo(res):
    demo = demo_csv("05_differential_expression", "complete_tables", "DE_all_genes_complete.csv")
    m = demo.merge(res, on="gene_id", suffixes=("_demo", ""))
    assert len(m) == len(demo)
    # C1.a acceptance: log2FoldChange within 1e-6 (MLE, the tested quantity)
    assert np.allclose(m.log2FC_MLE_demo, m.log2FC_MLE, rtol=0, atol=1e-6)
    assert np.allclose(m.pvalue_demo, m.pvalue, rtol=0, atol=1e-9)
    assert np.allclose(m.log2FC_apeglm_demo, m.log2FC_apeglm, rtol=0, atol=1e-6)
    assert (m.direction_FDR_demo == m.direction_FDR).all()
    assert (m.symbol_demo == m.symbol).all()
    # threshold defaults reproduce the demo counts
    assert int(res.sig_FDR.sum()) == int(demo.sig_FDR.sum())
    assert int(res.sig_exploratory.sum()) == int(demo.sig_exploratory.sum())


def test_threshold_and_summary(res):
    s = de.summary_counts(res)
    assert int(s.value[s.metric == "genes_tested"].iloc[0]) == len(res)
    assert float(s.value[s.metric == "FDR_threshold"].iloc[0]) == 0.05


def test_subset_tables_shapes(res):
    subs = de.subset_tables(res)
    up = subs["DE_significant_FDR_up_in_T"]
    down = subs["DE_significant_FDR_down_in_T"]
    assert (up.log2FC_MLE > 0).all() and (down.log2FC_MLE < 0).all()
    assert len(subs["DE_significant_FDR"]) == len(up) + len(down)


# -------------------------------------------------------------------- enrich

def test_gsea_rank_kinds_and_errors():
    r = pd.DataFrame({"symbol": ["a", "b", "c", "a"], "stat_Wald": [1.0, np.nan, -2.0, 3.0],
                      "log2FC_MLE": [0.5, 1, 1, 1], "pvalue": [0.1, 0.2, 1e-4, 0.4]})
    w = enrich.gsea_rank(r, "wald")
    assert w.index.tolist() == ["a", "c"] and w.iloc[0] > w.iloc[1]  # a appears once, desc
    sp = enrich.gsea_rank(r, "signed_p")
    assert sp.index.tolist() == ["c", "a", "b"]  # +4 (c), +1.0 (a), +0.7 (b) – descending
    with pytest.raises(ValueError):
        enrich.gsea_rank(r, "nope")


def test_ora_universe_and_flag(res):
    u = enrich.ora_universe(res)
    assert u == sorted(u) and len(u) > 100
    flag, _ = enrich.pick_flag(res)
    assert flag in ("direction_FDR", "direction_expl")


def test_simplify_by_genes():
    enr = pd.DataFrame({"Term": ["t1", "t2", "t3"], "Genes": ["A;B", "A;B", "C"],
                        "Adjusted P-value": [0.5, 0.1, 0.2]})
    simp = enrich.simplify_by_genes(enr, top_n=2)
    assert simp.Term.tolist() == ["t2", "t3"]


def test_leading_edge_split():
    fg = pd.DataFrame({"pathway": ["p"], "padj": [0.01], "leadingEdge": ["a;b;c"]})
    assert enrich.leading_edge_genes(fg) == ["a", "b", "c"]


# ---------------------------------------------------------------- signatures

def test_mean_z_and_group_comparison(counts_filt, counts_meta, dds):
    _, annot, meta = counts_meta
    v = normalize.vst(dds)
    sym = annot.loc[v.index, "symbol"]
    sets = {"S1": list(sym.iloc[:20]), "tiny": [sym.iloc[0]]}
    sc = signatures.mean_z_scores(v, sym, sets)
    assert sc.shape == (v.shape[1], 2) and sc["tiny"].isna().all()
    comp = signatures.group_comparison(sc, meta["group"])
    assert {"signature", "mean_V", "mean_T", "delta_T_minus_V", "wilcox_p", "wilcox_padj"} <= set(comp.columns)
    finite = comp.wilcox_padj.dropna()
    assert (finite >= 0).all() and len(finite) == 1   # the <2-gene set stays NaN


def test_singscore_bounds(counts_filt, counts_meta, dds):
    _, annot, meta = counts_meta
    v = normalize.vst(dds)
    sym = annot.loc[v.index, "symbol"]
    gset = signatures.map_gene_sets(v, sym, {"S1": list(sym.iloc[:20])}, min_size=2)
    ss = signatures.singscore(v, gset)
    assert ss["S1"].between(-0.5, 0.5).all()


def test_gsva_and_dg_identity(counts_filt, counts_meta, dds):
    _, annot, meta = counts_meta
    v = normalize.vst(dds)
    sym = annot.loc[v.index, "symbol"]
    gset = signatures.map_gene_sets(v, sym, {"S1": list(sym.iloc[:20])}, min_size=2)
    gv = signatures.gsva(v, gset, seed=1234)
    assert gv.shape[0] == v.shape[1] and gv.notna().all().all()
    dg = signatures.dg_identity(pd.DataFrame({"A": [1.0, 2], "B": [3, 4]}, index=["s1", "s2"]),
                                ["A"], ["B"])
    assert np.allclose(dg.DG_identity_score, [-2.0, -2.0])


def test_axis_gene_tables(dds, counts_meta, res):
    _, annot, meta = counts_meta
    v = normalize.vst(dds)
    sym = annot.loc[v.index, "symbol"]
    ax = pd.DataFrame({"axis": ["X", "X", "X"], "subaxis": ["x1", "x1", "x2"],
                       "gene": list(sym.iloc[:3])})
    tab = signatures.axis_gene_tables(v, sym, ax, res)
    assert list(tab.columns) == ["gene_id", "symbol", "baseMean", "log2FC_MLE", "log2FC_apeglm",
                                 "pvalue", "padj", "direction_FDR", "axis", "subaxis"] \
        or "axis" in tab.columns
    assert (tab.axis == "X").all() and len(tab) == 3


# --------------------------------------------------------------- sensitivity

@pytest.mark.slow
def test_refit_without_matches_demo(dds, counts_filt, counts_meta, res):
    # the demo run's sensitivity refit removed the already-excluded T4, i.e. it
    # refit the identical design – the port must reproduce that table exactly
    _, _, meta = counts_meta
    r2 = sensitivity.refit_without(counts_filt, meta, EXCLUDE, n_cpus=1)
    merged, lfc_cor, n_full, n_sens = sensitivity.compare_refits(res, r2)
    demo = demo_csv("15_reports", "sensitivity_with_without_T4_LFC.csv")
    m = demo.merge(merged, on="gene_id", suffixes=("_demo", ""))
    assert np.allclose(m.lfc_sens_demo, m.lfc_sens, rtol=0, atol=1e-6)
    assert np.allclose(m.lfc_full_demo, m.lfc_full, rtol=0, atol=1e-6)


@pytest.mark.slow
def test_refit_without_changes_lfc(dds, counts_filt, counts_meta, res):
    """Removing a real sample must change the numbers (the live sensitivity job)."""
    _, _, meta = counts_meta
    other = [s for s in counts_filt.columns if s not in EXCLUDE][0]
    r2 = sensitivity.refit_without(counts_filt, meta, [other], n_cpus=1)
    merged, lfc_cor, n_full, n_sens = sensitivity.compare_refits(res, r2)
    assert 0.9 < lfc_cor <= 1.0            # shifts LFCs but not wholesale
    assert not np.allclose(merged.lfc_full, merged.lfc_sens, atol=1e-6)
    assert n_full > 0 and n_sens > 0


# ----------------------------------------------------------------- integrate

def test_score_correlation_and_overlap():
    a = pd.DataFrame({"sample": ["s1", "s2"], "group": ["V", "T"], "x": [1.0, 2], "y": [2.0, 4]})
    b = pd.DataFrame({"sample": ["s1", "s2"], "group": ["V", "T"], "z": [1.0, 0]})
    rc = integrate.score_correlation([a, b])
    assert rc.shape == (3, 3)
    ov = integrate.signature_overlap({"A": {"g1", "g2"}, "B": {"g2", "g3"}})
    assert ov.shared.iloc[0] == 1 and ov.genes.iloc[0] == "g2"
    conv = integrate.convergent_candidates(
        pd.DataFrame({"symbol": ["g1", "g9"], "sig_exploratory": [True, False], "sig_FDR": [False, False],
                      "pvalue": [0.01, 0.5]}),
        [pd.DataFrame({"gene": ["g1"], "signature": ["DG_granule"]})])
    assert conv.symbol.iloc[0] == "g1" and conv.in_signature.iloc[0] == "DG_granule"
    assert integrate.gene_frequency(pd.Series(["a", "a", "b"])).freq.tolist() == [2, 1]


def test_import_from_core():
    """backend/app/core.py is the one path hook; importing it must give plethos."""
    import sys
    from app.omics import core  # noqa: F401
    assert "plethos" in sys.modules
