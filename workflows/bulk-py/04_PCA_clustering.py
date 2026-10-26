# ============================================================================
# 04_PCA_clustering.py – PCA, correlation, distances, outlier QC
# Thin wrapper: the logic lives in plethos.pca. No plots – the live heatmap
# and embedding views draw from the matrices (PNG map: 04 family).
# Outputs: 04_PCA_clustering/* ; 16_objects/{pca,cook_tab}.pkl
# No samples are removed automatically (see report for with/without sensitivity).
# ============================================================================
from utils import *
from plethos import pca as pp

V = load_obj("vst"); dds = load_obj("dds"); meta = load_obj("meta")
PC = "04_PCA_clustering"; ord_ = list(V.columns)
grp = meta[CFG.GROUP_COL].astype(str)

pc = pp.pca(V, grp, n_genes=500); save_obj(pc, "pca")
save_table(pc["d"].assign(**{f"var_explained_PC{i + 1}": pc["ve"][i] for i in range(min(3, len(pc["ve"])))}),
           "PCA_coordinates", PC)

C = pp.correlation_matrix(V)
save_table(C.rename_axis("sample").reset_index(), "sample_correlation_matrix", PC)
Dm = pp.distance_matrix(V)
save_table(Dm.rename_axis("sample").reset_index(), "sample_distance_matrix", PC)

cooks = dds.layers["cooks"] if "cooks" in dds.layers else None
out = pp.outlier_diagnostics(C, cooks, grp)
save_table(out, "outlier_diagnostics", PC); save_obj(out, "cook_tab")

covar_avail = try_obj("covar_avail") or []
if covar_avail:
    save_table(pp.covariate_pc_association(meta, pc["d"], covar_avail), "covariate_PC_association", PC)
else:
    say("No informative covariates (sex/batch/RIN/date) -> batch/covariate QC skipped, documented.")
say("04 done. PCA/correlation/distance/outlier diagnostics saved (no samples removed, no plots).")
