# ============================================================================
# 11_integrated_analysis.py – integrate DE + GO + GSEA + signatures.
# Correlations among scores; scores vs PC1/PC2; signature overlap; convergent
# candidates. Language is associative only. Thin wrapper: the logic lives in
# plethos.integrate. No plots – the live heatmap/matrix views draw from the
# saved matrices (PNG map: score correlation + UpSet families).
# Outputs: 12_candidate_genes/*, 10_GSEA/
# ============================================================================
from utils import *
from plethos import integrate as pint

res = load_obj("res"); meta = load_obj("meta")
identity, axes_, pca = try_obj("identity_scores"), try_obj("axis_scores"), try_obj("pca")
CG = "12_candidate_genes"; ord_ = list(meta.index)

parts = [d.drop(columns=["sample", "group"], errors="ignore").reset_index(drop=True)
         for d in (axes_, identity) if d is not None]
Rc = pint.score_correlation(parts) if parts else pd.DataFrame()
if not Rc.empty:
    save_table(Rc.rename_axis("score").reset_index(), "score_correlation_matrix", CG)
    if pca is not None:
        pcs = pca["d"].loc[ord_]
        S = pd.concat(parts, axis=1); S.index = ord_
        save_table(pint.score_pc_correlation(S, pcs), "score_vs_PC_correlation", CG)

ct = read_signatures("DG_cell_type_signatures.csv"); ax_ = read_signatures("targeted_axes_signatures.csv")
setlist = {k: set(v.gene) for k, v in ct.groupby("signature")} | {k: set(v.gene) for k, v in ax_.groupby("axis")}
setlist = {k: v for k, v in setlist.items() if len(v) >= 3}
ov = pint.signature_overlap(setlist)
if len(ov):
    save_table(ov, "signature_gene_overlap", CG)

conv = pint.convergent_candidates(res, [ct, ax_])
save_table(conv, "convergent_candidates_DE_and_literature", CG)

le_file = P("10_GSEA", "GSEA_leadingEdge_topPathway_genes.csv")
if le_file.exists():
    le = pd.read_csv(le_file)
    save_table(pint.gene_frequency(le.leadingEdge_gene), "leadingEdge_gene_frequency", CG)
say("11 done. Integrated correlations, overlaps, convergent candidates saved. No plots.")
