# ============================================================================
# 10_targeted_signatures.py – DG-directed axes:
#   Neurogenesis · Plasticity · Inflammation · Metabolism · Endocannabinoid
# Thin wrapper: scoring lives in plethos.signatures. No heatmaps or 3x3
# expression grids – the live heatmap/strip views draw from the axis gene
# expression table (PNG map: axis family).
# Outputs: 12_candidate_genes/*, 16_objects/axis_scores.pkl
# ============================================================================
from utils import *
from plethos import common as pcommon
from plethos import signatures as psig

vstm = load_obj("vst"); meta = load_obj("meta"); annot = load_obj("annot"); res = load_obj("res")
CG = "12_candidate_genes"
grp = meta[CFG.GROUP_COL].astype(str); ord_ = list(vstm.columns)
sym = annot.loc[vstm.index, "symbol"].astype(str)

ax_ = read_signatures("targeted_axes_signatures.csv")
score_all = psig.mean_z_scores(vstm, sym, {a: g.gene.tolist() for a, g in ax_.groupby("axis")})
save_table(score_all.reset_index().rename(columns={"index": "sample"})
           .assign(group=grp.values), "axis_scores_per_sample", CG)

save_table(psig.axis_gene_tables(vstm, sym, ax_, res), "axis_gene_tables", CG)

# Per-sample VST z of every axis gene, for the live axis heatmaps and strips.
z = pcommon.row_z(vstm)
rows = []
for axis, a in ax_.groupby("axis"):
    g = {s.lower() for s in a.gene}
    ids = list(vstm.index[sym.str.lower().isin(g)])
    if len(ids) < 3:
        continue
    sub = dict(zip(a.gene.str.lower(), a.subaxis))
    M = z.loc[ids, ord_].copy()
    M.index = sym.loc[ids].values
    M = M[~M.index.duplicated()]
    long = M.reset_index().rename(columns={"index": "symbol"}) \
            .melt(id_vars="symbol", var_name="sample", value_name="vst_z")
    long["axis"] = axis
    long["subaxis"] = [sub.get(s.lower()) for s in long.symbol]
    rows.append(long)
if rows:
    tab = pd.concat(rows, ignore_index=True)
    tab = tab.merge(meta[CFG.GROUP_COL].astype(str).rename("group").rename_axis("sample").reset_index(),
                    on="sample")
    save_table(tab.dropna(subset=["vst_z"]), "axis_gene_expression", CG)

comp = psig.group_comparison(score_all, meta[CFG.GROUP_COL], CFG.GROUP_REF, CFG.GROUP_TEST, label="axis")
comp["cohens_d"] = [
    (r.mean_T - r.mean_V) / np.sqrt((score_all.loc[grp.values == CFG.GROUP_REF, r.axis].var()
                                     + score_all.loc[grp.values == CFG.GROUP_TEST, r.axis].var()) / 2)
    if np.isfinite(r.wilcox_p) else np.nan for _, r in comp.iterrows()]
save_table(comp, "axis_scores_group_comparison", CG)

save_obj(score_all, "axis_scores")
say("10 done. Targeted axes (neurogenesis/plasticity/inflammation/metabolism/eCB) saved. No plots.")
