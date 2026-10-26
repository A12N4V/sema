# ============================================================================
# 07_DG_identity_scores.py – regional identity / DG enrichment assessment
# NOT histological purity. Scores = "DG identity / enrichment score".
# Methods: mean-of-z (default) + GSVA + singscore (sensitivity).
# Thin wrapper: the scoring lives in plethos.signatures. No plots – the
# marker-gene heatmap and per-signature views draw from the score matrices
# and the marker expression table (PNG map: DG identity family).
# Outputs: 08_DG_identity_enrichment/* ; 16_objects/identity_scores.pkl
# ============================================================================
from utils import *
from plethos import common as pcommon
from plethos import signatures as psig

vstm = load_obj("vst"); meta = load_obj("meta"); annot = load_obj("annot")
ID = "08_DG_identity_enrichment"; grp = meta[CFG.GROUP_COL].astype(str); ord_ = list(vstm.columns)
sym = annot.loc[vstm.index, "symbol"].astype(str)

sig = read_signatures("DG_cell_type_signatures.csv")
save_table(sig, "DG_signature_reference_table", ID)
sig_list = {k: v.gene.tolist() for k, v in sig.groupby("signature")}

score_z = psig.mean_z_scores(vstm, sym, sig_list)
save_table(score_z.reset_index().rename(columns={"index": "sample"})
           .assign(group=grp.values), "signature_scores_meanZ", ID)

gset = psig.map_gene_sets(vstm, sym, sig_list, min_size=2)
try:
    gv = psig.gsva(vstm, gset, seed=CFG.SEED)
    save_table(gv.reset_index().rename(columns={"index": "sample"})
               .assign(group=grp.values), "signature_scores_GSVA", ID)
except Exception as exc:
    say("GSVA failed: %s", exc)

ss = psig.singscore(vstm, gset)
save_table(ss.reset_index().rename(columns={"index": "sample"})
           .assign(group=grp.values), "signature_scores_singscore", ID)

# Marker-gene expression (VST z) for the live heatmap, one gene x sample row.
mk = vstm.index[sym.str.lower().isin({x.lower() for x in sig.gene})]
if len(mk) >= 3:
    z = pcommon.row_z(vstm)
    M = z.loc[mk, ord_].copy(); M.index = sym.loc[mk].values
    M = M[~M.index.duplicated()]
    M.index.name = "symbol"
    long = M.dropna(how="all").reset_index().melt(id_vars="symbol", var_name="sample", value_name="vst_z")
    long = long.merge(meta[CFG.GROUP_COL].astype(str).rename("group").rename_axis("sample").reset_index(), on="sample")
    save_table(long.dropna(subset=["vst_z"]), "marker_gene_expression", ID)

dg_pos = ["DG_granule_mature", "DG_granule_immature", "NSC", "NSC_quiescent", "NSC_active", "IPC_neuroblast"]
dg_neg = ["CA1", "CA3", "ChoroidPlexus", "Ependymal"]
dgid = psig.dg_identity(score_z, dg_pos, dg_neg)
save_table(dgid.assign(group=grp.values), "DG_identity_score_per_sample", ID)

save_table(psig.group_comparison(score_z, meta[CFG.GROUP_COL], CFG.GROUP_REF, CFG.GROUP_TEST),
           "signature_group_comparison", ID)

save_obj(score_z, "identity_scores")
say("07 done. DG identity/enrichment scores (mean-z + GSVA/singscore sensitivity) saved. NOT purity. No plots.")
