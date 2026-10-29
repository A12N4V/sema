# ============================================================================
# 06_volcano_MA_heatmaps.py – DE diagnostics as tables for the live figures.
# The volcano, MA, p/padj/log2FC histograms, top-DEG heatmaps and candidate
# expression panels are live views now (PNG map: 06/07 families). This step
# writes the tables they need and nothing else.
# Outputs: 06_volcano_plots/volcano_points.csv ; 07_heatmaps/top_deg_symbols.csv
#          16_objects/ (res already saved by 05)
# ============================================================================
from utils import *
from plethos.common import row_z

res = load_obj("res"); vstm = load_obj("vst"); meta = load_obj("meta"); annot = load_obj("annot")
VP, HM = "06_volcano_plots", "07_heatmaps"

# The full DE table already carries every field the live volcano/MA/histograms
# need (log2FC_MLE, padj, pvalue, baseMean, log2FC_apeglm, direction_*).
# A compact points table keeps the row order the figures default to.
pts = res[np.isfinite(res.log2FC_MLE)].copy()
pts["minus_log10_padj"] = -np.log10(pts.padj.clip(lower=1e-300))
pts["minus_log10_p"] = -np.log10(pts.pvalue.clip(lower=1e-300))
save_table(pts[["gene_id", "symbol", "log2FC_MLE", "minus_log10_padj", "minus_log10_p",
                "direction_FDR", "direction_expl", "baseMean", "log2FC_apeglm"]],
           "volcano_points", VP)

# Ranked top-DEG symbol list (one row per gene) for the heatmap N stepper.
top = res.dropna(subset=["pvalue"]).sort_values("pvalue")
save_table(pd.DataFrame({"rank": range(1, len(top) + 1), "gene_id": top.gene_id.values,
                         "symbol": top.symbol.values})[lambda d: d.gene_id.isin(vstm.index)],
           "top_deg_symbols", HM)

# Per-sample expression of the priority genes: top 100 by evidence, VST z.
z = row_z(vst := vstm); ord_ = list(z.columns)
ids = [g for g in top.gene_id.head(100) if g in z.index]
if ids:
    M = z.loc[ids, ord_].copy()
    M.index = annot.loc[ids, "symbol"].astype(str).values
    long = M.rename_axis("symbol").reset_index().melt(id_vars="symbol", var_name="sample",
                                                      value_name="vst_z")
    long["gene_id"] = [g for g in ids for _ in ord_]
    long = long.merge(res[["gene_id", "direction_FDR", "padj"]], on="gene_id", how="left") \
               .merge(meta[CFG.GROUP_COL].astype(str).rename("group").rename_axis("sample").reset_index(),
                      on="sample")
    save_table(long[["symbol", "gene_id", "sample", "group", "vst_z", "direction_FDR", "padj"]],
               "top100_deg_expression", HM)
say("06 done. Volcano/MA/histogram/heatmap inputs written as tables (no plots).")
